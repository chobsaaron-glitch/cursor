import { describe, expect, it } from 'vitest';
import {
  aggregatePrices,
  calculatePrice,
  lookupMatrix,
  PricingError,
  type PricingInput,
} from '@/server/modules/pricing/engine';
import { roubles } from '@/lib/money';

const base: PricingInput = {
  quantity: 1,
  unitCost: roubles(1000),
  rule: { method: 'COST_MULTIPLIER', factor: 3, roundTo: 0 },
};

describe('pricing engine — methods', () => {
  it('cost × multiplier', () => {
    const result = calculatePrice(base);
    expect(result.cost).toBe(roubles(1000));
    expect(result.retailPrice).toBe(roubles(3000));
    expect(result.finalPrice).toBe(roubles(3000));
    expect(result.margin).toBe(roubles(2000));
    expect(result.marginPercent).toBeCloseTo(66.67, 2);
  });

  it('markup percent', () => {
    const result = calculatePrice({ ...base, rule: { method: 'MARKUP', factor: 150, roundTo: 0 } });
    expect(result.retailPrice).toBe(roubles(2500));
  });

  it('price per metre', () => {
    const result = calculatePrice({
      quantity: 3.24,
      unitCost: roubles(400),
      rule: { method: 'PER_METER', amount: roubles(1200), roundTo: 0 },
      dimensions: { lengthMm: 3240 },
    });
    expect(result.retailPrice).toBe(roubles(3888));
    expect(result.cost).toBe(roubles(1296));
  });

  it('chop adds a tariff per cut', () => {
    const result = calculatePrice({
      quantity: 3.24,
      unitCost: roubles(400),
      rule: { method: 'CHOP', amount: roubles(1200), chopPrice: roubles(50), roundTo: 0 },
      dimensions: { lengthMm: 3240, cuts: 4 },
    });
    expect(result.retailPrice).toBe(roubles(3888 + 200));
  });

  it('join adds cut and corner tariffs', () => {
    const result = calculatePrice({
      quantity: 3.24,
      unitCost: roubles(400),
      rule: {
        method: 'JOIN',
        amount: roubles(1200),
        chopPrice: roubles(50),
        joinPrice: roubles(75),
        roundTo: 0,
      },
      dimensions: { lengthMm: 3240, cuts: 4, joins: 4 },
    });
    expect(result.retailPrice).toBe(roubles(3888 + 200 + 300));
  });

  it('join can mark up the actual cost of the stick instead of a flat metre rate', () => {
    const result = calculatePrice({
      quantity: 3.24,
      unitCost: roubles(400),
      rule: {
        method: 'JOIN',
        factor: 2.5,
        chopPrice: roubles(50),
        joinPrice: roubles(75),
        roundTo: 0,
      },
      dimensions: { lengthMm: 3240, cuts: 4, joins: 4 },
    });
    // 3.24 m × 400 ₽ = 1296 ₽ of material, ×2.5, plus 4 cuts and 4 corners.
    expect(result.retailPrice).toBe(roubles(3240 + 200 + 300));
    expect(result.margin).toBeGreaterThan(0);
  });

  it('the cost floor keeps flat tariffs from selling premium material at a loss', () => {
    const museumGlass = {
      quantity: 0.2666,
      unitCost: roubles(8735),
      dimensions: { areaM2: 0.2666 },
      roundTo: 0,
    };

    const unguarded = calculatePrice({
      ...museumGlass,
      rule: { method: 'PER_AREA', amount: roubles(3200), roundTo: 0 },
    });
    expect(unguarded.margin).toBeLessThan(0);

    const guarded = calculatePrice({
      ...museumGlass,
      rule: { method: 'PER_AREA', amount: roubles(3200), minMarkup: 2.2, roundTo: 0 },
    });
    expect(guarded.retailPrice).toBe(Math.round(guarded.cost * 2.2));
    expect(guarded.marginPercent).toBeGreaterThan(50);
    expect(guarded.notes.join(' ')).toContain('минимальной наценки');
  });

  it('the cost floor leaves an already profitable price untouched', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: roubles(100),
      rule: { method: 'PER_AREA', amount: roubles(1000), minMarkup: 2, roundTo: 0 },
      dimensions: { areaM2: 1 },
    });
    expect(result.retailPrice).toBe(roubles(1000));
    expect(result.notes).toHaveLength(0);
  });

  it('price per square metre', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: roubles(300),
      rule: { method: 'PER_AREA', amount: roubles(2400), roundTo: 0 },
      dimensions: { areaM2: 0.5525 },
    });
    expect(result.retailPrice).toBe(roubles(1326));
  });

  it('united inch pricing', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: 0,
      rule: { method: 'UNITED_INCH', amount: roubles(120), roundTo: 0 },
      dimensions: { unitedInches: 59.0551 },
    });
    expect(result.retailPrice).toBe(roubles(59.0551 * 120));
  });

  it('per piece and fixed price', () => {
    expect(
      calculatePrice({
        quantity: 4,
        unitCost: roubles(15),
        rule: { method: 'PER_PIECE', amount: roubles(60), roundTo: 0 },
      }).retailPrice,
    ).toBe(roubles(240));

    expect(
      calculatePrice({ quantity: 1, unitCost: 0, rule: { method: 'FIXED', amount: roubles(950), roundTo: 0 } })
        .retailPrice,
    ).toBe(roubles(950));
  });

  it('formula pricing works on roubles and returns kopecks', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: roubles(1200),
      rule: {
        method: 'FORMULA',
        formulaExpression: 'IF(cost < 1000, cost * 4.5, IF(cost < 5000, cost * 3.8, cost * 3.2))',
        roundTo: 0,
      },
    });
    expect(result.retailPrice).toBe(roubles(4560));
  });

  it('fails loudly when a rule is incomplete', () => {
    expect(() => calculatePrice({ ...base, rule: { method: 'FORMULA' } })).toThrow(PricingError);
    expect(() => calculatePrice({ ...base, rule: { method: 'MATRIX' } })).toThrow(PricingError);
  });
});

describe('pricing engine — matrix', () => {
  const matrix = {
    axis: 'SIZE' as const,
    roundUp: true,
    cells: [
      { widthMm: 200, heightMm: 300, price: roubles(1500) },
      { widthMm: 300, heightMm: 400, price: roubles(2200) },
      { widthMm: 400, heightMm: 500, price: roubles(3200) },
      { widthMm: 500, heightMm: 700, price: roubles(4500) },
    ],
  };

  it('matches an exact size regardless of orientation', () => {
    expect(lookupMatrix(matrix, { widthMm: 300, heightMm: 400 })).toBe(roubles(2200));
    expect(lookupMatrix(matrix, { widthMm: 400, heightMm: 300 })).toBe(roubles(2200));
  });

  it('rounds up to the nearest larger cell', () => {
    expect(lookupMatrix(matrix, { widthMm: 320, heightMm: 420 })).toBe(roubles(3200));
    expect(lookupMatrix(matrix, { widthMm: 150, heightMm: 150 })).toBe(roubles(1500));
  });

  it('returns null when nothing fits and rounding is off', () => {
    expect(lookupMatrix({ ...matrix, roundUp: false }, { widthMm: 320, heightMm: 420 })).toBeNull();
    expect(lookupMatrix(matrix, { widthMm: 900, heightMm: 900 })).toBeNull();
  });

  it('supports a united-inch axis with upper bounds', () => {
    const uiMatrix = {
      axis: 'UNITED_INCH' as const,
      roundUp: true,
      cells: [
        { upTo: 30, price: roubles(900) },
        { upTo: 60, price: roubles(1800) },
        { upTo: 100, price: roubles(3000) },
      ],
    };
    expect(lookupMatrix(uiMatrix, { unitedInches: 25 })).toBe(roubles(900));
    expect(lookupMatrix(uiMatrix, { unitedInches: 59 })).toBe(roubles(1800));
    expect(lookupMatrix(uiMatrix, { unitedInches: 250 })).toBe(roubles(3000));
  });

  it('falls back to a cost multiplier when the matrix has no match', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: roubles(1000),
      rule: { method: 'MATRIX', matrix: { ...matrix, roundUp: false }, roundTo: 0 },
      dimensions: { widthMm: 320, heightMm: 420 },
    });
    expect(result.retailPrice).toBe(roubles(3000));
    expect(result.notes.join()).toContain('матрицы не найдена');
  });
});

describe('pricing engine — minimums, rounding, discount, tax', () => {
  it('applies the minimum charge before rounding', () => {
    const result = calculatePrice({
      quantity: 0.2,
      unitCost: roubles(100),
      rule: { method: 'PER_METER', amount: roubles(500), minPrice: roubles(350), roundTo: 100 },
      dimensions: { lengthMm: 200 },
    });
    expect(result.retailPrice).toBe(roubles(350));
    expect(result.notes.join()).toContain('минимальная стоимость');
  });

  it('rounds to whole roubles', () => {
    const result = calculatePrice({
      quantity: 1,
      unitCost: roubles(333.33),
      rule: { method: 'COST_MULTIPLIER', factor: 3, roundTo: 100 },
    });
    expect(result.retailPrice % 100).toBe(0);
  });

  it('applies percent and absolute discounts, never below zero', () => {
    const result = calculatePrice({ ...base, discountPercent: 10, discountAmount: roubles(100) });
    expect(result.discount).toBe(roubles(400));
    expect(result.net).toBe(roubles(2600));

    const clamped = calculatePrice({ ...base, discountAmount: roubles(99999) });
    expect(clamped.net).toBe(0);
    expect(clamped.finalPrice).toBe(0);
  });

  it('adds VAT on top of the discounted amount', () => {
    const result = calculatePrice({ ...base, taxPercent: 20 });
    expect(result.net).toBe(roubles(3000));
    expect(result.tax).toBe(roubles(600));
    expect(result.finalPrice).toBe(roubles(3600));
  });

  it('extracts VAT when the price already includes it', () => {
    const result = calculatePrice({ ...base, taxPercent: 20, taxIncluded: true });
    expect(result.net + result.tax).toBe(roubles(3000));
    expect(result.tax).toBe(roubles(500));
  });

  it('honours an explicit retail price over the rule', () => {
    const result = calculatePrice({ ...base, quantity: 3, unitRetailPrice: roubles(1500) });
    expect(result.retailPrice).toBe(roubles(4500));
  });

  it('charges cost on the consumed quantity, not the net one', () => {
    const result = calculatePrice({
      quantity: 3.18,
      consumedQuantity: 3.6,
      unitCost: roubles(500),
      rule: { method: 'PER_METER', amount: roubles(1500), roundTo: 0 },
      dimensions: { lengthMm: 3180 },
    });
    expect(result.cost).toBe(roubles(1800));
    expect(result.retailPrice).toBe(roubles(4770));
  });
});

describe('pricing engine — aggregation', () => {
  it('sums component results into work item totals', () => {
    const results = [
      calculatePrice({ quantity: 1, unitCost: roubles(500), rule: { method: 'COST_MULTIPLIER', factor: 3, roundTo: 0 } }),
      calculatePrice({ quantity: 1, unitCost: roubles(300), rule: { method: 'COST_MULTIPLIER', factor: 4, roundTo: 0 } }),
      calculatePrice({
        quantity: 1,
        unitCost: roubles(200),
        rule: { method: 'FIXED', amount: roubles(1000), roundTo: 0 },
        discountPercent: 10,
      }),
    ];

    const total = aggregatePrices(results);
    expect(total.cost).toBe(roubles(1000));
    expect(total.subtotal).toBe(roubles(1500 + 1200 + 1000));
    expect(total.discount).toBe(roubles(100));
    expect(total.total).toBe(roubles(3600));
    expect(total.margin).toBe(roubles(2600));
    expect(total.marginPercent).toBeCloseTo(72.22, 2);
  });
});
