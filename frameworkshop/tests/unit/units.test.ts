import { describe, expect, it } from 'vitest';
import {
  areaM2,
  fromMm,
  parseLength,
  parseNumberWithFraction,
  perimeterMm,
  round4,
  toMm,
  unitedInches,
} from '@/lib/units';

describe('units', () => {
  it('converts between units', () => {
    expect(toMm(45, 'cm')).toBe(450);
    expect(toMm(1.5, 'm')).toBe(1500);
    expect(toMm(1, 'in')).toBe(25.4);
    expect(fromMm(450, 'cm')).toBe(45);
    expect(round4(fromMm(450, 'in'))).toBe(17.7165);
  });

  it('parses fractions', () => {
    expect(parseNumberWithFraction('17 3/4')).toBe(17.75);
    expect(parseNumberWithFraction('3/4')).toBe(0.75);
    expect(parseNumberWithFraction('17,75')).toBe(17.75);
    expect(parseNumberWithFraction('1/0')).toBeNull();
    expect(parseNumberWithFraction('')).toBeNull();
  });

  it('parses user-entered dimensions with a unit suffix', () => {
    expect(parseLength('450')).toBe(450);
    expect(parseLength('45 см')).toBe(450);
    expect(parseLength('45cm')).toBe(450);
    expect(parseLength('1,5 м')).toBe(1500);
    expect(parseLength('17 3/4"')).toBe(450.9);
    expect(parseLength('12', 'cm')).toBe(120);
    expect(parseLength('не число')).toBeNull();
  });

  it('computes derived geometry', () => {
    expect(areaM2(650, 850)).toBe(0.5525);
    expect(perimeterMm(650, 850)).toBe(3000);
    expect(unitedInches(650, 850)).toBeCloseTo(59.0551, 3);
  });
});
