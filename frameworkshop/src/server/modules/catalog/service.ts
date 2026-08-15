import type { Db } from '@/server/db';
import { prisma } from '@/server/db';
import type { AppContext } from '@/server/lib/context';
import { NotFoundError } from '@/server/lib/context';
import { writeAudit } from '@/server/modules/audit/service';
import type { CalcCatalog, CalcCatalogItem } from '@/server/modules/framing/calculation';
import type { PricingRule } from '@/server/modules/pricing/engine';
import type { CatalogGroup, Prisma, Unit } from '@/generated/prisma/client';

/** Catalog data needed to price a component, alongside its geometry spec. */
export interface CatalogSnapshotEntry {
  calc: CalcCatalogItem;
  costPrice: number;
  retailPrice: number | null;
  minCharge: number | null;
  taxPercent: number;
  rule: PricingRule | null;
  unit: Unit;
  group: CatalogGroup;
  name: string;
  internalSku: string;
  trackInventory: boolean;
  /** Production norm behind a labour/service item, when one is linked. */
  operation: {
    id: string;
    code: string;
    name: string;
    payRatePerMinute: number;
    standardMinutes: number;
    minutesPerM2: number;
    complexityFactor: number;
    stage: string;
  } | null;
}

export type CatalogSnapshot = Map<string, CatalogSnapshotEntry>;

const ITEM_INCLUDE = {
  moulding: true,
  sheet: true,
  hardware: true,
  service: { include: { operation: true } },
  taxRate: true,
  priceRule: {
    include: {
      formula: true,
      matrix: { include: { cells: true } },
    },
  },
} satisfies Prisma.CatalogItemInclude;

type CatalogItemWithSpecs = Prisma.CatalogItemGetPayload<{ include: typeof ITEM_INCLUDE }>;

function toPricingRule(item: CatalogItemWithSpecs): PricingRule | null {
  const rule = item.priceRule;
  if (!rule) return null;
  return {
    method: rule.method,
    factor: rule.factor,
    amount: rule.amount,
    chopPrice: rule.chopPrice ?? item.moulding?.chopPrice ?? null,
    joinPrice: rule.joinPrice ?? item.moulding?.joinPrice ?? null,
    minPrice: rule.minPrice,
    roundTo: rule.roundTo,
    formulaExpression: rule.formula?.expression ?? null,
    matrix: rule.matrix
      ? {
          axis: rule.matrix.axis,
          roundUp: rule.matrix.roundUp,
          cells: rule.matrix.cells.map((cell) => ({
            widthMm: cell.widthMm,
            heightMm: cell.heightMm,
            upTo: cell.upTo,
            price: cell.price,
          })),
        }
      : null,
  };
}

function toSnapshotEntry(item: CatalogItemWithSpecs): CatalogSnapshotEntry {
  return {
    calc: {
      id: item.id,
      name: item.name,
      group: item.group,
      unit: item.unit,
      wasteFactor: item.wasteFactor,
      moulding: item.moulding
        ? {
            widthMm: item.moulding.widthMm,
            heightMm: item.moulding.heightMm,
            rabbetMm: item.moulding.rabbetMm,
            rabbetOverlapMm: item.moulding.rabbetOverlapMm,
            stickLengthMm: item.moulding.stickLengthMm,
            kerfMm: item.moulding.kerfMm,
            allowanceMm: item.moulding.allowanceMm,
          }
        : null,
      sheet: item.sheet
        ? {
            sheetWidthMm: item.sheet.sheetWidthMm,
            sheetHeightMm: item.sheet.sheetHeightMm,
            thicknessMm: item.sheet.thicknessMm,
            allowOffcuts: item.sheet.allowOffcuts,
          }
        : null,
      hardware: item.hardware
        ? {
            perItem: item.hardware.perItem,
            perPerimeterM: item.hardware.perPerimeterM,
            packSize: item.hardware.packSize,
          }
        : null,
      service: item.service
        ? {
            standardMinutes: item.service.standardMinutes,
            minutesPerM2: item.service.minutesPerM2,
            complexityFactor: item.service.complexityFactor,
          }
        : null,
    },
    costPrice: item.costPrice,
    retailPrice: item.retailPrice,
    minCharge: item.minCharge,
    taxPercent: item.taxRate?.percent ?? 0,
    rule: toPricingRule(item),
    unit: item.unit,
    group: item.group,
    name: item.name,
    internalSku: item.internalSku,
    trackInventory: item.trackInventory,
    operation: item.service?.operation
      ? {
          id: item.service.operation.id,
          code: item.service.operation.code,
          name: item.service.operation.name,
          payRatePerMinute: item.service.operation.payRatePerMinute,
          standardMinutes: item.service.operation.standardMinutes,
          minutesPerM2: item.service.operation.minutesPerM2,
          complexityFactor: item.service.operation.complexityFactor,
          stage: item.service.operation.stage,
        }
      : null,
  };
}

/** Loads everything the calculation and pricing engines need, in one query. */
export async function loadCatalogSnapshot(
  db: Db,
  organizationId: string,
  ids: string[],
): Promise<CatalogSnapshot> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const items = await db.catalogItem.findMany({
    where: { organizationId, id: { in: unique } },
    include: ITEM_INCLUDE,
  });

  return new Map(items.map((item) => [item.id, toSnapshotEntry(item)]));
}

export function toCalcCatalog(snapshot: CatalogSnapshot): CalcCatalog {
  return new Map([...snapshot.entries()].map(([id, entry]) => [id, entry.calc]));
}

// ---------------------------------------------------------------------------
// Search & CRUD
// ---------------------------------------------------------------------------

export interface CatalogSearchQuery {
  q?: string;
  group?: CatalogGroup;
  supplierId?: string;
  categoryId?: string;
  color?: string;
  material?: string;
  onlyActive?: boolean;
  /** Only items with available stock above this quantity. */
  minAvailable?: number;
  maxCostPrice?: number;
  take?: number;
  skip?: number;
  orderBy?: 'name' | 'sku' | 'price' | 'updated';
}

/**
 * Catalog search. Article, barcode and SKU are matched exactly first, which is
 * what makes a barcode scanner feel instant, then the query falls back to a
 * fuzzy name/colour/material match.
 */
export async function searchCatalog(organizationId: string, query: CatalogSearchQuery) {
  const term = query.q?.trim();

  const where: Prisma.CatalogItemWhereInput = {
    organizationId,
    ...(query.group ? { group: query.group } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
    ...(query.categoryId ? { categoryId: query.categoryId } : {}),
    ...(query.color ? { color: { contains: query.color, mode: 'insensitive' } } : {}),
    ...(query.material ? { material: { contains: query.material, mode: 'insensitive' } } : {}),
    ...(query.onlyActive === false ? {} : { isActive: true }),
    ...(query.maxCostPrice != null ? { costPrice: { lte: query.maxCostPrice } } : {}),
    ...(term
      ? {
          OR: [
            { internalSku: { contains: term, mode: 'insensitive' } },
            { supplierSku: { contains: term, mode: 'insensitive' } },
            { barcode: term },
            { name: { contains: term, mode: 'insensitive' } },
            { color: { contains: term, mode: 'insensitive' } },
            { material: { contains: term, mode: 'insensitive' } },
            { collection: { contains: term, mode: 'insensitive' } },
            { manufacturer: { contains: term, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.CatalogItemOrderByWithRelationInput =
    query.orderBy === 'sku'
      ? { internalSku: 'asc' }
      : query.orderBy === 'price'
        ? { costPrice: 'asc' }
        : query.orderBy === 'updated'
          ? { updatedAt: 'desc' }
          : { name: 'asc' };

  const [items, total] = await Promise.all([
    prisma.catalogItem.findMany({
      where,
      orderBy,
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        supplier: { select: { id: true, name: true } },
        moulding: true,
        sheet: true,
        hardware: true,
        service: true,
        priceRule: { select: { id: true, name: true, method: true } },
        inventoryItems: {
          select: { quantityOnHand: true, quantityReserved: true, minQuantity: true },
        },
      },
    }),
    prisma.catalogItem.count({ where }),
  ]);

  const mapped = items.map((item) => {
    const onHand = item.inventoryItems.reduce((acc, row) => acc + row.quantityOnHand, 0);
    const reserved = item.inventoryItems.reduce((acc, row) => acc + row.quantityReserved, 0);
    return {
      ...item,
      stock: {
        onHand: round4(onHand),
        reserved: round4(reserved),
        available: round4(onHand - reserved),
        minQuantity: item.inventoryItems[0]?.minQuantity ?? 0,
      },
    };
  });

  const filtered =
    query.minAvailable != null
      ? mapped.filter((item) => item.stock.available >= (query.minAvailable ?? 0))
      : mapped;

  return { items: filtered, total };
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

export async function findByBarcode(organizationId: string, barcode: string) {
  return prisma.catalogItem.findFirst({
    where: {
      organizationId,
      OR: [{ barcode }, { internalSku: barcode }, { supplierSku: barcode }],
    },
    include: { supplier: true, moulding: true, sheet: true, hardware: true, service: true },
  });
}

export async function getCatalogItem(organizationId: string, id: string) {
  const item = await prisma.catalogItem.findFirst({
    where: { organizationId, id },
    include: {
      ...ITEM_INCLUDE,
      supplier: true,
      category: true,
      supplierPrices: { include: { supplier: { select: { name: true } } } },
      priceHistory: {
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { changedBy: { select: { firstName: true, lastName: true } } },
      },
      inventoryItems: true,
    },
  });
  if (!item) throw new NotFoundError('Позиция каталога');
  return item;
}

export interface CatalogItemInput {
  group: CatalogGroup;
  internalSku: string;
  name: string;
  unit: Unit;
  supplierId?: string | null;
  categoryId?: string | null;
  supplierSku?: string | null;
  barcode?: string | null;
  description?: string | null;
  manufacturer?: string | null;
  brand?: string | null;
  collection?: string | null;
  color?: string | null;
  colorHex?: string | null;
  material?: string | null;
  style?: string | null;
  supplierPrice?: number;
  supplierDiscountPercent?: number;
  costPrice?: number;
  retailPrice?: number | null;
  priceRuleId?: string | null;
  taxRateId?: string | null;
  wasteFactor?: number;
  minCharge?: number | null;
  trackInventory?: boolean;
  isActive?: boolean;
  imageUrl?: string | null;
  attributes?: Record<string, unknown> | null;
  moulding?: {
    widthMm: number;
    heightMm: number;
    rabbetMm?: number;
    rabbetOverlapMm?: number;
    stickLengthMm?: number;
    kerfMm?: number;
    allowanceMm?: number;
    chopPrice?: number | null;
    joinPrice?: number | null;
  } | null;
  sheet?: {
    sheetWidthMm: number;
    sheetHeightMm: number;
    thicknessMm?: number;
    core?: string | null;
    uvPercent?: number | null;
    allowOffcuts?: boolean;
  } | null;
  hardware?: { perItem?: number; perPerimeterM?: number; packSize?: number } | null;
  service?: {
    operationId?: string | null;
    standardMinutes?: number;
    minutesPerM2?: number;
    complexityFactor?: number;
  } | null;
}

export async function createCatalogItem(context: AppContext, input: CatalogItemInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const item = await tx.catalogItem.create({
      data: {
        organizationId,
        group: input.group,
        internalSku: input.internalSku,
        name: input.name,
        unit: input.unit,
        supplierId: input.supplierId ?? null,
        categoryId: input.categoryId ?? null,
        supplierSku: input.supplierSku ?? null,
        barcode: input.barcode ?? null,
        description: input.description ?? null,
        manufacturer: input.manufacturer ?? null,
        brand: input.brand ?? null,
        collection: input.collection ?? null,
        color: input.color ?? null,
        colorHex: input.colorHex ?? null,
        material: input.material ?? null,
        style: input.style ?? null,
        supplierPrice: input.supplierPrice ?? 0,
        supplierDiscountPercent: input.supplierDiscountPercent ?? 0,
        costPrice: input.costPrice ?? 0,
        retailPrice: input.retailPrice ?? null,
        priceRuleId: input.priceRuleId ?? null,
        taxRateId: input.taxRateId ?? null,
        wasteFactor: input.wasteFactor ?? 0,
        minCharge: input.minCharge ?? null,
        trackInventory: input.trackInventory ?? true,
        isActive: input.isActive ?? true,
        imageUrl: input.imageUrl ?? null,
        attributes: (input.attributes ?? undefined) as never,
        priceUpdatedAt: new Date(),
        ...(input.moulding ? { moulding: { create: input.moulding } } : {}),
        ...(input.sheet ? { sheet: { create: input.sheet } } : {}),
        ...(input.hardware ? { hardware: { create: input.hardware } } : {}),
        ...(input.service ? { service: { create: input.service } } : {}),
      },
    });

    await writeAudit(tx, context, {
      action: 'catalog.create',
      entity: 'CatalogItem',
      entityId: item.id,
      newValue: { sku: item.internalSku, name: item.name, costPrice: item.costPrice },
    });

    return item;
  });
}

/**
 * Updates a catalog item. Price fields are never overwritten silently — each
 * change is recorded in `price_history` together with the reason.
 */
export async function updateCatalogItem(
  context: AppContext,
  id: string,
  input: Partial<CatalogItemInput>,
  reason?: string,
) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const existing = await tx.catalogItem.findFirst({ where: { organizationId, id } });
    if (!existing) throw new NotFoundError('Позиция каталога');

    const priceFields: Array<keyof CatalogItemInput & keyof typeof existing> = [
      'supplierPrice',
      'costPrice',
      'retailPrice',
    ];
    const priceChanges = priceFields
      .filter((field) => input[field] !== undefined && input[field] !== existing[field])
      .map((field) => ({
        field: String(field),
        oldValue: (existing[field] as number | null) ?? null,
        newValue: (input[field] as number | null) ?? null,
      }));

    const { moulding, sheet, hardware, service, attributes, ...scalars } = input;

    const item = await tx.catalogItem.update({
      where: { id },
      data: {
        ...scalars,
        ...(attributes !== undefined ? { attributes: attributes as never } : {}),
        ...(priceChanges.length > 0 ? { priceUpdatedAt: new Date() } : {}),
        ...(moulding
          ? { moulding: { upsert: { create: moulding, update: moulding } } }
          : moulding === null
            ? { moulding: { delete: true } }
            : {}),
        ...(sheet ? { sheet: { upsert: { create: sheet, update: sheet } } } : {}),
        ...(hardware ? { hardware: { upsert: { create: hardware, update: hardware } } } : {}),
        ...(service ? { service: { upsert: { create: service, update: service } } } : {}),
      },
    });

    for (const change of priceChanges) {
      await tx.priceHistory.create({
        data: {
          catalogItemId: id,
          field: change.field,
          oldValue: change.oldValue,
          newValue: change.newValue,
          reason: reason ?? null,
          changedById: context.user.id,
        },
      });
    }

    await writeAudit(tx, context, {
      action: 'catalog.update',
      entity: 'CatalogItem',
      entityId: id,
      oldValue: priceChanges.length > 0 ? Object.fromEntries(priceChanges.map((c) => [c.field, c.oldValue])) : undefined,
      newValue: { ...scalars },
    });

    return item;
  });
}

/** Catalog entries are archived, never deleted — orders reference them forever. */
export async function archiveCatalogItem(context: AppContext, id: string) {
  const organizationId = context.user.organizationId;
  const existing = await prisma.catalogItem.findFirst({ where: { organizationId, id } });
  if (!existing) throw new NotFoundError('Позиция каталога');

  const item = await prisma.catalogItem.update({ where: { id }, data: { isActive: false } });
  await writeAudit(prisma, context, {
    action: 'catalog.archive',
    entity: 'CatalogItem',
    entityId: id,
    oldValue: { isActive: true },
    newValue: { isActive: false },
  });
  return item;
}

/** Builds the customer-facing price list straight from the catalog. */
export async function buildPriceList(organizationId: string, groups?: CatalogGroup[]) {
  const items = await prisma.catalogItem.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(groups && groups.length > 0 ? { group: { in: groups } } : {}),
    },
    orderBy: [{ group: 'asc' }, { name: 'asc' }],
    include: { priceRule: true, moulding: true, sheet: true },
  });

  const byGroup = new Map<CatalogGroup, typeof items>();
  for (const item of items) {
    const bucket = byGroup.get(item.group);
    if (bucket) bucket.push(item);
    else byGroup.set(item.group, [item]);
  }
  return byGroup;
}
