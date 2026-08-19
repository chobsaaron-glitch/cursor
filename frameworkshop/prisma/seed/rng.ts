/** Deterministic PRNG so the demo database is identical on every machine. */
export function createRng(seed: number) {
  let state = seed >>> 0;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length) % values.length];
}

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function intBetween(rng: () => number, min: number, max: number): number {
  return Math.floor(between(rng, min, max + 1));
}
