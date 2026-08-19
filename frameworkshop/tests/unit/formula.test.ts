import { describe, expect, it } from 'vitest';
import {
  collectVariables,
  evaluateFormula,
  formulaToString,
  FormulaError,
  parseFormula,
  validateFormula,
} from '@/server/modules/pricing/formula';

const context = {
  cost: 1000,
  quantity: 2,
  length: 3.24,
  area: 0.55,
  width: 650,
  height: 850,
  perimeter: 3,
  unitedInch: 59,
  cuts: 4,
  joins: 4,
  minutes: 25,
};

describe('formula engine', () => {
  it('evaluates arithmetic with correct precedence', () => {
    expect(evaluateFormula('2 + 2 * 2', context)).toBe(6);
    expect(evaluateFormula('(2 + 2) * 2', context)).toBe(8);
    expect(evaluateFormula('2 ^ 3 ^ 2', context)).toBe(512);
    expect(evaluateFormula('-3 + 5', context)).toBe(2);
    expect(evaluateFormula('10 % 3', context)).toBe(1);
  });

  it('resolves variables and their russian aliases', () => {
    expect(evaluateFormula('cost * 3', context)).toBe(3000);
    expect(evaluateFormula('Себестоимость * 3', context)).toBe(3000);
    expect(evaluateFormula('length * 250', context)).toBe(810);
    expect(evaluateFormula('UI * 15', context)).toBe(885);
  });

  it('evaluates the tiered pricing example from the specification', () => {
    const expression = `IF(cost < 1000,
       cost * 4.5,
       IF(cost < 5000,
          cost * 3.8,
          cost * 3.2
       )
    )`;

    expect(evaluateFormula(expression, { ...context, cost: 800 })).toBeCloseTo(3600);
    expect(evaluateFormula(expression, { ...context, cost: 2000 })).toBeCloseTo(7600);
    expect(evaluateFormula(expression, { ...context, cost: 9000 })).toBeCloseTo(28_800);
  });

  it('supports comparison, logic and functions', () => {
    expect(evaluateFormula('IF(width > 500 AND height > 800, 100, 50)', context)).toBe(100);
    expect(evaluateFormula('IF(width > 5000 OR height > 800, 100, 50)', context)).toBe(100);
    expect(evaluateFormula('IF(NOT (width > 5000), 1, 0)', context)).toBe(1);
    expect(evaluateFormula('MIN(3, 7, 1)', context)).toBe(1);
    expect(evaluateFormula('MAX(3, 7, 1)', context)).toBe(7);
    expect(evaluateFormula('ROUND(3.14159, 2)', context)).toBe(3.14);
    expect(evaluateFormula('ROUNDUP(3.001, 0)', context)).toBe(4);
    expect(evaluateFormula('ROUNDDOWN(3.999, 0)', context)).toBe(3);
    expect(evaluateFormula('ABS(0 - 5)', context)).toBe(5);
    expect(evaluateFormula('SQRT(16)', context)).toBe(4);
    expect(evaluateFormula('length >= 3', context)).toBe(1);
    expect(evaluateFormula('length <> 3.24', context)).toBe(0);
  });

  it('short-circuits AND so a guarded division never throws', () => {
    expect(evaluateFormula('IF(quantity > 5 AND 100 / (quantity - 2) > 1, 1, 0)', { ...context, quantity: 2 })).toBe(0);
  });

  it('rejects unknown identifiers, functions and malformed input', () => {
    expect(() => evaluateFormula('unknownVar * 2', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('HACK(1)', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('cost *', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('(cost * 2', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('cost / 0', context)).toThrow(/Деление на ноль/);
    expect(() => evaluateFormula('', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('IF(1, 2)', context)).toThrow(/от 3 до 3/);
  });

  it('never executes host code', () => {
    expect(() => evaluateFormula('process.exit(1)', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('constructor', context)).toThrow(FormulaError);
    expect(() => evaluateFormula('globalThis', context)).toThrow(FormulaError);
  });

  it('reports the variables a formula depends on', () => {
    const result = validateFormula('IF(cost < 1000, cost * 4.5, area * 500)');
    expect(result.valid).toBe(true);
    expect(result.variables.sort()).toEqual(['area', 'cost']);

    const broken = validateFormula('cost * ');
    expect(broken.valid).toBe(false);
    expect(broken.error).toBeTruthy();
  });

  it('round-trips an AST through text', () => {
    const ast = parseFormula('IF(cost < 1000, cost * 4.5, cost * 3.2)');
    const text = formulaToString(ast);
    expect(evaluateFormula(text, { ...context, cost: 500 })).toBe(2250);
    expect(collectVariables(ast)).toEqual(['cost']);
  });
});
