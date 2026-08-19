/**
 * Moulding cut optimiser.
 *
 * Packs the mitred pieces of one or many work items into full sticks so that
 * the offcut is as short as possible. First-Fit-Decreasing gives a solution
 * within a few percent of optimal for the piece counts a workshop deals with,
 * and it is deterministic — the same input always produces the same cut card.
 */

export interface CutPiece {
  /** Identifier printed on the cut card, e.g. "250154-1 низ". */
  label: string;
  lengthMm: number;
  workItemId?: string | null;
  catalogItemId: string;
}

export interface CutOptimizerOptions {
  /** Length of one stick as delivered. */
  stickLengthMm: number;
  /** Material eaten by every saw pass. */
  kerfMm?: number;
  /** Unusable length at the beginning of a stick. */
  trimMm?: number;
  /** Offcuts at least this long are reported as reusable, not as waste. */
  reusableFromMm?: number;
  /** Offcuts already in stock that should be consumed first. */
  offcutsMm?: number[];
}

export interface CutStick {
  seq: number;
  catalogItemId: string;
  lengthMm: number;
  usedMm: number;
  wasteMm: number;
  /** True when this stick is an offcut taken from stock. */
  fromOffcut: boolean;
  reusableRemainderMm: number;
  pieces: Array<{ seq: number; label: string; lengthMm: number; workItemId?: string | null }>;
}

export interface CutPlanResult {
  catalogItemId: string;
  sticks: CutStick[];
  stickCount: number;
  totalLengthMm: number;
  usedMm: number;
  wasteMm: number;
  reusableMm: number;
  wastePercent: number;
  unplaced: CutPiece[];
}

const DEFAULTS = {
  kerfMm: 3,
  trimMm: 0,
  reusableFromMm: 150,
};

/** Optimises one moulding article. */
export function optimizeCuts(pieces: CutPiece[], options: CutOptimizerOptions): CutPlanResult {
  const kerf = options.kerfMm ?? DEFAULTS.kerfMm;
  const trim = options.trimMm ?? DEFAULTS.trimMm;
  const reusableFrom = options.reusableFromMm ?? DEFAULTS.reusableFromMm;
  const catalogItemId = pieces[0]?.catalogItemId ?? '';

  const sorted = [...pieces].sort((a, b) => b.lengthMm - a.lengthMm);
  const unplaced: CutPiece[] = [];

  const bins: Array<{
    lengthMm: number;
    remaining: number;
    fromOffcut: boolean;
    pieces: CutPiece[];
  }> = (options.offcutsMm ?? [])
    .slice()
    .sort((a, b) => a - b)
    .map((length) => ({ lengthMm: length, remaining: length - trim, fromOffcut: true, pieces: [] }));

  for (const piece of sorted) {
    const required = piece.lengthMm + kerf;

    if (piece.lengthMm + kerf > options.stickLengthMm - trim) {
      const fitsOffcut = bins.some((bin) => bin.fromOffcut && bin.lengthMm - trim >= required);
      if (!fitsOffcut) {
        unplaced.push(piece);
        continue;
      }
    }

    // Best fit: the bin that ends up with the smallest remainder, offcuts first.
    let target: (typeof bins)[number] | undefined;
    let bestRemainder = Number.POSITIVE_INFINITY;
    for (const bin of bins) {
      if (bin.remaining < required) continue;
      const remainder = bin.remaining - required;
      const better =
        remainder < bestRemainder ||
        (remainder === bestRemainder && bin.fromOffcut && !target?.fromOffcut);
      if (better) {
        bestRemainder = remainder;
        target = bin;
      }
    }

    if (!target) {
      target = {
        lengthMm: options.stickLengthMm,
        remaining: options.stickLengthMm - trim,
        fromOffcut: false,
        pieces: [],
      };
      bins.push(target);
    }

    target.remaining -= required;
    target.pieces.push(piece);
  }

  const usedBins = bins.filter((bin) => bin.pieces.length > 0);

  const sticks: CutStick[] = usedBins.map((bin, index) => {
    const usedMm = bin.pieces.reduce((acc, piece) => acc + piece.lengthMm, 0);
    const remainder = Math.round(bin.remaining);
    const reusableRemainderMm = remainder >= reusableFrom ? remainder : 0;
    return {
      seq: index + 1,
      catalogItemId,
      lengthMm: bin.lengthMm,
      usedMm: Math.round(usedMm),
      wasteMm: bin.lengthMm - Math.round(usedMm),
      fromOffcut: bin.fromOffcut,
      reusableRemainderMm,
      pieces: bin.pieces.map((piece, pieceIndex) => ({
        seq: pieceIndex + 1,
        label: piece.label,
        lengthMm: piece.lengthMm,
        workItemId: piece.workItemId ?? null,
      })),
    };
  });

  const totalLengthMm = sticks.reduce((acc, stick) => acc + stick.lengthMm, 0);
  const usedMm = sticks.reduce((acc, stick) => acc + stick.usedMm, 0);
  const reusableMm = sticks.reduce((acc, stick) => acc + stick.reusableRemainderMm, 0);
  const wasteMm = totalLengthMm - usedMm;

  return {
    catalogItemId,
    sticks,
    stickCount: sticks.filter((stick) => !stick.fromOffcut).length,
    totalLengthMm,
    usedMm,
    wasteMm,
    reusableMm,
    wastePercent: totalLengthMm > 0 ? Math.round(((wasteMm - reusableMm) / totalLengthMm) * 1000) / 10 : 0,
    unplaced,
  };
}

/** Optimises a batch that spans several articles — one plan per article. */
export function optimizeBatch(
  pieces: CutPiece[],
  optionsByItem: Map<string, CutOptimizerOptions>,
  fallback: CutOptimizerOptions,
): CutPlanResult[] {
  const groups = new Map<string, CutPiece[]>();
  for (const piece of pieces) {
    const bucket = groups.get(piece.catalogItemId);
    if (bucket) bucket.push(piece);
    else groups.set(piece.catalogItemId, [piece]);
  }

  return [...groups.entries()]
    .map(([catalogItemId, group]) => optimizeCuts(group, optionsByItem.get(catalogItemId) ?? fallback))
    .sort((a, b) => b.stickCount - a.stickCount);
}
