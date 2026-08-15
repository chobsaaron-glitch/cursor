/**
 * Calculation (geometry + material) engine.
 *
 * Pure functions only: it takes a FramingSpec plus a flat catalog snapshot and
 * returns every derived dimension and material quantity. It never touches the
 * database and never decides a price — that is the pricing engine's job.
 */

import { areaM2, mmToM, perimeterMm, round4, unitedInches } from '@/lib/units';
import type {
  BackingSpec,
  CalculationResult,
  FrameResult,
  FramingSpec,
  GlazingPosition,
  MatLayerResult,
  MatLayerSpec,
  Margins,
  MouldingLayerSpec,
  SheetResult,
  Size,
} from './types';

export interface CalcMouldingSpec {
  widthMm: number;
  heightMm: number;
  rabbetMm: number;
  rabbetOverlapMm: number;
  stickLengthMm: number;
  kerfMm: number;
  allowanceMm: number;
}

export interface CalcSheetSpec {
  sheetWidthMm: number;
  sheetHeightMm: number;
  thicknessMm: number;
  allowOffcuts: boolean;
}

export interface CalcHardwareSpec {
  perItem: number;
  perPerimeterM: number;
  packSize: number;
}

export interface CalcServiceSpec {
  standardMinutes: number;
  minutesPerM2: number;
  complexityFactor: number;
}

export interface CalcCatalogItem {
  id: string;
  name: string;
  group: string;
  unit: string;
  wasteFactor: number;
  moulding?: CalcMouldingSpec | null;
  sheet?: CalcSheetSpec | null;
  hardware?: CalcHardwareSpec | null;
  service?: CalcServiceSpec | null;
}

export type CalcCatalog = Map<string, CalcCatalogItem>;

export const DEFAULTS = {
  /** Mat lip covering the artwork on each side. */
  matOverlapMm: 5,
  /** Visible strip of a lower mat layer. */
  matRevealMm: 5,
  /** Border of the top mat when nothing is specified. */
  matMarginMm: 70,
  /** Total play between the sandwich and the rabbet (both sides together). */
  clearanceMm: 2,
  /** Fallback moulding geometry when the catalog entry has no spec. */
  moulding: {
    widthMm: 30,
    heightMm: 25,
    rabbetMm: 8,
    rabbetOverlapMm: 3,
    stickLengthMm: 3000,
    kerfMm: 3,
    allowanceMm: 0,
  } satisfies CalcMouldingSpec,
  sheet: {
    sheetWidthMm: 810,
    sheetHeightMm: 1220,
    thicknessMm: 1.4,
    allowOffcuts: true,
  } satisfies CalcSheetSpec,
} as const;

const MAX_MAT_LAYERS = 7;

function size(widthMm: number, heightMm: number): Size {
  return { widthMm: round1(widthMm), heightMm: round1(heightMm) };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function mouldingSpecOf(item: CalcCatalogItem | undefined, override?: MouldingLayerSpec): CalcMouldingSpec {
  const base = item?.moulding ?? DEFAULTS.moulding;
  return {
    ...base,
    widthMm: override?.widthMm ?? base.widthMm,
    rabbetOverlapMm: override?.rabbetOverlapMm ?? base.rabbetOverlapMm,
  };
}

function sheetSpecOf(item: CalcCatalogItem | undefined): CalcSheetSpec {
  return item?.sheet ?? DEFAULTS.sheet;
}

function normaliseMargins(margins: Margins | undefined): Margins {
  return {
    leftMm: margins?.leftMm ?? DEFAULTS.matMarginMm,
    rightMm: margins?.rightMm ?? DEFAULTS.matMarginMm,
    topMm: margins?.topMm ?? DEFAULTS.matMarginMm,
    bottomMm: margins?.bottomMm ?? DEFAULTS.matMarginMm,
  };
}

/**
 * How much of a standard sheet a piece consumes.
 *
 * `allowOffcuts` items (matboard, glazing) are charged by the area actually
 * used plus the technological waste share; items that cannot be re-used are
 * charged as whole sheets.
 */
export function sheetUsage(
  piece: Size,
  sheet: CalcSheetSpec,
  wasteFactor: number,
): { sheets: number; fitsPerSheet: number; oversized: boolean } {
  const fitsPerSheet = piecesPerSheet(piece, sheet);
  const oversized = fitsPerSheet === 0;
  const sheetArea = (sheet.sheetWidthMm * sheet.sheetHeightMm) / 1_000_000;
  const pieceArea = (piece.widthMm * piece.heightMm) / 1_000_000;

  if (oversized) {
    const sheets = sheetArea > 0 ? Math.ceil(pieceArea / sheetArea) : 1;
    return { sheets: Math.max(1, sheets), fitsPerSheet: 0, oversized: true };
  }

  if (!sheet.allowOffcuts) {
    return { sheets: round4(1 / fitsPerSheet), fitsPerSheet, oversized: false };
  }

  const sheets = sheetArea > 0 ? (pieceArea / sheetArea) * (1 + wasteFactor) : 0;
  return { sheets: round4(sheets), fitsPerSheet, oversized: false };
}

/** Guillotine estimate: how many pieces fit on one sheet, rotation allowed. */
export function piecesPerSheet(piece: Size, sheet: CalcSheetSpec): number {
  const direct =
    Math.floor(sheet.sheetWidthMm / piece.widthMm) * Math.floor(sheet.sheetHeightMm / piece.heightMm);
  const rotated =
    Math.floor(sheet.sheetWidthMm / piece.heightMm) * Math.floor(sheet.sheetHeightMm / piece.widthMm);
  return Math.max(direct, rotated);
}

function buildSheetResult(
  catalogItemId: string,
  item: CalcCatalogItem | undefined,
  pieceSize: Size,
  name: string | undefined,
  warnings: string[],
): SheetResult {
  const sheet = sheetSpecOf(item);
  const usage = sheetUsage(pieceSize, sheet, item?.wasteFactor ?? 0);
  if (usage.oversized) {
    warnings.push(
      `«${name ?? item?.name ?? catalogItemId}»: размер ${pieceSize.widthMm}×${pieceSize.heightMm} мм больше листа ${sheet.sheetWidthMm}×${sheet.sheetHeightMm} мм — потребуется склейка или другой материал.`,
    );
  }
  return {
    catalogItemId,
    name: name ?? item?.name,
    size: pieceSize,
    areaM2: areaM2(pieceSize.widthMm, pieceSize.heightMm),
    sheets: usage.sheets,
    perimeterMm: perimeterMm(pieceSize.widthMm, pieceSize.heightMm),
  };
}

/**
 * Main entry point. Recomputes the whole construction from scratch — there is
 * no partial update path, which is what keeps sizes consistent when a single
 * field changes.
 */
export function calculateFraming(spec: FramingSpec, catalog: CalcCatalog): CalculationResult {
  const warnings: string[] = [];
  const artworkWidth = Math.max(0, spec.artworkWidthMm);
  const artworkHeight = Math.max(0, spec.artworkHeightMm);

  if (artworkWidth <= 0 || artworkHeight <= 0) {
    warnings.push('Не заданы размеры изделия.');
  }

  const clearance = spec.clearanceMm ?? DEFAULTS.clearanceMm;
  const mats = [...(spec.mats ?? [])].sort((a, b) => a.layer - b.layer).slice(0, MAX_MAT_LAYERS);
  if ((spec.mats?.length ?? 0) > MAX_MAT_LAYERS) {
    warnings.push(`Поддерживается не более ${MAX_MAT_LAYERS} слоёв паспарту, лишние слои отброшены.`);
  }

  const artwork = size(artworkWidth, artworkHeight);

  // --- mats ---------------------------------------------------------------
  const matResults: MatLayerResult[] = [];
  let sandwich: Size;
  let sight: Size;

  if (mats.length > 0) {
    const bottom = mats[mats.length - 1];
    const bottomOverlap = bottom.overlapMm ?? DEFAULTS.matOverlapMm;
    const openings: Size[] = new Array(mats.length);
    openings[mats.length - 1] = size(
      artworkWidth - 2 * bottomOverlap,
      artworkHeight - 2 * bottomOverlap,
    );

    for (let i = mats.length - 2; i >= 0; i -= 1) {
      const revealBelow = mats[i + 1].revealMm ?? DEFAULTS.matRevealMm;
      openings[i] = size(
        openings[i + 1].widthMm + 2 * revealBelow,
        openings[i + 1].heightMm + 2 * revealBelow,
      );
    }

    const margins = normaliseMargins(mats[0].margins);
    const outer = size(
      openings[0].widthMm + margins.leftMm + margins.rightMm,
      openings[0].heightMm + margins.topMm + margins.bottomMm,
    );

    mats.forEach((mat, index) => {
      const item = mat.catalogItemId ? catalog.get(mat.catalogItemId) : undefined;
      const openings_ = mat.openings ?? 1;
      const opening = openings[index];
      const reveal = mat.revealMm ?? DEFAULTS.matRevealMm;
      const visibleBorder: Margins =
        index === 0
          ? margins
          : { leftMm: reveal, rightMm: reveal, topMm: reveal, bottomMm: reveal };

      if (opening.widthMm <= 0 || opening.heightMm <= 0) {
        warnings.push(`Слой паспарту №${mat.layer}: окно получилось нулевого размера.`);
      }

      matResults.push({
        layer: mat.layer,
        catalogItemId: mat.catalogItemId,
        name: mat.name ?? item?.name,
        outer,
        opening,
        visibleBorder,
        areaM2: areaM2(outer.widthMm, outer.heightMm),
        cutLengthMm: Math.round(
          perimeterMm(outer.widthMm, outer.heightMm) +
            perimeterMm(opening.widthMm, opening.heightMm) * openings_,
        ),
        openings: openings_,
        vGrooveLengthMm: mat.vGroove
          ? Math.round(perimeterMm(opening.widthMm + 40, opening.heightMm + 40))
          : 0,
      });
    });

    sandwich = outer;
    sight = openings[mats.length - 1];
  } else {
    sandwich = artwork;
    sight = artwork;
  }

  // --- frames -------------------------------------------------------------
  const mouldings = [...(spec.mouldings ?? [])].sort((a, b) =>
    a.role === b.role ? 0 : a.role === 'INNER' ? -1 : 1,
  );
  const frames: FrameResult[] = [];
  let current = sandwich;

  for (const layer of mouldings) {
    const item = catalog.get(layer.catalogItemId);
    const moulding = mouldingSpecOf(item, layer);
    const frameClearance = layer.clearanceMm ?? clearance;
    const opening = size(current.widthMm + frameClearance, current.heightMm + frameClearance);
    const outer = size(opening.widthMm + 2 * moulding.widthMm, opening.heightMm + 2 * moulding.widthMm);

    const pieces = [outer.widthMm, outer.widthMm, outer.heightMm, outer.heightMm];
    const totalLengthMm = pieces.reduce((acc, value) => acc + value, 0);
    // Four mitred pieces → four saw passes, each eating one kerf, plus the
    // per-side allowance and the catalog waste share.
    const cuts = 4;
    const joins = 4;
    const rawConsumed = totalLengthMm + cuts * moulding.kerfMm + pieces.length * moulding.allowanceMm;
    const consumedLengthMm = Math.round(rawConsumed * (1 + (item?.wasteFactor ?? 0)));

    if (item && item.group !== 'MOULDING') {
      warnings.push(`«${item.name}» не является багетом, но выбран как багет.`);
    }
    if (moulding.stickLengthMm > 0 && Math.max(outer.widthMm, outer.heightMm) > moulding.stickLengthMm) {
      warnings.push(
        `Сторона рамы ${Math.max(outer.widthMm, outer.heightMm)} мм длиннее хлыста ${moulding.stickLengthMm} мм.`,
      );
    }

    frames.push({
      role: layer.role,
      catalogItemId: layer.catalogItemId,
      name: layer.name ?? item?.name,
      widthMm: moulding.widthMm,
      opening,
      outer,
      pieces,
      totalLengthMm: Math.round(totalLengthMm),
      consumedLengthMm,
      wasteLengthMm: Math.max(0, consumedLengthMm - Math.round(totalLengthMm)),
      cuts,
      joins,
    });

    current = outer;
  }

  const outermost = frames.length > 0 ? frames[frames.length - 1].outer : sandwich;

  // --- glazing ------------------------------------------------------------
  let glazing: (SheetResult & { position: GlazingPosition }) | undefined;
  if (spec.glazing) {
    const position: GlazingPosition = spec.glazing.position ?? spec.glazingPosition ?? 'INNER';
    let glazingSize = sandwich;
    if (position !== 'INNER') {
      if (frames.length === 0) {
        warnings.push('Расположение стекла указано снаружи, но багет не выбран — стекло рассчитано по размеру сэндвича.');
      } else {
        glazingSize = frames[frames.length - 1].opening;
      }
    }
    if (position === 'BETWEEN' && frames.length < 2) {
      warnings.push('Стекло между багетами требует двух багетов.');
    }
    const item = catalog.get(spec.glazing.catalogItemId);
    glazing = {
      ...buildSheetResult(spec.glazing.catalogItemId, item, glazingSize, spec.glazing.name, warnings),
      position,
    };
  } else {
    warnings.push('Остекление не выбрано.');
  }

  // --- backing, mounting board, subframe ----------------------------------
  let backing: SheetResult | undefined;
  if (spec.backing) {
    const item = catalog.get(spec.backing.catalogItemId);
    backing = buildSheetResult(spec.backing.catalogItemId, item, sandwich, spec.backing.name, warnings);
  }

  let mountingBoard: SheetResult | undefined;
  if (spec.mounting?.boardCatalogItemId) {
    const item = catalog.get(spec.mounting.boardCatalogItemId);
    mountingBoard = buildSheetResult(
      spec.mounting.boardCatalogItemId,
      item,
      sight,
      spec.mounting.name,
      warnings,
    );
  }

  let subframe: CalculationResult['subframe'];
  if (spec.subframe) {
    const item = catalog.get(spec.subframe.catalogItemId);
    const wrap = spec.subframe.wrapMm ?? 0;
    const frameSize = size(artworkWidth - 2 * wrap, artworkHeight - 2 * wrap);
    const totalLengthMm = Math.round(perimeterMm(frameSize.widthMm, frameSize.heightMm));
    subframe = {
      catalogItemId: spec.subframe.catalogItemId,
      name: spec.subframe.name ?? item?.name,
      size: frameSize,
      totalLengthMm,
      consumedLengthMm: Math.round(totalLengthMm * (1 + (item?.wasteFactor ?? 0.05))),
    };
  }

  // --- depth --------------------------------------------------------------
  const frameDepth = frames.reduce((acc, frame) => {
    const item = catalog.get(frame.catalogItemId);
    return Math.max(acc, item?.moulding?.heightMm ?? DEFAULTS.moulding.heightMm);
  }, 0);
  const matDepth = matResults.reduce((acc, mat) => {
    const item = mat.catalogItemId ? catalog.get(mat.catalogItemId) : undefined;
    return acc + (item?.sheet?.thicknessMm ?? DEFAULTS.sheet.thicknessMm);
  }, 0);
  const glazingDepth = spec.glazing ? sheetSpecOf(catalog.get(spec.glazing.catalogItemId)).thicknessMm : 0;
  const backingDepth = spec.backing ? sheetSpecOf(catalog.get(spec.backing.catalogItemId)).thicknessMm : 0;
  const spacer = spec.glazing?.spacerMm ?? 0;

  return {
    artwork,
    sight,
    sandwich,
    outer: outermost,
    mats: matResults,
    frames,
    glazing,
    backing,
    mountingBoard,
    subframe,
    totals: {
      perimeterMm: Math.round(perimeterMm(outermost.widthMm, outermost.heightMm)),
      areaM2: areaM2(outermost.widthMm, outermost.heightMm),
      unitedInches: unitedInches(outermost.widthMm, outermost.heightMm),
      depthMm: round1(Math.max(frameDepth, matDepth + glazingDepth + backingDepth + spacer)),
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Material engine — turns geometry into concrete component quantities
// ---------------------------------------------------------------------------

export interface MaterialLine {
  group: string;
  catalogItemId: string | null;
  name: string;
  role: string;
  unit: string;
  /** Net quantity that ends up in the product. */
  quantity: number;
  /** Quantity taken from stock, technological waste included. */
  consumedQuantity: number;
  wasteQuantity: number;
  meta: Record<string, unknown>;
}

/**
 * Derives the bill of materials from a calculation result. Quantities are in
 * the catalog unit of each item, so inventory can consume them directly.
 */
export function buildMaterialLines(
  spec: FramingSpec,
  calc: CalculationResult,
  catalog: CalcCatalog,
): MaterialLine[] {
  const lines: MaterialLine[] = [];

  for (const frame of calc.frames) {
    const item = catalog.get(frame.catalogItemId);
    lines.push({
      group: 'MOULDING',
      catalogItemId: frame.catalogItemId,
      name: frame.name ?? item?.name ?? 'Багет',
      role: frame.role === 'INNER' ? 'INNER_FRAME' : 'OUTER_FRAME',
      unit: item?.unit ?? 'M',
      quantity: mmToM(frame.totalLengthMm),
      consumedQuantity: mmToM(frame.consumedLengthMm),
      wasteQuantity: mmToM(frame.wasteLengthMm),
      meta: {
        pieces: frame.pieces,
        openingMm: frame.opening,
        outerMm: frame.outer,
        cuts: frame.cuts,
        joins: frame.joins,
        lengthMm: frame.totalLengthMm,
      },
    });
  }

  for (const mat of calc.mats) {
    if (!mat.catalogItemId) continue;
    const item = catalog.get(mat.catalogItemId);
    const sheet = sheetSpecOf(item);
    const usage = sheetUsage(mat.outer, sheet, item?.wasteFactor ?? 0);
    lines.push({
      group: 'MATBOARD',
      catalogItemId: mat.catalogItemId,
      name: mat.name ?? item?.name ?? 'Паспарту',
      role: `MAT_${mat.layer}`,
      unit: item?.unit ?? 'SHEET',
      quantity: round4(usage.sheets / (1 + (item?.wasteFactor ?? 0))),
      consumedQuantity: usage.sheets,
      wasteQuantity: round4(usage.sheets - usage.sheets / (1 + (item?.wasteFactor ?? 0))),
      meta: {
        outer: mat.outer,
        opening: mat.opening,
        areaM2: mat.areaM2,
        cutLengthMm: mat.cutLengthMm,
        openings: mat.openings,
        vGrooveLengthMm: mat.vGrooveLengthMm,
      },
    });
  }

  const sheetLines: Array<{ group: string; role: string; result?: SheetResult }> = [
    { group: 'GLAZING', role: 'GLAZING', result: calc.glazing },
    { group: 'BACKING', role: 'BACKING', result: calc.backing },
    { group: 'MOUNTING', role: 'MOUNTING_BOARD', result: calc.mountingBoard },
  ];

  for (const entry of sheetLines) {
    if (!entry.result) continue;
    const item = catalog.get(entry.result.catalogItemId);
    const waste = item?.wasteFactor ?? 0;
    lines.push({
      group: entry.group,
      catalogItemId: entry.result.catalogItemId,
      name: entry.result.name ?? item?.name ?? entry.group,
      role: entry.role,
      unit: item?.unit ?? 'SHEET',
      quantity: round4(entry.result.sheets / (1 + waste)),
      consumedQuantity: entry.result.sheets,
      wasteQuantity: round4(entry.result.sheets - entry.result.sheets / (1 + waste)),
      meta: {
        size: entry.result.size,
        areaM2: entry.result.areaM2,
        perimeterMm: entry.result.perimeterMm,
      },
    });
  }

  if (calc.subframe) {
    const item = catalog.get(calc.subframe.catalogItemId);
    lines.push({
      group: 'SUBFRAME',
      catalogItemId: calc.subframe.catalogItemId,
      name: calc.subframe.name ?? item?.name ?? 'Подрамник',
      role: 'SUBFRAME',
      unit: item?.unit ?? 'M',
      quantity: mmToM(calc.subframe.totalLengthMm),
      consumedQuantity: mmToM(calc.subframe.consumedLengthMm),
      wasteQuantity: mmToM(calc.subframe.consumedLengthMm - calc.subframe.totalLengthMm),
      meta: { size: calc.subframe.size },
    });
  }

  for (const hardware of spec.hardware ?? []) {
    const item = catalog.get(hardware.catalogItemId);
    const hardwareSpec = item?.hardware ?? { perItem: 1, perPerimeterM: 0, packSize: 1 };
    const perimeterM = mmToM(calc.totals.perimeterMm);
    const quantity =
      hardware.quantity ??
      Math.max(
        hardwareSpec.perItem,
        Math.ceil(hardwareSpec.perItem + hardwareSpec.perPerimeterM * perimeterM),
      );
    lines.push({
      group: 'HARDWARE',
      catalogItemId: hardware.catalogItemId,
      name: hardware.name ?? item?.name ?? 'Фурнитура',
      role: 'HARDWARE',
      unit: item?.unit ?? 'PIECE',
      quantity: round4(quantity),
      consumedQuantity: round4(quantity * (1 + (item?.wasteFactor ?? 0))),
      wasteQuantity: round4(quantity * (item?.wasteFactor ?? 0)),
      meta: { perimeterM },
    });
  }

  for (const extra of spec.extras ?? []) {
    const item = catalog.get(extra.catalogItemId);
    const quantity = extra.quantity ?? 1;
    lines.push({
      group: item?.group ?? 'EXTRA',
      catalogItemId: extra.catalogItemId,
      name: extra.name ?? item?.name ?? 'Доп. услуга',
      role: 'EXTRA',
      unit: item?.unit ?? 'PIECE',
      quantity: round4(quantity),
      consumedQuantity: round4(quantity),
      wasteQuantity: 0,
      meta: { note: extra.note ?? null },
    });
  }

  for (const service of spec.services ?? []) {
    const item = catalog.get(service.catalogItemId);
    const serviceSpec = item?.service ?? { standardMinutes: 0, minutesPerM2: 0, complexityFactor: 1 };
    const minutes =
      (serviceSpec.standardMinutes + serviceSpec.minutesPerM2 * calc.totals.areaM2) *
      serviceSpec.complexityFactor;
    lines.push({
      group: item?.group ?? 'SERVICE',
      catalogItemId: service.catalogItemId,
      name: service.name ?? item?.name ?? 'Работа',
      role: 'SERVICE',
      unit: item?.unit ?? 'PIECE',
      quantity: round4(service.quantity ?? 1),
      consumedQuantity: 0,
      wasteQuantity: 0,
      meta: { minutes: round4(minutes) },
    });
  }

  if (spec.mounting && spec.mounting.method !== 'NONE' && spec.mounting.catalogItemId) {
    const item = catalog.get(spec.mounting.catalogItemId);
    const serviceSpec = item?.service ?? { standardMinutes: 0, minutesPerM2: 0, complexityFactor: 1 };
    const minutes =
      (serviceSpec.standardMinutes + serviceSpec.minutesPerM2 * areaM2(calc.sight.widthMm, calc.sight.heightMm)) *
      serviceSpec.complexityFactor;
    lines.push({
      group: item?.group ?? 'MOUNTING',
      catalogItemId: spec.mounting.catalogItemId,
      name: spec.mounting.name ?? item?.name ?? 'Натяжка',
      role: 'MOUNTING',
      unit: item?.unit ?? 'PIECE',
      quantity: 1,
      consumedQuantity: 0,
      wasteQuantity: 0,
      meta: { method: spec.mounting.method, minutes: round4(minutes) },
    });
  }

  return lines;
}

export type { BackingSpec, MatLayerSpec };
