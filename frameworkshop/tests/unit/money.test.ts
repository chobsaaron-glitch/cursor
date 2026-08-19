import { describe, expect, it } from 'vitest';
import {
  allocate,
  marginPercent,
  multiply,
  parseMoney,
  percentOf,
  roubles,
  roundTo,
  roundUpTo,
  toRoubles,
} from '@/lib/money';

describe('money', () => {
  it('converts roubles to kopecks without floating point drift', () => {
    expect(roubles(18500)).toBe(1_850_000);
    expect(roubles(0.1 + 0.2)).toBe(30);
    expect(roubles(1234.565)).toBe(123_457);
    expect(toRoubles(1_850_000)).toBe(18500);
  });

  it('parses russian money input', () => {
    expect(parseMoney('18 500,00 ₽')).toBe(1_850_000);
    expect(parseMoney('18500.5')).toBe(1_850_050);
    expect(parseMoney('1\u00a0250,40')).toBe(125_040);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
    expect(parseMoney('чепуха')).toBe(0);
  });

  it('multiplies and rounds half away from zero', () => {
    expect(multiply(100, 2.5)).toBe(250);
    expect(multiply(101, 0.5)).toBe(51);
    expect(multiply(-101, 0.5)).toBe(-51);
    expect(percentOf(1_000_000, 20)).toBe(200_000);
  });

  it('rounds to a step', () => {
    expect(roundTo(123_456, 100)).toBe(123_500);
    expect(roundTo(123_449, 100)).toBe(123_400);
    expect(roundUpTo(123_401, 100)).toBe(123_500);
    expect(roundTo(1234, 1)).toBe(1234);
  });

  it('allocates an amount without losing kopecks', () => {
    const parts = allocate(1000, [1, 1, 1]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(1000);
    expect(parts).toEqual([334, 333, 333]);

    const weighted = allocate(10_000, [3, 7]);
    expect(weighted).toEqual([3000, 7000]);
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
  });

  it('computes margin percent against the selling price', () => {
    expect(marginPercent(1_850_000, 810_000)).toBe(56.22);
    expect(marginPercent(0, 100)).toBe(0);
  });
});
