/**
 * Inventory engine.
 *
 * Every movement is written to `inventory_transactions` — the balance on
 * `inventory_items` is a cached projection of that ledger, updated in the same
 * transaction. Nothing decrements a balance without leaving a record.
 */

import { round4 } from '@/lib/units';
import type { InventoryTxType } from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db';
import { ConflictError, DomainError, NotFoundError, type AppContext } from '@/server/lib/context';
import { writeAudit } from '@/server/modules/audit/service';

export interface StockMovement {
  catalogItemId: string;
  quantity: number;
  unitCost?: number;
  branchId?: string | null;
  refType?: string;
  refId?: string;
  note?: string;
}

export async function ensureInventoryItem(
  db: Db,
  organizationId: string,
  catalogItemId: string,
  branchId: string | null = null,
) {
  const existing = await db.inventoryItem.findFirst({
    where: { organizationId, catalogItemId, branchId },
  });
  if (existing) return existing;

  return db.inventoryItem.create({
    data: { organizationId, catalogItemId, branchId },
  });
}

/**
 * Removes floating-point noise left by atomic increments.
 *
 * The atomic `increment`/`decrement` keeps concurrent updates correct, but
 * repeated additions of values such as 0,333 drift in the last bits. The row is
 * already locked by the preceding UPDATE inside this transaction, so rewriting
 * the rounded value here cannot lose a concurrent write.
 */
async function settleQuantities<T extends { id: string; quantityOnHand: number; quantityReserved: number }>(
  db: Db,
  item: T,
): Promise<T> {
  const onHand = round4(item.quantityOnHand);
  const reserved = round4(item.quantityReserved);
  if (onHand === item.quantityOnHand && reserved === item.quantityReserved) return item;

  await db.inventoryItem.update({
    where: { id: item.id },
    data: { quantityOnHand: onHand, quantityReserved: reserved },
  });
  return { ...item, quantityOnHand: onHand, quantityReserved: reserved };
}

async function recordTransaction(
  db: Db,
  context: AppContext,
  inventoryItemId: string,
  type: InventoryTxType,
  quantity: number,
  options: { unitCost?: number; refType?: string; refId?: string; note?: string } = {},
) {
  const item = await db.inventoryItem.findUnique({ where: { id: inventoryItemId } });
  if (!item) throw new NotFoundError('Складская позиция');

  const balanceAfter = round4(item.quantityOnHand + quantity);
  const unitCost = options.unitCost ?? item.avgCost;

  await db.inventoryTransaction.create({
    data: {
      organizationId: context.user.organizationId,
      inventoryItemId,
      type,
      quantity: round4(quantity),
      unitCost,
      totalCost: Math.round(unitCost * Math.abs(quantity)),
      balanceAfter,
      refType: options.refType,
      refId: options.refId,
      note: options.note,
      userId: context.user.id,
    },
  });

  return balanceAfter;
}

/** Goods receipt — updates the weighted average cost. */
export async function receiveStock(db: Db, context: AppContext, movement: StockMovement) {
  if (movement.quantity <= 0) throw new DomainError('Количество приёмки должно быть больше нуля.');

  const item = await ensureInventoryItem(
    db,
    context.user.organizationId,
    movement.catalogItemId,
    movement.branchId ?? null,
  );

  const unitCost = movement.unitCost ?? item.avgCost;
  const newQuantity = round4(item.quantityOnHand + movement.quantity);
  const avgCost =
    newQuantity > 0
      ? Math.round((item.quantityOnHand * item.avgCost + movement.quantity * unitCost) / newQuantity)
      : unitCost;

  await recordTransaction(db, context, item.id, 'RECEIPT', movement.quantity, {
    unitCost,
    refType: movement.refType,
    refId: movement.refId,
    note: movement.note,
  });

  return db.inventoryItem.update({
    where: { id: item.id },
    data: { quantityOnHand: newQuantity, avgCost, lastReceivedAt: new Date() },
  });
}

export interface ShortageLine {
  catalogItemId: string;
  name: string;
  unit: string;
  required: number;
  onHand: number;
  reserved: number;
  available: number;
  shortage: number;
  supplierId: string | null;
  supplierName: string | null;
  unitCost: number;
}

/**
 * Reserves every trackable component of a work item.
 *
 * A reservation is allowed to exceed the stock on hand: the resulting shortage
 * is what feeds the automatic purchase order suggestion. The work item simply
 * cannot move past "материалы готовы" until the shortage is covered.
 */
export async function reserveForWorkItem(
  db: Db,
  context: AppContext,
  workItemId: string,
): Promise<{ reserved: number; shortages: ShortageLine[] }> {
  const organizationId = context.user.organizationId;

  const workItem = await db.workItem.findFirst({
    where: { organizationId, id: workItemId },
    include: {
      components: { include: { catalogItem: { include: { supplier: true } } } },
      order: { select: { branchId: true } },
    },
  });
  if (!workItem) throw new NotFoundError('Изделие');

  const active = await db.inventoryReservation.findMany({
    where: { workItemId, status: 'ACTIVE' },
  });
  if (active.length > 0) {
    await releaseReservations(db, context, workItemId);
  }

  const branchId = workItem.order.branchId ?? null;
  const shortages: ShortageLine[] = [];
  let reserved = 0;

  for (const component of workItem.components) {
    if (!component.catalogItemId || !component.catalogItem?.trackInventory) continue;
    if (component.consumedQuantity <= 0) continue;

    const inventoryItem = await ensureInventoryItem(db, organizationId, component.catalogItemId, branchId);

    await db.inventoryReservation.create({
      data: {
        organizationId,
        inventoryItemId: inventoryItem.id,
        workItemId,
        quantity: round4(component.consumedQuantity),
        status: 'ACTIVE',
      },
    });

    const updated = await settleQuantities(
      db,
      await db.inventoryItem.update({
        where: { id: inventoryItem.id },
        data: { quantityReserved: { increment: round4(component.consumedQuantity) } },
      }),
    );
    reserved += 1;

    const available = round4(updated.quantityOnHand - updated.quantityReserved);
    if (available < 0) {
      shortages.push({
        catalogItemId: component.catalogItemId,
        name: component.catalogItem.name,
        unit: component.catalogItem.unit,
        required: round4(component.consumedQuantity),
        onHand: updated.quantityOnHand,
        reserved: updated.quantityReserved,
        available,
        shortage: round4(-available),
        supplierId: component.catalogItem.supplierId,
        supplierName: component.catalogItem.supplier?.name ?? null,
        unitCost: component.catalogItem.costPrice,
      });
    }
  }

  await db.workItem.update({
    where: { id: workItemId },
    data: {
      materialsReservedAt: new Date(),
      status: shortages.length > 0 ? 'AWAITING_MATERIALS' : 'MATERIALS_READY',
    },
  });

  await writeAudit(db, context, {
    action: 'inventory.reserve',
    entity: 'WorkItem',
    entityId: workItemId,
    newValue: { reserved, shortages: shortages.length },
  });

  return { reserved, shortages };
}

export async function releaseReservations(db: Db, context: AppContext, workItemId: string) {
  const reservations = await db.inventoryReservation.findMany({
    where: { workItemId, status: 'ACTIVE' },
  });

  for (const reservation of reservations) {
    await settleQuantities(
      db,
      await db.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: { quantityReserved: { decrement: reservation.quantity } },
      }),
    );
    await db.inventoryReservation.update({
      where: { id: reservation.id },
      data: { status: 'RELEASED', releasedAt: new Date() },
    });
  }

  if (reservations.length > 0) {
    await writeAudit(db, context, {
      action: 'inventory.release',
      entity: 'WorkItem',
      entityId: workItemId,
      newValue: { released: reservations.length },
    });
  }

  return reservations.length;
}

/**
 * Turns reservations into actual stock movements when the item is produced.
 * Net consumption and technological waste are written as separate ledger lines
 * so real cost and real waste can be reported apart.
 */
export async function consumeForWorkItem(db: Db, context: AppContext, workItemId: string) {
  const organizationId = context.user.organizationId;

  const workItem = await db.workItem.findFirst({
    where: { organizationId, id: workItemId },
    include: { components: true },
  });
  if (!workItem) throw new NotFoundError('Изделие');

  if (workItem.materialsConsumedAt) {
    throw new ConflictError('Материалы по этому изделию уже списаны.');
  }

  const reservations = await db.inventoryReservation.findMany({
    where: { workItemId, status: 'ACTIVE' },
    include: { inventoryItem: { include: { catalogItem: { select: { name: true } } } } },
  });

  const insufficient = reservations.filter(
    (reservation) => reservation.inventoryItem.quantityOnHand < reservation.quantity,
  );
  if (insufficient.length > 0) {
    const details = insufficient
      .map(
        (reservation) =>
          `${reservation.inventoryItem.catalogItem.name}: нужно ${reservation.quantity}, на складе ${reservation.inventoryItem.quantityOnHand}`,
      )
      .join('; ');
    throw new ConflictError(`Недостаточно материалов для списания. ${details}`);
  }

  const byInventoryItem = new Map(
    workItem.components
      .filter((component) => component.catalogItemId)
      .map((component) => [component.catalogItemId!, component]),
  );

  let totalCost = 0;

  for (const reservation of reservations) {
    const component = byInventoryItem.get(reservation.inventoryItem.catalogItemId);
    const waste = component ? round4(Math.min(component.wasteQuantity, reservation.quantity)) : 0;
    const net = round4(reservation.quantity - waste);

    if (net > 0) {
      await recordTransaction(db, context, reservation.inventoryItemId, 'ISSUE', -net, {
        refType: 'WorkItem',
        refId: workItemId,
        note: 'Полезный расход',
      });
    }
    if (waste > 0) {
      await recordTransaction(db, context, reservation.inventoryItemId, 'WASTE', -waste, {
        refType: 'WorkItem',
        refId: workItemId,
        note: 'Технологический отход',
      });
    }

    const updated = await settleQuantities(
      db,
      await db.inventoryItem.update({
        where: { id: reservation.inventoryItemId },
        data: {
          quantityOnHand: { decrement: reservation.quantity },
          quantityReserved: { decrement: reservation.quantity },
          lastIssuedAt: new Date(),
        },
      }),
    );
    totalCost += Math.round(updated.avgCost * reservation.quantity);

    await db.inventoryReservation.update({
      where: { id: reservation.id },
      data: { status: 'CONSUMED', consumedAt: new Date() },
    });
  }

  await db.workItem.update({
    where: { id: workItemId },
    data: { materialsConsumedAt: new Date() },
  });

  await writeAudit(db, context, {
    action: 'inventory.consume',
    entity: 'WorkItem',
    entityId: workItemId,
    newValue: { lines: reservations.length, cost: totalCost },
  });

  return { lines: reservations.length, cost: totalCost };
}

export async function adjustStock(
  context: AppContext,
  input: { catalogItemId: string; branchId?: string | null; newQuantity: number; note?: string },
) {
  return prisma.$transaction(async (tx) => {
    const item = await ensureInventoryItem(
      tx,
      context.user.organizationId,
      input.catalogItemId,
      input.branchId ?? null,
    );
    const delta = round4(input.newQuantity - item.quantityOnHand);
    if (delta === 0) return item;

    await recordTransaction(tx, context, item.id, 'ADJUSTMENT', delta, {
      note: input.note ?? 'Корректировка остатка',
    });

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantityOnHand: round4(input.newQuantity) },
    });

    await writeAudit(tx, context, {
      action: 'inventory.adjust',
      entity: 'InventoryItem',
      entityId: item.id,
      oldValue: { quantityOnHand: item.quantityOnHand },
      newValue: { quantityOnHand: updated.quantityOnHand, note: input.note },
    });

    return updated;
  });
}

export async function writeOffStock(
  context: AppContext,
  input: { catalogItemId: string; branchId?: string | null; quantity: number; reason: string },
) {
  if (input.quantity <= 0) throw new DomainError('Количество списания должно быть больше нуля.');

  return prisma.$transaction(async (tx) => {
    const item = await ensureInventoryItem(
      tx,
      context.user.organizationId,
      input.catalogItemId,
      input.branchId ?? null,
    );
    if (item.quantityOnHand < input.quantity) {
      throw new ConflictError('Нельзя списать больше, чем есть на складе.');
    }

    await recordTransaction(tx, context, item.id, 'WRITE_OFF', -input.quantity, {
      note: input.reason,
    });

    const updated = await tx.inventoryItem.update({
      where: { id: item.id },
      data: { quantityOnHand: { decrement: round4(input.quantity) } },
    });

    await writeAudit(tx, context, {
      action: 'inventory.writeoff',
      entity: 'InventoryItem',
      entityId: item.id,
      newValue: { quantity: input.quantity, reason: input.reason },
    });

    return updated;
  });
}

export interface StockQuery {
  q?: string;
  group?: string;
  lowStockOnly?: boolean;
  take?: number;
  skip?: number;
}

export async function listStock(organizationId: string, query: StockQuery = {}) {
  const items = await prisma.inventoryItem.findMany({
    where: {
      organizationId,
      catalogItem: {
        ...(query.group ? { group: query.group as never } : {}),
        ...(query.q
          ? {
              OR: [
                { name: { contains: query.q, mode: 'insensitive' as const } },
                { internalSku: { contains: query.q, mode: 'insensitive' as const } },
                { barcode: query.q },
              ],
            }
          : {}),
      },
    },
    include: {
      catalogItem: {
        select: {
          id: true,
          name: true,
          internalSku: true,
          group: true,
          unit: true,
          costPrice: true,
          supplier: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { catalogItem: { name: 'asc' } },
    take: query.take ?? 100,
    skip: query.skip ?? 0,
  });

  const mapped = items.map((item) => ({
    ...item,
    available: round4(item.quantityOnHand - item.quantityReserved),
    value: Math.round(item.avgCost * item.quantityOnHand),
    isLow: item.quantityOnHand - item.quantityReserved <= item.reorderPoint,
  }));

  return query.lowStockOnly ? mapped.filter((item) => item.isLow) : mapped;
}

/** Positions below the reorder point plus everything reserved beyond stock. */
export async function collectShortages(organizationId: string): Promise<ShortageLine[]> {
  const items = await prisma.inventoryItem.findMany({
    where: { organizationId },
    include: {
      catalogItem: { include: { supplier: { select: { id: true, name: true } } } },
    },
  });

  return items
    .map((item) => {
      const available = round4(item.quantityOnHand - item.quantityReserved);
      const target = Math.max(item.reorderPoint, item.minQuantity);
      const shortage = round4(Math.max(0, target - available) + Math.max(0, -available));
      return {
        catalogItemId: item.catalogItemId,
        name: item.catalogItem.name,
        unit: item.catalogItem.unit,
        required: round4(item.quantityReserved),
        onHand: item.quantityOnHand,
        reserved: item.quantityReserved,
        available,
        shortage: item.reorderQuantity > 0 ? Math.max(shortage, item.reorderQuantity) : shortage,
        supplierId: item.catalogItem.supplierId,
        supplierName: item.catalogItem.supplier?.name ?? null,
        unitCost: item.catalogItem.costPrice,
      } satisfies ShortageLine;
    })
    .filter((line) => line.shortage > 0);
}

export async function inventoryHistory(organizationId: string, catalogItemId: string, take = 100) {
  return prisma.inventoryTransaction.findMany({
    where: { organizationId, inventoryItem: { catalogItemId } },
    orderBy: { createdAt: 'desc' },
    take,
    include: { user: { select: { firstName: true, lastName: true } } },
  });
}
