/**
 * Work item calculator — the orchestrator between the three engines.
 *
 *   Geometry engine  → sizes and cut lengths
 *   Material engine  → quantities per component
 *   Pricing engine   → cost, retail, discount, tax, margin
 *
 * The result is a complete set of component drafts ready to be persisted; the
 * order service never computes a price by itself.
 */

import { marginPercent, multiply, round2 } from '@/lib/money';
import { mmToM, round4 } from '@/lib/units';
import type { CatalogGroup, PricingMethod, Unit } from '@/generated/prisma/client';
import type { Db } from '@/server/db';
import { DomainError } from '@/server/lib/context';
import {
  loadCatalogSnapshot,
  toCalcCatalog,
  type CatalogSnapshot,
  type CatalogSnapshotEntry,
} from '@/server/modules/catalog/service';
import { buildMaterialLines, calculateFraming, type MaterialLine } from '@/server/modules/framing/calculation';
import type { CalculationResult, FramingSpec } from '@/server/modules/framing/types';
import {
  aggregatePrices,
  calculatePrice,
  type PriceResult,
  type PricingDimensions,
} from '@/server/modules/pricing/engine';

export interface ComponentDraft {
  group: CatalogGroup;
  catalogItemId: string | null;
  name: string;
  role: string;
  sortOrder: number;
  quantity: number;
  consumedQuantity: number;
  wasteQuantity: number;
  unit: Unit;
  pricingMethod: PricingMethod;
  unitCost: number;
  cost: number;
  unitPrice: number;
  price: number;
  discountPercent: number;
  discountAmount: number;
  isBillable: boolean;
  meta: Record<string, unknown>;
}

export interface WorkItemTotals {
  materialCost: number;
  labourCost: number;
  extraCost: number;
  totalCost: number;
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  price: number;
  margin: number;
  marginPercent: number;
}

export interface WorkItemCalculation {
  calculation: CalculationResult;
  components: ComponentDraft[];
  totals: WorkItemTotals;
  warnings: string[];
  /** Planned production minutes derived from the labour norms. */
  plannedMinutes: number;
}

export interface CalculateWorkItemOptions {
  /** Line-level discount applied to every billable component. */
  discountPercent?: number;
  /** Number of identical pieces. */
  quantity?: number;
  /** Overrides the catalog rule for one component role, e.g. a manual price. */
  priceOverrides?: Record<string, number>;
}

const LABOUR_GROUPS: CatalogGroup[] = ['LABOUR', 'SERVICE', 'MOUNTING', 'FITTING'];
const EXTRA_GROUPS: CatalogGroup[] = ['EXTRA', 'PRINT', 'SUPPLY'];

function dimensionsFor(line: MaterialLine, calc: CalculationResult): PricingDimensions {
  const meta = line.meta as Record<string, never>;

  if (line.group === 'MOULDING' || line.group === 'SUBFRAME') {
    const lengthMm = (meta.lengthMm as number | undefined) ?? Math.round(line.quantity * 1000);
    const outer = (meta.outerMm as { widthMm: number; heightMm: number } | undefined) ?? {
      widthMm: calc.outer.widthMm,
      heightMm: calc.outer.heightMm,
    };
    return {
      lengthMm,
      widthMm: outer.widthMm,
      heightMm: outer.heightMm,
      areaM2: (outer.widthMm * outer.heightMm) / 1_000_000,
      perimeterMm: 2 * (outer.widthMm + outer.heightMm),
      unitedInches: (outer.widthMm + outer.heightMm) / 25.4,
      cuts: (meta.cuts as number | undefined) ?? 4,
      joins: (meta.joins as number | undefined) ?? 4,
    };
  }

  const size =
    (meta.outer as { widthMm: number; heightMm: number } | undefined) ??
    (meta.size as { widthMm: number; heightMm: number } | undefined) ??
    calc.sandwich;

  return {
    widthMm: size.widthMm,
    heightMm: size.heightMm,
    areaM2: (meta.areaM2 as number | undefined) ?? (size.widthMm * size.heightMm) / 1_000_000,
    perimeterMm: (meta.perimeterMm as number | undefined) ?? 2 * (size.widthMm + size.heightMm),
    unitedInches: (size.widthMm + size.heightMm) / 25.4,
    lengthMm: (meta.cutLengthMm as number | undefined) ?? 0,
    minutes: (meta.minutes as number | undefined) ?? 0,
    cuts: 0,
    joins: 0,
  };
}

function labourCostOf(entry: CatalogSnapshotEntry | undefined, line: MaterialLine): number {
  if (!entry?.operation) return entry ? Math.round(entry.costPrice * line.quantity) : 0;
  const minutes = (line.meta.minutes as number | undefined) ?? entry.operation.standardMinutes;
  return Math.round(minutes * entry.operation.payRatePerMinute * line.quantity);
}

/** Prices a single component line. */
function priceLine(
  line: MaterialLine,
  entry: CatalogSnapshotEntry | undefined,
  calc: CalculationResult,
  options: CalculateWorkItemOptions,
): { draft: ComponentDraft; result: PriceResult } {
  const dims = dimensionsFor(line, calc);
  const isLabour = LABOUR_GROUPS.includes(line.group as CatalogGroup);

  const unitCost = isLabour
    ? line.quantity > 0
      ? Math.round(labourCostOf(entry, line) / line.quantity)
      : 0
    : (entry?.costPrice ?? 0);

  const override = options.priceOverrides?.[line.role];
  const result = calculatePrice({
    rule: entry?.rule ?? null,
    quantity: line.quantity,
    consumedQuantity: isLabour ? line.quantity : line.consumedQuantity,
    unitCost,
    unitRetailPrice: override != null ? override : (entry?.retailPrice ?? null),
    dimensions: dims,
    discountPercent: options.discountPercent ?? 0,
    taxPercent: entry?.taxPercent ?? 0,
    minCharge: entry?.minCharge ?? null,
  });

  const draft: ComponentDraft = {
    group: (entry?.group ?? (line.group as CatalogGroup)) as CatalogGroup,
    catalogItemId: line.catalogItemId,
    name: line.name,
    role: line.role,
    sortOrder: 0,
    quantity: round4(line.quantity),
    consumedQuantity: round4(line.consumedQuantity),
    wasteQuantity: round4(line.wasteQuantity),
    unit: (entry?.unit ?? line.unit) as Unit,
    pricingMethod: result.method as PricingMethod,
    unitCost,
    cost: result.cost,
    unitPrice: line.quantity > 0 ? Math.round(result.retailPrice / line.quantity) : result.retailPrice,
    price: result.finalPrice,
    discountPercent: options.discountPercent ?? 0,
    discountAmount: result.discount,
    isBillable: true,
    meta: { ...line.meta, notes: result.notes, dimensions: dims },
  };

  return { draft, result };
}

export function calculateWorkItemFrom(
  spec: FramingSpec,
  snapshot: CatalogSnapshot,
  options: CalculateWorkItemOptions = {},
): WorkItemCalculation {
  const quantity = Math.max(1, options.quantity ?? spec.quantity ?? 1);
  const calc = calculateFraming(spec, toCalcCatalog(snapshot));
  const lines = buildMaterialLines(spec, calc, toCalcCatalog(snapshot));

  const drafts: ComponentDraft[] = [];
  const results: PriceResult[] = [];
  let plannedMinutes = 0;

  lines.forEach((line, index) => {
    const entry = line.catalogItemId ? snapshot.get(line.catalogItemId) : undefined;
    const { draft, result } = priceLine(line, entry, calc, options);
    draft.sortOrder = index;

    if (quantity > 1) {
      draft.quantity = round4(draft.quantity * quantity);
      draft.consumedQuantity = round4(draft.consumedQuantity * quantity);
      draft.wasteQuantity = round4(draft.wasteQuantity * quantity);
      draft.cost = draft.cost * quantity;
      draft.price = draft.price * quantity;
      draft.discountAmount = draft.discountAmount * quantity;
    }

    const minutes = (line.meta.minutes as number | undefined) ?? entry?.operation?.standardMinutes ?? 0;
    plannedMinutes += minutes * quantity;

    drafts.push(draft);
    results.push(
      quantity > 1
        ? {
            ...result,
            cost: result.cost * quantity,
            retailPrice: result.retailPrice * quantity,
            discount: result.discount * quantity,
            net: result.net * quantity,
            tax: result.tax * quantity,
            finalPrice: result.finalPrice * quantity,
            margin: result.margin * quantity,
          }
        : result,
    );
  });

  const aggregate = aggregatePrices(results);

  const materialCost = drafts
    .filter((draft) => !LABOUR_GROUPS.includes(draft.group) && !EXTRA_GROUPS.includes(draft.group))
    .reduce((acc, draft) => acc + draft.cost, 0);
  const labourCost = drafts
    .filter((draft) => LABOUR_GROUPS.includes(draft.group))
    .reduce((acc, draft) => acc + draft.cost, 0);
  const extraCost = drafts
    .filter((draft) => EXTRA_GROUPS.includes(draft.group))
    .reduce((acc, draft) => acc + draft.cost, 0);

  return {
    calculation: calc,
    components: drafts,
    plannedMinutes: round2(plannedMinutes),
    warnings: calc.warnings,
    totals: {
      materialCost,
      labourCost,
      extraCost,
      totalCost: aggregate.cost,
      subtotal: aggregate.subtotal,
      discountAmount: aggregate.discount,
      taxAmount: aggregate.tax,
      price: aggregate.total,
      margin: aggregate.margin,
      marginPercent: aggregate.marginPercent,
    },
  };
}

/** Loads the catalog for a spec and runs the full calculation. */
export async function calculateWorkItem(
  db: Db,
  organizationId: string,
  spec: FramingSpec,
  options: CalculateWorkItemOptions = {},
): Promise<WorkItemCalculation> {
  const ids = collectCatalogIds(spec);
  const snapshot = await loadCatalogSnapshot(db, organizationId, ids);

  const missing = ids.filter((id) => !snapshot.has(id));
  if (missing.length > 0) {
    throw new DomainError(`Позиции каталога не найдены: ${missing.join(', ')}`);
  }

  return calculateWorkItemFrom(spec, snapshot, options);
}

export function collectCatalogIds(spec: FramingSpec): string[] {
  const ids: Array<string | null | undefined> = [
    ...(spec.mats ?? []).map((mat) => mat.catalogItemId),
    ...(spec.mouldings ?? []).map((moulding) => moulding.catalogItemId),
    spec.glazing?.catalogItemId,
    spec.backing?.catalogItemId,
    spec.mounting?.catalogItemId,
    spec.mounting?.boardCatalogItemId,
    spec.subframe?.catalogItemId,
    ...(spec.hardware ?? []).map((hardware) => hardware.catalogItemId),
    ...(spec.extras ?? []).map((extra) => extra.catalogItemId),
    ...(spec.services ?? []).map((service) => service.catalogItemId),
  ];
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

/** Profitability view used by the order card and the reports module. */
export function profitability(totals: WorkItemTotals) {
  return {
    revenue: totals.price,
    materials: totals.materialCost,
    labour: totals.labourCost,
    other: totals.extraCost,
    cost: totals.totalCost,
    grossProfit: totals.price - totals.taxAmount - totals.totalCost,
    marginPercent: marginPercent(totals.price - totals.taxAmount, totals.totalCost),
  };
}

export { multiply, mmToM };
