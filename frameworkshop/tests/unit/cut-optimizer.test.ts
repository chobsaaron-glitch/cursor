import { describe, expect, it } from 'vitest';
import { optimizeBatch, optimizeCuts, type CutPiece } from '@/server/modules/production/cut-optimizer';

function frame(prefix: string, widthMm: number, heightMm: number, catalogItemId = 'mould-a'): CutPiece[] {
  return [
    { label: `${prefix} верх`, lengthMm: widthMm, catalogItemId, workItemId: prefix },
    { label: `${prefix} низ`, lengthMm: widthMm, catalogItemId, workItemId: prefix },
    { label: `${prefix} лево`, lengthMm: heightMm, catalogItemId, workItemId: prefix },
    { label: `${prefix} право`, lengthMm: heightMm, catalogItemId, workItemId: prefix },
  ];
}

describe('cut optimiser', () => {
  it('places one frame on a single stick and reports the offcut', () => {
    const result = optimizeCuts(frame('250154-1', 840, 640), { stickLengthMm: 3050, kerfMm: 3 });

    expect(result.stickCount).toBe(1);
    expect(result.sticks[0].pieces.map((piece) => piece.lengthMm)).toEqual([840, 840, 640, 640]);
    expect(result.sticks[0].usedMm).toBe(2960);
    expect(result.sticks[0].wasteMm).toBe(90);
    expect(result.wastePercent).toBeGreaterThan(0);
  });

  it('combines several orders into a shared cutting plan', () => {
    const pieces = [
      ...frame('101', 800, 600),
      ...frame('102', 500, 400),
      ...frame('103', 300, 300),
      ...frame('104', 1200, 900),
    ];

    const naiveSticks = 4; // one stick per order without optimisation
    const result = optimizeCuts(pieces, { stickLengthMm: 3050, kerfMm: 3 });

    expect(result.unplaced).toHaveLength(0);
    expect(result.sticks.reduce((acc, stick) => acc + stick.pieces.length, 0)).toBe(pieces.length);
    expect(result.stickCount).toBeLessThan(naiveSticks + 2);
    expect(result.usedMm).toBe(pieces.reduce((acc, piece) => acc + piece.lengthMm, 0));
  });

  it('never packs more than the stick can hold, kerf included', () => {
    const result = optimizeCuts(frame('x', 1500, 1500), { stickLengthMm: 3050, kerfMm: 10 });
    for (const stick of result.sticks) {
      const consumed = stick.pieces.reduce((acc, piece) => acc + piece.lengthMm + 10, 0);
      expect(consumed).toBeLessThanOrEqual(stick.lengthMm);
    }
  });

  it('consumes offcuts from stock before opening a new stick', () => {
    const result = optimizeCuts(frame('y', 900, 500), {
      stickLengthMm: 3050,
      kerfMm: 3,
      offcutsMm: [1000, 1000],
    });

    expect(result.sticks.some((stick) => stick.fromOffcut)).toBe(true);
    expect(result.stickCount).toBeLessThanOrEqual(1);
  });

  it('reports pieces that cannot fit any stick', () => {
    const result = optimizeCuts(frame('huge', 4000, 500), { stickLengthMm: 3050, kerfMm: 3 });
    expect(result.unplaced).toHaveLength(2);
    expect(result.unplaced.every((piece) => piece.lengthMm === 4000)).toBe(true);
  });

  it('marks long remainders as reusable rather than waste', () => {
    const result = optimizeCuts(frame('z', 500, 400), {
      stickLengthMm: 3050,
      kerfMm: 3,
      reusableFromMm: 150,
    });
    expect(result.reusableMm).toBeGreaterThan(1000);
    expect(result.wastePercent).toBeLessThan(5);
  });

  it('splits a batch by article', () => {
    const plans = optimizeBatch(
      [...frame('a', 800, 600, 'mould-a'), ...frame('b', 800, 600, 'mould-b')],
      new Map([['mould-b', { stickLengthMm: 2400, kerfMm: 3 }]]),
      { stickLengthMm: 3050, kerfMm: 3 },
    );

    expect(plans).toHaveLength(2);
    const b = plans.find((plan) => plan.catalogItemId === 'mould-b');
    expect(b?.sticks.every((stick) => stick.lengthMm === 2400)).toBe(true);
  });

  it('is deterministic', () => {
    const pieces = [...frame('1', 700, 500), ...frame('2', 640, 480), ...frame('3', 900, 300)];
    const first = optimizeCuts(pieces, { stickLengthMm: 3050, kerfMm: 3 });
    const second = optimizeCuts(pieces, { stickLengthMm: 3050, kerfMm: 3 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
