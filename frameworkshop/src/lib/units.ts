/**
 * Millimetres are the single storage unit for every dimension in the system.
 * Anything the user types — centimetres, fractional inches — is converted here.
 */

export type LengthUnit = 'mm' | 'cm' | 'm' | 'in';

const MM_PER_UNIT: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export function toMm(value: number, unit: LengthUnit): number {
  return value * MM_PER_UNIT[unit];
}

export function fromMm(mm: number, unit: LengthUnit): number {
  return mm / MM_PER_UNIT[unit];
}

const UNIT_ALIASES: Record<string, LengthUnit> = {
  мм: 'mm',
  mm: 'mm',
  см: 'cm',
  cm: 'cm',
  м: 'm',
  m: 'm',
  '"': 'in',
  '″': 'in',
  in: 'in',
  inch: 'in',
  дюйм: 'in',
};

/**
 * Parses a user-entered dimension.
 *
 *   "450"        → 450 mm (default unit)
 *   "45 см"      → 450 mm
 *   "17 3/4\""   → 450,85 mm
 *   "1,5 m"      → 1500 mm
 */
export function parseLength(input: string | number, defaultUnit: LengthUnit = 'mm'): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? toMm(input, defaultUnit) : null;

  const raw = input.trim().toLowerCase().replace(/\u00a0/g, ' ');
  if (!raw) return null;

  let unit = defaultUnit;
  let body = raw;

  for (const [alias, resolved] of Object.entries(UNIT_ALIASES)) {
    if (body.endsWith(alias)) {
      unit = resolved;
      body = body.slice(0, body.length - alias.length).trim();
      break;
    }
  }

  const value = parseNumberWithFraction(body);
  if (value === null) return null;
  return round1(toMm(value, unit));
}

/** Understands "17 3/4", "3/4" and "17,75". */
export function parseNumberWithFraction(input: string): number | null {
  const body = input.replace(',', '.').trim();
  if (!body) return null;

  const mixed = body.match(/^(-?\d+)\s+(\d+)\s*\/\s*(\d+)$/);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    const fraction = numerator / denominator;
    return whole < 0 ? whole - fraction : whole + fraction;
  }

  const simple = body.match(/^(-?\d+)\s*\/\s*(\d+)$/);
  if (simple) {
    const denominator = Number(simple[2]);
    if (denominator === 0) return null;
    return Number(simple[1]) / denominator;
  }

  const plain = Number.parseFloat(body);
  return Number.isFinite(plain) ? plain : null;
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Rounds a material quantity to 0,0001 — the precision the ledger stores. */
export function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export function mmToM(mm: number): number {
  return round4(mm / 1000);
}

export function areaM2(widthMm: number, heightMm: number): number {
  return round4((widthMm * heightMm) / 1_000_000);
}

export function perimeterMm(widthMm: number, heightMm: number): number {
  return 2 * (widthMm + heightMm);
}

/** United inches — width + height in inches, the classic framing price axis. */
export function unitedInches(widthMm: number, heightMm: number): number {
  return round4(fromMm(widthMm, 'in') + fromMm(heightMm, 'in'));
}
