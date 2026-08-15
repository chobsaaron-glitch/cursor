import { describe, expect, it } from 'vitest';
import {
  buildMaterialLines,
  calculateFraming,
  piecesPerSheet,
  sheetUsage,
  type CalcCatalog,
  type CalcCatalogItem,
} from '@/server/modules/framing/calculation';
import type { FramingSpec } from '@/server/modules/framing/types';

function catalogItem(partial: Partial<CalcCatalogItem> & { id: string; group: string }): CalcCatalogItem {
  return {
    name: partial.id,
    unit: 'PIECE',
    wasteFactor: 0,
    ...partial,
  } as CalcCatalogItem;
}

const catalog: CalcCatalog = new Map<string, CalcCatalogItem>([
  [
    'mould-30',
    catalogItem({
      id: 'mould-30',
      name: 'Багет классик 30 мм',
      group: 'MOULDING',
      unit: 'M',
      wasteFactor: 0.1,
      moulding: {
        widthMm: 30,
        heightMm: 25,
        rabbetMm: 10,
        rabbetOverlapMm: 3,
        stickLengthMm: 3000,
        kerfMm: 3,
        allowanceMm: 0,
      },
    }),
  ],
  [
    'mould-15',
    catalogItem({
      id: 'mould-15',
      name: 'Багет внутренний 15 мм',
      group: 'MOULDING',
      unit: 'M',
      wasteFactor: 0,
      moulding: {
        widthMm: 15,
        heightMm: 18,
        rabbetMm: 8,
        rabbetOverlapMm: 3,
        stickLengthMm: 3000,
        kerfMm: 3,
        allowanceMm: 0,
      },
    }),
  ],
  [
    'mat-white',
    catalogItem({
      id: 'mat-white',
      name: 'Паспарту белое',
      group: 'MATBOARD',
      unit: 'SHEET',
      wasteFactor: 0.15,
      sheet: { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: true },
    }),
  ],
  [
    'mat-cream',
    catalogItem({
      id: 'mat-cream',
      name: 'Паспарту кремовое',
      group: 'MATBOARD',
      unit: 'SHEET',
      wasteFactor: 0.15,
      sheet: { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: true },
    }),
  ],
  [
    'glass-ar',
    catalogItem({
      id: 'glass-ar',
      name: 'Стекло антибликовое',
      group: 'GLAZING',
      unit: 'M2',
      wasteFactor: 0.12,
      sheet: { sheetWidthMm: 1600, sheetHeightMm: 2200, thicknessMm: 2, allowOffcuts: true },
    }),
  ],
  [
    'backing-hdf',
    catalogItem({
      id: 'backing-hdf',
      name: 'Задник ДВП',
      group: 'BACKING',
      unit: 'SHEET',
      wasteFactor: 0.05,
      sheet: { sheetWidthMm: 1220, sheetHeightMm: 2440, thicknessMm: 3, allowOffcuts: true },
    }),
  ],
  [
    'hw-dring',
    catalogItem({
      id: 'hw-dring',
      name: 'Подвес D-ring',
      group: 'HARDWARE',
      unit: 'PIECE',
      hardware: { perItem: 2, perPerimeterM: 0, packSize: 100 },
    }),
  ],
  [
    'hw-cord',
    catalogItem({
      id: 'hw-cord',
      name: 'Шнур подвесной',
      group: 'HARDWARE',
      unit: 'M',
      hardware: { perItem: 0, perPerimeterM: 0.5, packSize: 1 },
    }),
  ],
  [
    'srv-stretch',
    catalogItem({
      id: 'srv-stretch',
      name: 'Натяжка на пенокартон',
      group: 'MOUNTING',
      unit: 'PIECE',
      service: { standardMinutes: 15, minutesPerM2: 10, complexityFactor: 1 },
    }),
  ],
]);

describe('calculation engine — mats', () => {
  it('builds a single mat around the artwork', () => {
    const spec: FramingSpec = {
      artworkWidthMm: 300,
      artworkHeightMm: 400,
      mats: [
        {
          layer: 1,
          catalogItemId: 'mat-white',
          margins: { leftMm: 70, rightMm: 70, topMm: 70, bottomMm: 70 },
          overlapMm: 5,
        },
      ],
      glazing: { catalogItemId: 'glass-ar' },
    };

    const result = calculateFraming(spec, catalog);

    // The window swallows 5 mm of the artwork on each side.
    expect(result.sight).toEqual({ widthMm: 290, heightMm: 390 });
    expect(result.mats[0].opening).toEqual({ widthMm: 290, heightMm: 390 });
    // Outer = opening + margins on both sides.
    expect(result.sandwich).toEqual({ widthMm: 430, heightMm: 530 });
  });

  it('shrinks the opening of every lower layer by its reveal', () => {
    const spec: FramingSpec = {
      artworkWidthMm: 300,
      artworkHeightMm: 400,
      mats: [
        { layer: 1, catalogItemId: 'mat-white', margins: { leftMm: 60, rightMm: 60, topMm: 60, bottomMm: 80 } },
        { layer: 2, catalogItemId: 'mat-cream', revealMm: 5, overlapMm: 5 },
      ],
      glazing: { catalogItemId: 'glass-ar' },
    };

    const result = calculateFraming(spec, catalog);

    // Bottom layer window = artwork − 2 × overlap.
    expect(result.mats[1].opening).toEqual({ widthMm: 290, heightMm: 390 });
    // Top layer window is larger by 2 × reveal, exposing the cream strip.
    expect(result.mats[0].opening).toEqual({ widthMm: 300, heightMm: 400 });
    // Both layers are cut to the same outer size.
    expect(result.mats[0].outer).toEqual(result.mats[1].outer);
    expect(result.sandwich).toEqual({ widthMm: 420, heightMm: 540 });
    expect(result.mats[1].visibleBorder.leftMm).toBe(5);
  });

  it('supports asymmetric margins used for a weighted bottom', () => {
    const result = calculateFraming(
      {
        artworkWidthMm: 200,
        artworkHeightMm: 300,
        mats: [
          {
            layer: 1,
            catalogItemId: 'mat-white',
            margins: { leftMm: 50, rightMm: 50, topMm: 50, bottomMm: 70 },
            overlapMm: 0,
          },
        ],
        glazing: { catalogItemId: 'glass-ar' },
      },
      catalog,
    );

    expect(result.sandwich).toEqual({ widthMm: 300, heightMm: 420 });
  });

  it('caps the sandwich at seven mat layers', () => {
    const mats = Array.from({ length: 9 }, (_, index) => ({
      layer: index + 1,
      catalogItemId: 'mat-white',
      revealMm: 4,
      overlapMm: 5,
      margins: { leftMm: 50, rightMm: 50, topMm: 50, bottomMm: 50 },
    }));

    const result = calculateFraming(
      { artworkWidthMm: 300, artworkHeightMm: 400, mats, glazing: { catalogItemId: 'glass-ar' } },
      catalog,
    );

    expect(result.mats).toHaveLength(7);
    expect(result.warnings.some((w) => w.includes('7 слоёв'))).toBe(true);
  });
});

describe('calculation engine — frames', () => {
  it('derives rabbet opening, outer size and chop lengths', () => {
    const result = calculateFraming(
      {
        artworkWidthMm: 300,
        artworkHeightMm: 400,
        mats: [
          {
            layer: 1,
            catalogItemId: 'mat-white',
            margins: { leftMm: 70, rightMm: 70, topMm: 70, bottomMm: 70 },
            overlapMm: 5,
          },
        ],
        mouldings: [{ role: 'INNER', catalogItemId: 'mould-30' }],
        glazing: { catalogItemId: 'glass-ar' },
        backing: { catalogItemId: 'backing-hdf' },
        clearanceMm: 2,
      },
      catalog,
    );

    const frame = result.frames[0];
    expect(frame.opening).toEqual({ widthMm: 432, heightMm: 532 });
    expect(frame.outer).toEqual({ widthMm: 492, heightMm: 592 });
    expect(frame.pieces).toEqual([492, 492, 592, 592]);
    expect(frame.totalLengthMm).toBe(2168);
    // 2168 + 4 kerfs of 3 mm, then 10 % catalog waste.
    expect(frame.consumedLengthMm).toBe(Math.round((2168 + 12) * 1.1));
    expect(frame.cuts).toBe(4);
    expect(frame.joins).toBe(4);
    expect(result.outer).toEqual({ widthMm: 492, heightMm: 592 });
  });

  it('stacks an inner frame inside an outer frame', () => {
    const result = calculateFraming(
      {
        artworkWidthMm: 300,
        artworkHeightMm: 400,
        mouldings: [
          { role: 'OUTER', catalogItemId: 'mould-30' },
          { role: 'INNER', catalogItemId: 'mould-15' },
        ],
        glazing: { catalogItemId: 'glass-ar', position: 'BETWEEN' },
        clearanceMm: 2,
      },
      catalog,
    );

    expect(result.frames.map((frame) => frame.role)).toEqual(['INNER', 'OUTER']);
    const [inner, outer] = result.frames;
    expect(inner.opening).toEqual({ widthMm: 302, heightMm: 402 });
    expect(inner.outer).toEqual({ widthMm: 332, heightMm: 432 });
    expect(outer.opening).toEqual({ widthMm: 334, heightMm: 434 });
    expect(outer.outer).toEqual({ widthMm: 394, heightMm: 494 });
    // Glazing between the frames is cut to the outer frame rabbet.
    expect(result.glazing?.size).toEqual({ widthMm: 334, heightMm: 434 });
  });

  it('warns when the frame side is longer than a stick', () => {
    const result = calculateFraming(
      {
        artworkWidthMm: 3200,
        artworkHeightMm: 1000,
        mouldings: [{ role: 'INNER', catalogItemId: 'mould-30' }],
        glazing: { catalogItemId: 'glass-ar' },
      },
      catalog,
    );
    expect(result.warnings.some((w) => w.includes('длиннее хлыста'))).toBe(true);
  });
});

describe('calculation engine — sheets', () => {
  it('charges matboard by the area actually used plus waste', () => {
    const usage = sheetUsage(
      { widthMm: 405, heightMm: 610 },
      { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: true },
      0.15,
    );
    // Exactly a quarter of the sheet, plus the 15 % waste share.
    expect(usage.sheets).toBeCloseTo(0.2875, 4);
    expect(usage.fitsPerSheet).toBe(4);
  });

  it('charges a whole sheet when offcuts cannot be reused', () => {
    const usage = sheetUsage(
      { widthMm: 405, heightMm: 610 },
      { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: false },
      0.15,
    );
    expect(usage.sheets).toBe(0.25);
  });

  it('flags a piece that does not fit on any sheet', () => {
    const usage = sheetUsage(
      { widthMm: 900, heightMm: 1400 },
      { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: true },
      0,
    );
    expect(usage.oversized).toBe(true);
    expect(usage.sheets).toBeGreaterThanOrEqual(1);
  });

  it('accounts for rotation when fitting pieces on a sheet', () => {
    const sheet = { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4, allowOffcuts: true };
    expect(piecesPerSheet({ widthMm: 1200, heightMm: 400 }, sheet)).toBe(2);
    expect(piecesPerSheet({ widthMm: 400, heightMm: 1200 }, sheet)).toBe(2);
  });
});

describe('material engine', () => {
  const spec: FramingSpec = {
    artworkWidthMm: 300,
    artworkHeightMm: 400,
    mats: [
      {
        layer: 1,
        catalogItemId: 'mat-white',
        margins: { leftMm: 70, rightMm: 70, topMm: 70, bottomMm: 70 },
        overlapMm: 5,
      },
    ],
    mouldings: [{ role: 'INNER', catalogItemId: 'mould-30' }],
    glazing: { catalogItemId: 'glass-ar' },
    backing: { catalogItemId: 'backing-hdf' },
    hardware: [{ catalogItemId: 'hw-dring' }, { catalogItemId: 'hw-cord' }],
    mounting: { method: 'FOAM_MOUNT', catalogItemId: 'srv-stretch' },
    clearanceMm: 2,
  };

  it('produces one line per material with net and consumed quantities', () => {
    const calc = calculateFraming(spec, catalog);
    const lines = buildMaterialLines(spec, calc, catalog);

    const moulding = lines.find((line) => line.group === 'MOULDING');
    expect(moulding?.quantity).toBeCloseTo(2.168, 3);
    expect(moulding?.consumedQuantity).toBeCloseTo(2.398, 3);
    expect(moulding?.wasteQuantity).toBeGreaterThan(0);
    expect(moulding?.unit).toBe('M');

    const mat = lines.find((line) => line.group === 'MATBOARD');
    expect(mat?.consumedQuantity).toBeGreaterThan(mat!.quantity);

    const glazing = lines.find((line) => line.group === 'GLAZING');
    expect(glazing?.meta.size).toEqual({ widthMm: 430, heightMm: 530 });

    const dring = lines.find((line) => line.name.includes('D-ring'));
    expect(dring?.quantity).toBe(2);

    const cord = lines.find((line) => line.name.includes('Шнур'));
    // 0,5 m of cord per metre of the 2,168 m perimeter, rounded up to metres.
    expect(cord?.quantity).toBe(2);

    const mounting = lines.find((line) => line.role === 'MOUNTING');
    expect(mounting?.meta.minutes).toBeGreaterThan(15);
  });

  it('recomputes everything when a single dimension changes', () => {
    const first = calculateFraming(spec, catalog);
    const second = calculateFraming({ ...spec, artworkWidthMm: 400 }, catalog);

    expect(second.sandwich.widthMm - first.sandwich.widthMm).toBe(100);
    expect(second.frames[0].outer.widthMm - first.frames[0].outer.widthMm).toBe(100);
    expect(second.glazing!.areaM2).toBeGreaterThan(first.glazing!.areaM2);
  });

  it('warns when glazing is missing', () => {
    const result = calculateFraming({ artworkWidthMm: 300, artworkHeightMm: 400 }, catalog);
    expect(result.warnings).toContain('Остекление не выбрано.');
  });
});
