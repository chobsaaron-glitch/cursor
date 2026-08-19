/**
 * Order engine.
 *
 * A CustomerOrder is the customer-facing document; the actual pieces of work
 * live in WorkItems. Every mutation that touches money or material runs inside
 * a database transaction together with its side effects, so an order can never
 * be saved without its components, totals or stock movements.
 */

import type {
  CommercialStatus,
  OrderProductionStatus,
  Prisma,
  Priority,
  WorkItemStatus,
} from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db';
import { ConflictError, DomainError, NotFoundError, type AppContext } from '@/server/lib/context';
import { nextNumber, workItemNumber } from '@/server/lib/sequence';
import { hasPermission } from '@/server/auth/permissions';
import { writeAudit } from '@/server/modules/audit/service';
import type { FramingSpec } from '@/server/modules/framing/types';
import { calculateWorkItem, type CalculateWorkItemOptions } from './calculator';
import { reserveForWorkItem, releaseReservations } from '@/server/modules/inventory/service';
import { createProductionOrder } from '@/server/modules/production/service';
import { notify } from '@/server/modules/notifications/service';

/** Allowed work item transitions. Anything else is rejected outright. */
const WORK_ITEM_TRANSITIONS: Record<WorkItemStatus, WorkItemStatus[]> = {
  DRAFT: ['ESTIMATE', 'AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED'],
  ESTIMATE: ['AWAITING_CONFIRMATION', 'CONFIRMED', 'CANCELLED', 'DRAFT'],
  AWAITING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'ESTIMATE'],
  CONFIRMED: ['AWAITING_MATERIALS', 'MATERIALS_READY', 'IN_PRODUCTION', 'CANCELLED'],
  AWAITING_MATERIALS: ['MATERIALS_READY', 'CANCELLED', 'CONFIRMED'],
  MATERIALS_READY: ['IN_PRODUCTION', 'AWAITING_MATERIALS', 'CANCELLED'],
  IN_PRODUCTION: ['QUALITY_CHECK', 'READY', 'AWAITING_MATERIALS', 'CANCELLED'],
  QUALITY_CHECK: ['READY', 'IN_PRODUCTION', 'CANCELLED'],
  READY: ['ISSUED', 'QUALITY_CHECK'],
  ISSUED: ['CLOSED'],
  CLOSED: [],
  CANCELLED: [],
};

export function canTransition(from: WorkItemStatus, to: WorkItemStatus): boolean {
  return WORK_ITEM_TRANSITIONS[from]?.includes(to) ?? false;
}

/** Statuses that mean "this piece is on the production floor or beyond". */
const PRODUCTION_ACTIVE: WorkItemStatus[] = [
  'AWAITING_MATERIALS',
  'MATERIALS_READY',
  'IN_PRODUCTION',
  'QUALITY_CHECK',
];

export function deriveOrderProductionStatus(statuses: WorkItemStatus[]): OrderProductionStatus {
  const relevant = statuses.filter((status) => status !== 'CANCELLED');
  if (relevant.length === 0) return 'WAITING';
  if (relevant.every((status) => status === 'ISSUED' || status === 'CLOSED')) return 'ISSUED';
  if (relevant.every((status) => ['READY', 'ISSUED', 'CLOSED'].includes(status))) return 'READY';
  if (relevant.some((status) => PRODUCTION_ACTIVE.includes(status))) return 'IN_PRODUCTION';
  return 'WAITING';
}

export function assertDiscountAllowed(context: AppContext, discountPercent: number): void {
  if (discountPercent <= 0) return;
  if (!hasPermission(context.user.permissions, 'orders.discount')) {
    throw new DomainError('Нет права предоставлять скидку.', 403);
  }
  if (discountPercent > context.user.maxDiscountPercent) {
    throw new DomainError(
      `Роль «${context.user.roleName}» может дать скидку не более ${context.user.maxDiscountPercent} %.`,
      403,
    );
  }
}

// ---------------------------------------------------------------------------
// Totals
// ---------------------------------------------------------------------------

/**
 * Recomputes the money on an order from its work items and payments.
 * Called after every change so the stored totals can never drift.
 */
export async function recalcOrderTotals(db: Db, orderId: string) {
  const order = await db.customerOrder.findUnique({
    where: { id: orderId },
    include: {
      workItems: { where: { status: { not: 'CANCELLED' } } },
      payments: { where: { state: 'COMPLETED' } },
    },
  });
  if (!order) throw new NotFoundError('Заказ');

  const subtotal = order.workItems.reduce((acc, item) => acc + item.subtotal, 0);
  const discountTotal = order.workItems.reduce((acc, item) => acc + item.discountAmount, 0);
  const taxTotal = order.workItems.reduce((acc, item) => acc + item.taxAmount, 0);
  const total = order.workItems.reduce((acc, item) => acc + item.price, 0);
  const costTotal = order.workItems.reduce((acc, item) => acc + item.totalCost, 0);

  const paidTotal = order.payments
    .filter((payment) => payment.kind === 'PAYMENT')
    .reduce((acc, payment) => acc + payment.amount, 0);
  const refundedTotal = order.payments
    .filter((payment) => payment.kind === 'REFUND')
    .reduce((acc, payment) => acc + payment.amount, 0);

  const netPaid = paidTotal - refundedTotal;
  const balance = total - netPaid;

  // The payment track is derived from money only — it never touches the
  // commercial or production status of the order.
  const paymentStatus =
    refundedTotal > 0 && netPaid <= 0
      ? 'REFUNDED'
      : netPaid <= 0
        ? 'UNPAID'
        : netPaid < total
          ? 'PARTIAL'
          : netPaid > total
            ? 'OVERPAID'
            : 'PAID';

  const productionStatus = deriveOrderProductionStatus(order.workItems.map((item) => item.status));

  return db.customerOrder.update({
    where: { id: orderId },
    data: {
      subtotal,
      discountTotal,
      taxTotal,
      total,
      costTotal,
      paidTotal,
      refundedTotal,
      balance,
      paymentStatus,
      productionStatus,
    },
  });
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export interface CreateOrderInput {
  customerId: string;
  managerId?: string | null;
  branchId?: string | null;
  dueDate?: Date | null;
  priority?: Priority;
  notes?: string | null;
}

export async function createOrder(context: AppContext, input: CreateOrderInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const customer = await tx.customer.findFirst({
      where: { organizationId, id: input.customerId },
    });
    if (!customer) throw new NotFoundError('Клиент');

    const number = await nextNumber(tx, organizationId, 'order', { padding: 4 });

    const order = await tx.customerOrder.create({
      data: {
        organizationId,
        branchId: input.branchId ?? context.user.branchId ?? null,
        number,
        customerId: input.customerId,
        managerId: input.managerId ?? context.user.id,
        createdById: context.user.id,
        dueDate: input.dueDate ?? null,
        priority: input.priority ?? 'NORMAL',
        notes: input.notes ?? null,
      },
    });

    await writeAudit(tx, context, {
      action: 'order.create',
      entity: 'CustomerOrder',
      entityId: order.id,
      newValue: { number, customerId: input.customerId },
    });

    await notify(tx, {
      organizationId,
      type: 'NEW_ORDER',
      title: `Новый заказ №${number}`,
      body: `Клиент: ${customer.companyName ?? [customer.lastName, customer.firstName].filter(Boolean).join(' ')}`,
      entityType: 'CustomerOrder',
      entityId: order.id,
    });

    return order;
  });
}

export interface AddWorkItemInput {
  orderId: string;
  title: string;
  description?: string | null;
  workType?: string | null;
  spec: FramingSpec;
  quantity?: number;
  discountPercent?: number;
  priority?: Priority;
  dueDate?: Date | null;
  masterId?: string | null;
  priceOverrides?: Record<string, number>;
}

/** Adds a piece to an order: calculates it, stores components and totals. */
export async function addWorkItem(context: AppContext, input: AddWorkItemInput) {
  const organizationId = context.user.organizationId;
  assertDiscountAllowed(context, input.discountPercent ?? 0);

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { organizationId, id: input.orderId },
      include: { workItems: { select: { seq: true } } },
    });
    if (!order) throw new NotFoundError('Заказ');
    if (order.commercialStatus === 'CANCELLED') {
      throw new ConflictError('Нельзя добавлять изделия в отменённый заказ.');
    }

    const options: CalculateWorkItemOptions = {
      discountPercent: input.discountPercent ?? 0,
      quantity: input.quantity ?? 1,
      priceOverrides: input.priceOverrides,
    };
    const calculation = await calculateWorkItem(tx, organizationId, input.spec, options);

    const seq = order.workItems.reduce((max, item) => Math.max(max, item.seq), 0) + 1;

    const workItem = await tx.workItem.create({
      data: {
        organizationId,
        orderId: order.id,
        number: workItemNumber(order.number, seq),
        seq,
        title: input.title,
        description: input.description ?? null,
        workType: input.workType ?? null,
        status: 'DRAFT',
        priority: input.priority ?? order.priority,
        dueDate: input.dueDate ?? order.dueDate,
        masterId: input.masterId ?? null,
        quantity: input.quantity ?? 1,
        widthMm: Math.round(input.spec.artworkWidthMm),
        heightMm: Math.round(input.spec.artworkHeightMm),
        orientation:
          input.spec.artworkWidthMm > input.spec.artworkHeightMm ? 'landscape' : 'portrait',
        spec: input.spec as never,
        calculation: calculation.calculation as never,
        materialCost: calculation.totals.materialCost,
        labourCost: calculation.totals.labourCost,
        extraCost: calculation.totals.extraCost,
        totalCost: calculation.totals.totalCost,
        subtotal: calculation.totals.subtotal,
        discountAmount: calculation.totals.discountAmount,
        discountPercent: input.discountPercent ?? 0,
        taxAmount: calculation.totals.taxAmount,
        price: calculation.totals.price,
        margin: calculation.totals.margin,
        marginPercent: calculation.totals.marginPercent,
        components: {
          create: calculation.components.map((component) => ({
            group: component.group,
            catalogItemId: component.catalogItemId,
            name: component.name,
            role: component.role,
            sortOrder: component.sortOrder,
            quantity: component.quantity,
            consumedQuantity: component.consumedQuantity,
            wasteQuantity: component.wasteQuantity,
            unit: component.unit,
            pricingMethod: component.pricingMethod,
            unitCost: component.unitCost,
            cost: component.cost,
            unitPrice: component.unitPrice,
            price: component.price,
            discountPercent: component.discountPercent,
            discountAmount: component.discountAmount,
            isBillable: component.isBillable,
            meta: component.meta as never,
          })),
        },
        statusHistory: {
          create: { toStatus: 'DRAFT', userId: context.user.id, note: 'Изделие создано' },
        },
      },
      include: { components: true },
    });

    await recalcOrderTotals(tx, order.id);
    await writeAudit(tx, context, {
      action: 'workitem.create',
      entity: 'WorkItem',
      entityId: workItem.id,
      newValue: { number: workItem.number, price: workItem.price },
    });

    return { workItem, calculation };
  });
}

export interface UpdateWorkItemInput {
  title?: string;
  description?: string | null;
  workType?: string | null;
  spec?: FramingSpec;
  quantity?: number;
  discountPercent?: number;
  priority?: Priority;
  dueDate?: Date | null;
  masterId?: string | null;
  priceOverrides?: Record<string, number>;
}

/** Rebuilds a work item from its spec — components are replaced, not patched. */
export async function updateWorkItem(context: AppContext, workItemId: string, input: UpdateWorkItemInput) {
  const organizationId = context.user.organizationId;
  if (input.discountPercent !== undefined) assertDiscountAllowed(context, input.discountPercent);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.workItem.findFirst({
      where: { organizationId, id: workItemId },
    });
    if (!existing) throw new NotFoundError('Изделие');
    if (existing.materialsConsumedAt) {
      throw new ConflictError('Материалы уже списаны — изменение конструкции запрещено.');
    }
    if (['ISSUED', 'CLOSED', 'CANCELLED'].includes(existing.status)) {
      throw new ConflictError('Изделие закрыто и не может быть изменено.');
    }

    const spec = (input.spec ?? (existing.spec as unknown as FramingSpec)) as FramingSpec;
    const discountPercent = input.discountPercent ?? existing.discountPercent;
    const quantity = input.quantity ?? existing.quantity;

    const calculation = await calculateWorkItem(tx, organizationId, spec, {
      discountPercent,
      quantity,
      priceOverrides: input.priceOverrides,
    });

    await tx.workItemComponent.deleteMany({ where: { workItemId } });

    const workItem = await tx.workItem.update({
      where: { id: workItemId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.workType !== undefined ? { workType: input.workType } : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.dueDate !== undefined ? { dueDate: input.dueDate } : {}),
        ...(input.masterId !== undefined ? { masterId: input.masterId } : {}),
        quantity,
        discountPercent,
        widthMm: Math.round(spec.artworkWidthMm),
        heightMm: Math.round(spec.artworkHeightMm),
        orientation: spec.artworkWidthMm > spec.artworkHeightMm ? 'landscape' : 'portrait',
        spec: spec as never,
        calculation: calculation.calculation as never,
        materialCost: calculation.totals.materialCost,
        labourCost: calculation.totals.labourCost,
        extraCost: calculation.totals.extraCost,
        totalCost: calculation.totals.totalCost,
        subtotal: calculation.totals.subtotal,
        discountAmount: calculation.totals.discountAmount,
        taxAmount: calculation.totals.taxAmount,
        price: calculation.totals.price,
        margin: calculation.totals.margin,
        marginPercent: calculation.totals.marginPercent,
        components: {
          create: calculation.components.map((component) => ({
            group: component.group,
            catalogItemId: component.catalogItemId,
            name: component.name,
            role: component.role,
            sortOrder: component.sortOrder,
            quantity: component.quantity,
            consumedQuantity: component.consumedQuantity,
            wasteQuantity: component.wasteQuantity,
            unit: component.unit,
            pricingMethod: component.pricingMethod,
            unitCost: component.unitCost,
            cost: component.cost,
            unitPrice: component.unitPrice,
            price: component.price,
            discountPercent: component.discountPercent,
            discountAmount: component.discountAmount,
            isBillable: component.isBillable,
            meta: component.meta as never,
          })),
        },
      },
      include: { components: true },
    });

    // Materials were reserved against the previous construction — redo them.
    if (existing.materialsReservedAt) {
      await releaseReservations(tx, context, workItemId);
      await reserveForWorkItem(tx, context, workItemId);
    }

    await recalcOrderTotals(tx, existing.orderId);
    await writeAudit(tx, context, {
      action: 'workitem.update',
      entity: 'WorkItem',
      entityId: workItemId,
      oldValue: { price: existing.price, cost: existing.totalCost },
      newValue: { price: workItem.price, cost: workItem.totalCost },
    });

    return { workItem, calculation };
  });
}

export async function changeWorkItemStatus(
  context: AppContext,
  workItemId: string,
  toStatus: WorkItemStatus,
  note?: string,
) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const workItem = await tx.workItem.findFirst({
      where: { organizationId, id: workItemId },
      include: { qualityChecks: { include: { items: true }, orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!workItem) throw new NotFoundError('Изделие');
    if (workItem.status === toStatus) return workItem;

    if (!canTransition(workItem.status, toStatus)) {
      throw new ConflictError(
        `Недопустимый переход статуса: ${workItem.status} → ${toStatus}.`,
      );
    }

    // Quality control is a hard gate before a piece can be called ready.
    if (toStatus === 'READY') {
      const check = workItem.qualityChecks[0];
      const unfinished = check?.items.filter((item) => item.required && !item.checked) ?? [];
      if (!check || check.result !== 'PASSED' || unfinished.length > 0) {
        throw new ConflictError(
          'Изделие нельзя перевести в «Готово»: не пройден контроль качества.',
        );
      }
    }

    if (toStatus === 'ISSUED' && !workItem.materialsConsumedAt) {
      throw new ConflictError('Перед выдачей материалы должны быть списаны со склада.');
    }

    const updated = await tx.workItem.update({
      where: { id: workItemId },
      data: {
        status: toStatus,
        ...(toStatus === 'READY' ? { readyAt: new Date() } : {}),
        ...(toStatus === 'ISSUED' ? { issuedAt: new Date() } : {}),
        statusHistory: {
          create: { fromStatus: workItem.status, toStatus, userId: context.user.id, note },
        },
      },
    });

    if (toStatus === 'CANCELLED') {
      await releaseReservations(tx, context, workItemId);
    }

    await recalcOrderTotals(tx, workItem.orderId);
    await writeAudit(tx, context, {
      action: 'workitem.status',
      entity: 'WorkItem',
      entityId: workItemId,
      oldValue: { status: workItem.status },
      newValue: { status: toStatus, note },
    });

    if (toStatus === 'READY') {
      await notify(tx, {
        organizationId,
        type: 'ITEM_READY',
        title: `Изделие ${workItem.number} готово`,
        entityType: 'WorkItem',
        entityId: workItemId,
      });
    }

    return updated;
  });
}

/**
 * Confirms an order: locks the commercial track, reserves materials for every
 * piece and opens a production order with its tech card.
 */
export async function confirmOrder(context: AppContext, orderId: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(
    async (tx) => {
      const order = await tx.customerOrder.findFirst({
        where: { organizationId, id: orderId },
        include: { workItems: true },
      });
      if (!order) throw new NotFoundError('Заказ');
      if (order.commercialStatus === 'CONFIRMED') {
        throw new ConflictError('Заказ уже подтверждён.');
      }
      if (order.commercialStatus === 'CANCELLED') {
        throw new ConflictError('Отменённый заказ нельзя подтвердить.');
      }
      if (order.workItems.length === 0) {
        throw new ConflictError('В заказе нет ни одного изделия.');
      }

      const shortages = [];
      for (const item of order.workItems) {
        if (item.status === 'CANCELLED') continue;

        if (canTransition(item.status, 'CONFIRMED')) {
          await tx.workItem.update({
            where: { id: item.id },
            data: {
              status: 'CONFIRMED',
              statusHistory: {
                create: { fromStatus: item.status, toStatus: 'CONFIRMED', userId: context.user.id },
              },
            },
          });
        }

        const reservation = await reserveForWorkItem(tx, context, item.id);
        shortages.push(...reservation.shortages);

        await createProductionOrder(tx, context, item.id);
      }

      const updated = await tx.customerOrder.update({
        where: { id: orderId },
        data: { commercialStatus: 'CONFIRMED', confirmedAt: new Date() },
      });

      await recalcOrderTotals(tx, orderId);
      await writeAudit(tx, context, {
        action: 'order.confirm',
        entity: 'CustomerOrder',
        entityId: orderId,
        oldValue: { commercialStatus: order.commercialStatus },
        newValue: { commercialStatus: 'CONFIRMED', shortages: shortages.length },
      });

      if (shortages.length > 0) {
        await notify(tx, {
          organizationId,
          type: 'MATERIAL_SHORTAGE',
          title: `Заказ №${order.number}: не хватает материалов`,
          body: shortages.map((line) => `${line.name}: ${line.shortage} ${line.unit}`).join('; '),
          entityType: 'CustomerOrder',
          entityId: orderId,
        });
      }

      return { order: updated, shortages };
    },
    { timeout: 30_000 },
  );
}

export async function cancelOrder(context: AppContext, orderId: string, reason: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { organizationId, id: orderId },
      include: { workItems: true, payments: { where: { state: 'COMPLETED' } } },
    });
    if (!order) throw new NotFoundError('Заказ');
    if (order.workItems.some((item) => item.materialsConsumedAt)) {
      throw new ConflictError('По заказу уже списаны материалы — требуется возврат, а не отмена.');
    }

    for (const item of order.workItems) {
      await releaseReservations(tx, context, item.id);
      if (item.status !== 'CANCELLED') {
        await tx.workItem.update({
          where: { id: item.id },
          data: {
            status: 'CANCELLED',
            statusHistory: {
              create: {
                fromStatus: item.status,
                toStatus: 'CANCELLED',
                userId: context.user.id,
                note: reason,
              },
            },
          },
        });
      }
    }

    const updated = await tx.customerOrder.update({
      where: { id: orderId },
      data: { commercialStatus: 'CANCELLED', cancelledAt: new Date(), notes: reason },
    });

    await recalcOrderTotals(tx, orderId);
    await writeAudit(tx, context, {
      action: 'order.cancel',
      entity: 'CustomerOrder',
      entityId: orderId,
      newValue: { reason },
    });

    return updated;
  });
}

/** Hands the finished order to the customer and closes it. */
export async function issueOrder(context: AppContext, orderId: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { organizationId, id: orderId },
      include: { workItems: true },
    });
    if (!order) throw new NotFoundError('Заказ');

    const active = order.workItems.filter((item) => item.status !== 'CANCELLED');
    const notReady = active.filter((item) => !['READY', 'ISSUED', 'CLOSED'].includes(item.status));
    if (notReady.length > 0) {
      throw new ConflictError(
        `Не все изделия готовы к выдаче: ${notReady.map((item) => item.number).join(', ')}.`,
      );
    }

    for (const item of active) {
      if (item.status === 'READY') {
        await tx.workItem.update({
          where: { id: item.id },
          data: {
            status: 'ISSUED',
            issuedAt: new Date(),
            statusHistory: {
              create: { fromStatus: item.status, toStatus: 'ISSUED', userId: context.user.id },
            },
          },
        });
      }
    }

    const updated = await tx.customerOrder.update({
      where: { id: orderId },
      data: { issuedAt: new Date() },
    });

    await recalcOrderTotals(tx, orderId);
    await writeAudit(tx, context, {
      action: 'order.issue',
      entity: 'CustomerOrder',
      entityId: orderId,
      newValue: { issuedAt: updated.issuedAt },
    });

    return updated;
  });
}

/** Closes a fully paid and issued order. */
export async function closeOrder(context: AppContext, orderId: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { organizationId, id: orderId },
      include: { workItems: true },
    });
    if (!order) throw new NotFoundError('Заказ');
    if (!order.issuedAt) throw new ConflictError('Заказ ещё не выдан клиенту.');
    if (order.balance > 0) {
      throw new ConflictError('Заказ нельзя закрыть: есть задолженность клиента.');
    }

    for (const item of order.workItems) {
      if (item.status === 'ISSUED') {
        await tx.workItem.update({
          where: { id: item.id },
          data: {
            status: 'CLOSED',
            statusHistory: {
              create: { fromStatus: item.status, toStatus: 'CLOSED', userId: context.user.id },
            },
          },
        });
      }
    }

    const updated = await tx.customerOrder.update({
      where: { id: orderId },
      data: { closedAt: new Date() },
    });

    await recalcOrderTotals(tx, orderId);
    await writeAudit(tx, context, {
      action: 'order.close',
      entity: 'CustomerOrder',
      entityId: orderId,
      newValue: { closedAt: updated.closedAt },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export interface OrderListQuery {
  q?: string;
  customerId?: string;
  commercialStatus?: CommercialStatus;
  productionStatus?: OrderProductionStatus;
  paymentStatus?: string;
  managerId?: string;
  overdueOnly?: boolean;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

export async function listOrders(organizationId: string, query: OrderListQuery = {}) {
  const where: Prisma.CustomerOrderWhereInput = {
    organizationId,
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.commercialStatus ? { commercialStatus: query.commercialStatus } : {}),
    ...(query.productionStatus ? { productionStatus: query.productionStatus } : {}),
    ...(query.paymentStatus ? { paymentStatus: query.paymentStatus as never } : {}),
    ...(query.managerId ? { managerId: query.managerId } : {}),
    ...(query.overdueOnly
      ? {
          dueDate: { lt: new Date() },
          productionStatus: { in: ['WAITING', 'IN_PRODUCTION'] },
        }
      : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
    ...(query.q
      ? {
          OR: [
            { number: { contains: query.q, mode: 'insensitive' } },
            { customer: { phone: { contains: query.q } } },
            { customer: { lastName: { contains: query.q, mode: 'insensitive' } } },
            { customer: { companyName: { contains: query.q, mode: 'insensitive' } } },
            { workItems: { some: { title: { contains: query.q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customerOrder.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        customer: {
          select: { id: true, number: true, lastName: true, firstName: true, companyName: true, phone: true },
        },
        manager: { select: { id: true, firstName: true, lastName: true } },
        workItems: {
          select: {
            id: true,
            number: true,
            title: true,
            status: true,
            widthMm: true,
            heightMm: true,
            price: true,
            master: { select: { firstName: true, lastName: true } },
          },
        },
      },
    }),
    prisma.customerOrder.count({ where }),
  ]);

  return { items, total };
}

export async function getOrder(organizationId: string, orderId: string) {
  const order = await prisma.customerOrder.findFirst({
    where: { organizationId, id: orderId },
    include: {
      customer: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      createdBy: { select: { id: true, firstName: true, lastName: true } },
      branch: true,
      workItems: {
        orderBy: { seq: 'asc' },
        include: {
          components: { orderBy: { sortOrder: 'asc' }, include: { catalogItem: true } },
          master: { select: { id: true, firstName: true, lastName: true } },
          assignee: { select: { id: true, firstName: true, lastName: true } },
          statusHistory: {
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { firstName: true, lastName: true } } },
          },
          comments: {
            orderBy: { createdAt: 'desc' },
            include: { author: { select: { firstName: true, lastName: true } } },
          },
          designVariants: true,
          qualityChecks: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
          productionOrder: { include: { tasks: { orderBy: { seq: 'asc' } } } },
          reservations: { include: { inventoryItem: { include: { catalogItem: true } } } },
        },
      },
      payments: { where: { state: 'COMPLETED' }, orderBy: { paidAt: 'desc' } },
      invoices: { include: { items: true } },
      documents: { orderBy: { createdAt: 'desc' } },
    },
  });
  if (!order) throw new NotFoundError('Заказ');
  return order;
}

export async function getWorkItem(organizationId: string, workItemId: string) {
  const workItem = await prisma.workItem.findFirst({
    where: { organizationId, id: workItemId },
    include: {
      order: { include: { customer: true } },
      components: { orderBy: { sortOrder: 'asc' }, include: { catalogItem: true } },
      master: { select: { id: true, firstName: true, lastName: true } },
      statusHistory: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true } } },
      },
      comments: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      qualityChecks: { include: { items: { orderBy: { sortOrder: 'asc' } } } },
      productionOrder: {
        include: {
          tasks: {
            orderBy: { seq: 'asc' },
            include: { assignee: { select: { firstName: true, lastName: true } } },
          },
        },
      },
      designVariants: true,
      reservations: { include: { inventoryItem: { include: { catalogItem: true } } } },
    },
  });
  if (!workItem) throw new NotFoundError('Изделие');
  return workItem;
}

export async function addWorkItemComment(context: AppContext, workItemId: string, body: string) {
  const workItem = await prisma.workItem.findFirst({
    where: { organizationId: context.user.organizationId, id: workItemId },
  });
  if (!workItem) throw new NotFoundError('Изделие');

  return prisma.workItemComment.create({
    data: { workItemId, authorId: context.user.id, body },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
}
