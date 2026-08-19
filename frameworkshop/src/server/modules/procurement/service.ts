/**
 * Procurement engine.
 *
 * Shortages detected by the inventory module are turned into purchase orders,
 * one per supplier, and a receipt posts straight back into stock so the
 * receptionist never re-enters the same figures.
 */

import { round4 } from '@/lib/units';
import type { PurchaseOrderStatus } from '@/generated/prisma/client';
import { prisma } from '@/server/db';
import { ConflictError, DomainError, NotFoundError, type AppContext } from '@/server/lib/context';
import { nextNumber } from '@/server/lib/sequence';
import { writeAudit } from '@/server/modules/audit/service';
import { collectShortages, receiveStock, type ShortageLine } from '@/server/modules/inventory/service';
import { notify } from '@/server/modules/notifications/service';

export interface PurchaseSuggestion {
  supplierId: string | null;
  supplierName: string;
  lines: ShortageLine[];
  totalCost: number;
}

/** Groups every current shortage by supplier and prices the resulting basket. */
export async function suggestPurchases(organizationId: string): Promise<PurchaseSuggestion[]> {
  const shortages = await collectShortages(organizationId);
  const bySupplier = new Map<string, PurchaseSuggestion>();

  for (const line of shortages) {
    const key = line.supplierId ?? 'unknown';
    const bucket = bySupplier.get(key) ?? {
      supplierId: line.supplierId,
      supplierName: line.supplierName ?? 'Поставщик не указан',
      lines: [],
      totalCost: 0,
    };
    bucket.lines.push(line);
    bucket.totalCost += Math.round(line.unitCost * line.shortage);
    bySupplier.set(key, bucket);
  }

  return [...bySupplier.values()].sort((a, b) => b.totalCost - a.totalCost);
}

export interface CreatePurchaseOrderInput {
  supplierId: string;
  expectedAt?: Date | null;
  notes?: string | null;
  items: Array<{ catalogItemId: string; quantity: number; unitCost?: number; note?: string }>;
}

export async function createPurchaseOrder(context: AppContext, input: CreatePurchaseOrderInput) {
  const organizationId = context.user.organizationId;
  if (input.items.length === 0) throw new DomainError('Заказ поставщику не может быть пустым.');

  return prisma.$transaction(async (tx) => {
    const supplier = await tx.supplier.findFirst({ where: { organizationId, id: input.supplierId } });
    if (!supplier) throw new NotFoundError('Поставщик');

    const catalogItems = await tx.catalogItem.findMany({
      where: { organizationId, id: { in: input.items.map((item) => item.catalogItemId) } },
    });
    const byId = new Map(catalogItems.map((item) => [item.id, item]));

    const lines = input.items.map((item) => {
      const catalogItem = byId.get(item.catalogItemId);
      if (!catalogItem) throw new NotFoundError(`Позиция каталога ${item.catalogItemId}`);
      const unitCost = item.unitCost ?? catalogItem.costPrice;
      const quantity = round4(item.quantity);
      return {
        catalogItemId: item.catalogItemId,
        quantityOrdered: quantity,
        unitCost,
        lineTotal: Math.round(unitCost * quantity),
        note: item.note,
      };
    });

    const number = await nextNumber(tx, organizationId, 'purchase_order', { padding: 4 });

    const purchaseOrder = await tx.purchaseOrder.create({
      data: {
        organizationId,
        number,
        supplierId: input.supplierId,
        status: 'DRAFT',
        expectedAt:
          input.expectedAt ??
          new Date(Date.now() + supplier.leadTimeDays * 86_400_000),
        notes: input.notes ?? null,
        createdById: context.user.id,
        totalCost: lines.reduce((acc, line) => acc + line.lineTotal, 0),
        items: { create: lines },
      },
      include: { items: true, supplier: true },
    });

    await writeAudit(tx, context, {
      action: 'procurement.create',
      entity: 'PurchaseOrder',
      entityId: purchaseOrder.id,
      newValue: { number, supplier: supplier.name, total: purchaseOrder.totalCost },
    });

    return purchaseOrder;
  });
}

/** Builds one draft purchase order per supplier from the current shortages. */
export async function createPurchaseOrdersFromShortages(context: AppContext) {
  const suggestions = await suggestPurchases(context.user.organizationId);
  const created = [];

  for (const suggestion of suggestions) {
    if (!suggestion.supplierId) continue;
    created.push(
      await createPurchaseOrder(context, {
        supplierId: suggestion.supplierId,
        notes: 'Сформировано автоматически по дефициту материалов',
        items: suggestion.lines.map((line) => ({
          catalogItemId: line.catalogItemId,
          quantity: line.shortage,
          unitCost: line.unitCost,
        })),
      }),
    );
  }

  return created;
}

const ALLOWED_PO_TRANSITIONS: Record<PurchaseOrderStatus, PurchaseOrderStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['CONFIRMED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  CONFIRMED: ['PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
  PARTIALLY_RECEIVED: ['RECEIVED', 'CANCELLED'],
  RECEIVED: [],
  CANCELLED: [],
};

export async function setPurchaseOrderStatus(
  context: AppContext,
  purchaseOrderId: string,
  status: PurchaseOrderStatus,
) {
  const organizationId = context.user.organizationId;
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { organizationId, id: purchaseOrderId },
  });
  if (!purchaseOrder) throw new NotFoundError('Заказ поставщику');
  if (!ALLOWED_PO_TRANSITIONS[purchaseOrder.status].includes(status)) {
    throw new ConflictError(`Недопустимый переход статуса: ${purchaseOrder.status} → ${status}.`);
  }

  const updated = await prisma.purchaseOrder.update({
    where: { id: purchaseOrderId },
    data: { status, ...(status === 'SENT' ? { sentAt: new Date() } : {}) },
  });

  await writeAudit(prisma, context, {
    action: 'procurement.status',
    entity: 'PurchaseOrder',
    entityId: purchaseOrderId,
    oldValue: { status: purchaseOrder.status },
    newValue: { status },
  });

  return updated;
}

export interface ReceiveInput {
  purchaseOrderId: string;
  lines: Array<{ itemId: string; quantity: number; unitCost?: number }>;
  note?: string;
}

/**
 * Posts a delivery: stock goes up, the weighted average cost is refreshed and
 * the purchase order moves to partially/fully received.
 */
export async function receivePurchaseOrder(context: AppContext, input: ReceiveInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const purchaseOrder = await tx.purchaseOrder.findFirst({
      where: { organizationId, id: input.purchaseOrderId },
      include: { items: true, supplier: true },
    });
    if (!purchaseOrder) throw new NotFoundError('Заказ поставщику');
    if (purchaseOrder.status === 'CANCELLED') throw new ConflictError('Заказ отменён.');
    if (purchaseOrder.status === 'RECEIVED') throw new ConflictError('Заказ уже получен полностью.');

    const byId = new Map(purchaseOrder.items.map((item) => [item.id, item]));

    for (const line of input.lines) {
      const item = byId.get(line.itemId);
      if (!item) throw new NotFoundError('Строка заказа поставщику');
      if (line.quantity <= 0) continue;

      const outstanding = round4(item.quantityOrdered - item.quantityReceived);
      if (line.quantity > outstanding + 1e-6) {
        throw new ConflictError(
          `По позиции заказано ${item.quantityOrdered}, уже получено ${item.quantityReceived} — принять ещё ${line.quantity} нельзя.`,
        );
      }

      await receiveStock(tx, context, {
        catalogItemId: item.catalogItemId,
        quantity: line.quantity,
        unitCost: line.unitCost ?? item.unitCost,
        refType: 'PurchaseOrder',
        refId: purchaseOrder.id,
        note: input.note ?? `Приёмка по заказу ${purchaseOrder.number}`,
      });

      await tx.purchaseOrderItem.update({
        where: { id: item.id },
        data: { quantityReceived: { increment: round4(line.quantity) } },
      });
    }

    const refreshed = await tx.purchaseOrderItem.findMany({ where: { purchaseOrderId: purchaseOrder.id } });
    const fullyReceived = refreshed.every((item) => item.quantityReceived >= item.quantityOrdered - 1e-6);
    const anyReceived = refreshed.some((item) => item.quantityReceived > 0);

    const updated = await tx.purchaseOrder.update({
      where: { id: purchaseOrder.id },
      data: {
        status: fullyReceived ? 'RECEIVED' : anyReceived ? 'PARTIALLY_RECEIVED' : purchaseOrder.status,
        ...(fullyReceived ? { receivedAt: new Date() } : {}),
      },
      include: { items: true },
    });

    await writeAudit(tx, context, {
      action: 'procurement.receive',
      entity: 'PurchaseOrder',
      entityId: purchaseOrder.id,
      newValue: { lines: input.lines.length, status: updated.status },
    });

    if (fullyReceived) {
      await notify(tx, {
        organizationId,
        type: 'PURCHASE_ORDER',
        title: `Заказ поставщику ${purchaseOrder.number} получен полностью`,
        entityType: 'PurchaseOrder',
        entityId: purchaseOrder.id,
      });
    }

    return updated;
  });
}

export async function listPurchaseOrders(
  organizationId: string,
  query: { status?: PurchaseOrderStatus; supplierId?: string; take?: number; skip?: number } = {},
) {
  const where = {
    organizationId,
    ...(query.status ? { status: query.status } : {}),
    ...(query.supplierId ? { supplierId: query.supplierId } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.purchaseOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        supplier: { select: { id: true, name: true } },
        items: { include: { catalogItem: { select: { name: true, internalSku: true, unit: true } } } },
      },
    }),
    prisma.purchaseOrder.count({ where }),
  ]);

  return { items, total };
}

export async function getPurchaseOrder(organizationId: string, id: string) {
  const purchaseOrder = await prisma.purchaseOrder.findFirst({
    where: { organizationId, id },
    include: {
      supplier: true,
      createdBy: { select: { firstName: true, lastName: true } },
      items: { include: { catalogItem: true } },
    },
  });
  if (!purchaseOrder) throw new NotFoundError('Заказ поставщику');
  return purchaseOrder;
}
