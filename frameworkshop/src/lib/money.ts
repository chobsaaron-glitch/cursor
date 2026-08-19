/**
 * Money is always an integer number of kopecks. Floating point roubles are
 * never allowed to reach the database: every amount that comes from a form or
 * an import is converted here exactly once.
 */

export type Kopecks = number;

const KOPECKS_IN_ROUBLE = 100;

export function roubles(value: number): Kopecks {
  return Math.round(value * KOPECKS_IN_ROUBLE);
}

export function toRoubles(value: Kopecks): number {
  return value / KOPECKS_IN_ROUBLE;
}

/** Parses "18 500,00", "18500.5", "18 500 ₽" into kopecks. */
export function parseMoney(input: string | number | null | undefined): Kopecks {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return roubles(input);
  const normalised = input
    .replace(/\u00a0/g, '')
    .replace(/[₽\s]/g, '')
    .replace(',', '.');
  const parsed = Number.parseFloat(normalised);
  return Number.isFinite(parsed) ? roubles(parsed) : 0;
}

/** Multiplies an amount by a factor and rounds half away from zero. */
export function multiply(amount: Kopecks, factor: number): Kopecks {
  const result = amount * factor;
  return result < 0 ? -Math.round(-result) : Math.round(result);
}

export function percentOf(amount: Kopecks, percent: number): Kopecks {
  return multiply(amount, percent / 100);
}

export function sum(values: Kopecks[]): Kopecks {
  return values.reduce((acc, value) => acc + value, 0);
}

/** Rounds to a step expressed in kopecks (100 → whole roubles). */
export function roundTo(amount: Kopecks, step: number): Kopecks {
  if (!step || step <= 1) return Math.round(amount);
  return Math.round(amount / step) * step;
}

export function roundUpTo(amount: Kopecks, step: number): Kopecks {
  if (!step || step <= 1) return Math.ceil(amount);
  return Math.ceil(amount / step) * step;
}

/**
 * Splits an amount between shares without losing a single kopeck — the
 * remainder is handed to the largest shares first.
 */
export function allocate(amount: Kopecks, weights: number[]): Kopecks[] {
  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight <= 0) return weights.map(() => 0);

  const raw = weights.map((w) => (amount * w) / totalWeight);
  const floored = raw.map((value) => Math.floor(value));
  let remainder = amount - floored.reduce((acc, value) => acc + value, 0);

  const order = raw
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (const entry of order) {
    if (remainder <= 0) break;
    floored[entry.index] += 1;
    remainder -= 1;
  }
  return floored;
}

export function marginPercent(price: Kopecks, cost: Kopecks): number {
  if (price === 0) return 0;
  return round2(((price - cost) / price) * 100);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
