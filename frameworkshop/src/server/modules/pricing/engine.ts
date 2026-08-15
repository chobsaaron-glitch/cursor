/**
 * Pricing engine.
 *
 * Takes one component (already measured by the calculation engine) and returns
 * cost, retail price, discount, tax and margin. It never computes geometry and
 * never reads the database — everything it needs arrives in the input, which is
 * what makes it exhaustively unit-testable.
 */

import { marginPercent, multiply, round2, roundTo, roubles, toRoubles } from '@/lib/money';
import { evaluateFormula, type FormulaContext } from './formula';

export type PricingMethodName =
  | 'COST_MULTIPLIER'
  | 'MARKUP'
  | 'PER_METER'
  | 'CHOP'
  | 'JOIN'
  | 'PER_AREA'
  | 'UNITED_INCH'
  | 'PER_PIECE'
  | 'FIXED'
  | 'MATRIX'
  | 'FORMULA';

export type MatrixAxisName = 'SIZE' | 'UNITED_INCH' | 'AREA' | 'PERIMETER' | 'LENGTH';

export interface PricingMatrixCell {
  widthMm?: number | null;
  heightMm?: number | null;
  upTo?: number | null;
  /** kopecks */
  price: number;
}

export interface PricingMatrix {
  axis: MatrixAxisName;
  roundUp: boolean;
  cells: PricingMatrixCell[];
}

export interface PricingRule {
  method: PricingMethodName;
  /**
   * Multiplier (COST_MULTIPLIER), percent (MARKUP) or — for CHOP / JOIN — the
   * multiplier applied to material cost to obtain the base charge before the
   * per-cut and per-join tariffs.
   */
  factor?: number | null;
  /** Base tariff in kopecks — per metre, per m², per united inch, per piece… */
  amount?: number | null;
  chopPrice?: number | null;
  joinPrice?: number | null;
  minPrice?: number | null;
  /**
   * Cost floor: the retail price is never allowed below `cost * minMarkup`.
   * Flat tariffs (per m², matrices) would otherwise sell premium materials
   * such as museum glass at a loss.
   */
  minMarkup?: number | null;
  /** Rounding step in kopecks; 100 rounds to whole roubles. */
  roundTo?: number | null;
  formulaExpression?: string | null;
  matrix?: PricingMatrix | null;
}

export interface PricingDimensions {
  widthMm?: number;
  heightMm?: number;
  lengthMm?: number;
  areaM2?: number;
  perimeterMm?: number;
  unitedInches?: number;
  cuts?: number;
  joins?: number;
  minutes?: number;
}

export interface PricingInput {
  rule?: PricingRule | null;
  /** Quantity in the catalog unit of the component. */
  quantity: number;
  /** Purchase cost in kopecks per unit. */
  unitCost: number;
  /** Quantity actually taken from stock — cost is charged on this. */
  consumedQuantity?: number;
  /** Explicit retail price per unit; wins over the rule when provided. */
  unitRetailPrice?: number | null;
  dimensions?: PricingDimensions;
  discountPercent?: number;
  discountAmount?: number;
  /** VAT percent; 0 or undefined means "без НДС". */
  taxPercent?: number;
  /** When true the retail price already contains the tax. */
  taxIncluded?: boolean;
  /** Minimum charge in kopecks for this component. */
  minCharge?: number | null;
}

export interface PriceResult {
  /** What the workshop pays, in kopecks. */
  cost: number;
  /** Retail before discount, in kopecks. */
  retailPrice: number;
  discount: number;
  /** Retail after discount, tax excluded. */
  net: number;
  tax: number;
  /** What the customer pays. */
  finalPrice: number;
  margin: number;
  marginPercent: number;
  method: PricingMethodName;
  /** Non-fatal notes (fallbacks used, minimum applied…). */
  notes: string[];
}

export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

const DEFAULT_RULE: PricingRule = { method: 'COST_MULTIPLIER', factor: 3, roundTo: 100 };

function dimensionContext(input: PricingInput): FormulaContext {
  const dims = input.dimensions ?? {};
  const lengthM = dims.lengthMm !== undefined ? dims.lengthMm / 1000 : input.quantity;
  return {
    cost: toRoubles(input.unitCost * (input.consumedQuantity ?? input.quantity)),
    quantity: input.quantity,
    length: lengthM,
    area: dims.areaM2 ?? 0,
    width: dims.widthMm ?? 0,
    height: dims.heightMm ?? 0,
    perimeter: dims.perimeterMm ? dims.perimeterMm / 1000 : 0,
    unitedInch: dims.unitedInches ?? 0,
    cuts: dims.cuts ?? 0,
    joins: dims.joins ?? 0,
    minutes: dims.minutes ?? 0,
  };
}

export function lookupMatrix(matrix: PricingMatrix, dims: PricingDimensions): number | null {
  if (matrix.cells.length === 0) return null;

  if (matrix.axis === 'SIZE') {
    const width = dims.widthMm ?? 0;
    const height = dims.heightMm ?? 0;
    // Orientation must not matter: 30×40 and 40×30 are the same cell.
    const shortSide = Math.min(width, height);
    const longSide = Math.max(width, height);

    const candidates = matrix.cells
      .filter((cell) => cell.widthMm != null && cell.heightMm != null)
      .map((cell) => ({
        cell,
        short: Math.min(cell.widthMm!, cell.heightMm!),
        long: Math.max(cell.widthMm!, cell.heightMm!),
      }));

    const exact = candidates.find(
      (candidate) => candidate.short === shortSide && candidate.long === longSide,
    );
    if (exact) return exact.cell.price;
    if (!matrix.roundUp) return null;

    const fitting = candidates
      .filter((candidate) => candidate.short >= shortSide && candidate.long >= longSide)
      .sort((a, b) => a.short * a.long - b.short * b.long);
    return fitting.length > 0 ? fitting[0].cell.price : null;
  }

  const value =
    matrix.axis === 'UNITED_INCH'
      ? dims.unitedInches ?? 0
      : matrix.axis === 'AREA'
        ? dims.areaM2 ?? 0
        : matrix.axis === 'PERIMETER'
          ? (dims.perimeterMm ?? 0) / 1000
          : (dims.lengthMm ?? 0) / 1000;

  const sorted = matrix.cells
    .filter((cell) => cell.upTo != null)
    .sort((a, b) => (a.upTo ?? 0) - (b.upTo ?? 0));

  for (const cell of sorted) {
    if (value <= (cell.upTo ?? 0)) return cell.price;
  }
  return matrix.roundUp && sorted.length > 0 ? sorted[sorted.length - 1].price : null;
}

/**
 * Material charge underlying chop and join pricing. Workshops either resell the
 * moulding at a flat tariff per metre or mark up whatever that particular stick
 * cost them; the per-cut and per-join tariffs are added on top either way.
 */
function chopJoinBase(rule: PricingRule, cost: number, lengthM: number): number {
  if (rule.factor != null && rule.factor > 0) return multiply(cost, rule.factor);
  return multiply(rule.amount ?? 0, lengthM);
}

/** Gross retail in kopecks, before minimum charge, rounding and discount. */
function computeRetail(input: PricingInput, rule: PricingRule, notes: string[]): number {
  const dims = input.dimensions ?? {};
  const quantity = input.quantity;
  const costQuantity = input.consumedQuantity ?? quantity;
  const cost = Math.round(input.unitCost * costQuantity);
  const lengthM = dims.lengthMm !== undefined ? dims.lengthMm / 1000 : quantity;

  switch (rule.method) {
    case 'COST_MULTIPLIER': {
      const factor = rule.factor ?? 1;
      return multiply(cost, factor);
    }

    case 'MARKUP': {
      const percent = rule.factor ?? 0;
      return multiply(cost, 1 + percent / 100);
    }

    case 'PER_METER': {
      const rate = rule.amount ?? 0;
      return multiply(rate, lengthM);
    }

    case 'CHOP': {
      return chopJoinBase(rule, cost, lengthM) + (rule.chopPrice ?? 0) * (dims.cuts ?? 0);
    }

    case 'JOIN': {
      return (
        chopJoinBase(rule, cost, lengthM) +
        (rule.chopPrice ?? 0) * (dims.cuts ?? 0) +
        (rule.joinPrice ?? 0) * (dims.joins ?? 0)
      );
    }

    case 'PER_AREA':
      return multiply(rule.amount ?? 0, dims.areaM2 ?? 0);

    case 'UNITED_INCH':
      return multiply(rule.amount ?? 0, dims.unitedInches ?? 0);

    case 'PER_PIECE':
      return multiply(rule.amount ?? 0, quantity);

    case 'FIXED':
      return rule.amount ?? 0;

    case 'MATRIX': {
      if (!rule.matrix) throw new PricingError('Для метода «Ценовая матрица» не задана матрица.');
      const price = lookupMatrix(rule.matrix, dims);
      if (price === null) {
        notes.push('Подходящая ячейка матрицы не найдена — применён расчёт по себестоимости.');
        return multiply(cost, DEFAULT_RULE.factor ?? 3);
      }
      return price;
    }

    case 'FORMULA': {
      if (!rule.formulaExpression) throw new PricingError('Для метода «Формула» не задано выражение.');
      const value = evaluateFormula(rule.formulaExpression, dimensionContext(input));
      return roubles(value);
    }

    default:
      throw new PricingError(`Неизвестный метод ценообразования «${rule.method}».`);
  }
}

export function calculatePrice(input: PricingInput): PriceResult {
  const notes: string[] = [];
  const rule = input.rule ?? DEFAULT_RULE;
  const costQuantity = input.consumedQuantity ?? input.quantity;
  const cost = Math.round(input.unitCost * costQuantity);

  let retail: number;
  let method: PricingMethodName = rule.method;

  if (input.unitRetailPrice != null) {
    retail = Math.round(input.unitRetailPrice * input.quantity);
    method = 'PER_PIECE';
  } else {
    retail = computeRetail(input, rule, notes);
  }

  const minimum = Math.max(rule.minPrice ?? 0, input.minCharge ?? 0);
  if (minimum > 0 && retail < minimum) {
    retail = minimum;
    notes.push('Применена минимальная стоимость позиции.');
  }

  if (rule.minMarkup != null && rule.minMarkup > 0) {
    const floor = multiply(cost, rule.minMarkup);
    if (retail < floor) {
      retail = floor;
      notes.push(
        `Цена поднята до минимальной наценки ×${round2(rule.minMarkup)} к себестоимости.`,
      );
    }
  }

  const step = rule.roundTo ?? 0;
  if (step > 1) retail = roundTo(retail, step);
  retail = Math.max(0, retail);

  const percentDiscount = input.discountPercent ? multiply(retail, input.discountPercent / 100) : 0;
  const discount = Math.min(retail, percentDiscount + (input.discountAmount ?? 0));
  const gross = retail - discount;

  let net = gross;
  let tax = 0;
  const taxPercent = input.taxPercent ?? 0;
  if (taxPercent > 0) {
    if (input.taxIncluded) {
      net = Math.round(gross / (1 + taxPercent / 100));
      tax = gross - net;
    } else {
      tax = multiply(gross, taxPercent / 100);
    }
  }

  const finalPrice = net + tax;
  const margin = net - cost;

  return {
    cost,
    retailPrice: retail,
    discount,
    net,
    tax,
    finalPrice,
    margin,
    marginPercent: marginPercent(net, cost),
    method,
    notes,
  };
}

/** Aggregates component results into the totals stored on a work item. */
export interface AggregatedPrice {
  cost: number;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  margin: number;
  marginPercent: number;
}

export function aggregatePrices(results: PriceResult[]): AggregatedPrice {
  const cost = results.reduce((acc, item) => acc + item.cost, 0);
  const subtotal = results.reduce((acc, item) => acc + item.retailPrice, 0);
  const discount = results.reduce((acc, item) => acc + item.discount, 0);
  const tax = results.reduce((acc, item) => acc + item.tax, 0);
  const net = results.reduce((acc, item) => acc + item.net, 0);
  const total = net + tax;

  return {
    cost,
    subtotal,
    discount,
    tax,
    total,
    margin: net - cost,
    marginPercent: marginPercent(net, cost),
  };
}

/** Applies an order-level discount proportionally, in whole kopecks. */
export function applyOrderDiscount(lineTotals: number[], discountPercent: number): number[] {
  if (discountPercent <= 0) return lineTotals.map(() => 0);
  return lineTotals.map((total) => multiply(total, discountPercent / 100));
}

export { round2 };
