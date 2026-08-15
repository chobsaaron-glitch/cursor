/**
 * Financial engine — invoices, payments and refunds.
 *
 * Two rules are enforced here and nowhere else:
 *   1. A payment never changes the commercial or production status of an order.
 *      Money and workflow are separate tracks (§53 of the specification).
 *   2. Financial records are never deleted. A mistake is corrected by voiding
 *      the record, which keeps the ledger auditable.
 */

import type { InvoiceStatus, PaymentKind, PaymentMethod } from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db';
import { ConflictError, DomainError, NotFoundError, type AppContext } from '@/server/lib/context';
import { nextNumber } from '@/server/lib/sequence';
import { writeAudit } from '@/server/modules/audit/service';
import { recalcOrderTotals } from '@/server/modules/orders/service';

export interface CreateInvoiceInput {
  orderId: string;
  dueAt?: Date | null;
  note?: string | null;
  /** Limits the invoice to selected pieces; defaults to every active one. */
  workItemIds?: string[];
}

export async function createInvoice(context: AppContext, input: CreateInvoiceInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.customerOrder.findFirst({
      where: { organizationId, id: input.orderId },
      include: { workItems: { where: { status: { not: 'CANCELLED' } } } },
    });
    if (!order) throw new NotFoundError('Заказ');

    const items = input.workItemIds
      ? order.workItems.filter((item) => input.workItemIds!.includes(item.id))
      : order.workItems;
    if (items.length === 0) throw new DomainError('Нет изделий для выставления счёта.');

    const number = await nextNumber(tx, organizationId, 'invoice', { padding: 4 });

    const subtotal = items.reduce((acc, item) => acc + item.subtotal, 0);
    const discountTotal = items.reduce((acc, item) => acc + item.discountAmount, 0);
    const taxTotal = items.reduce((acc, item) => acc + item.taxAmount, 0);
    const total = items.reduce((acc, item) => acc + item.price, 0);

    const invoice = await tx.invoice.create({
      data: {
        organizationId,
        number,
        customerId: order.customerId,
        orderId: order.id,
        status: 'ISSUED',
        dueAt: input.dueAt ?? null,
        note: input.note ?? null,
        subtotal,
        discountTotal,
        taxTotal,
        total,
        balance: total,
        items: {
          create: items.map((item) => ({
            workItemId: item.id,
            description: `${item.number} · ${item.title} · ${item.widthMm}×${item.heightMm} мм`,
            quantity: item.quantity,
            unitPrice: item.quantity > 0 ? Math.round(item.subtotal / item.quantity) : item.subtotal,
            discountAmount: item.discountAmount,
            taxAmount: item.taxAmount,
            total: item.price,
          })),
        },
      },
      include: { items: true },
    });

    await syncInvoiceBalance(tx, invoice.id);
    await writeAudit(tx, context, {
      action: 'invoice.create',
      entity: 'Invoice',
      entityId: invoice.id,
      newValue: { number, total },
    });

    return invoice;
  });
}

async function syncInvoiceBalance(tx: Db, invoiceId: string) {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    include: { payments: { where: { state: 'COMPLETED' } } },
  });
  if (!invoice) throw new NotFoundError('Счёт');
  if (invoice.status === 'VOIDED') return invoice;

  const paid = invoice.payments.reduce(
    (acc, payment) => acc + (payment.kind === 'PAYMENT' ? payment.amount : -payment.amount),
    0,
  );
  const balance = invoice.total - paid;
  const status: InvoiceStatus = paid <= 0 ? 'ISSUED' : balance > 0 ? 'PARTIALLY_PAID' : 'PAID';

  return tx.invoice.update({
    where: { id: invoiceId },
    data: { paidTotal: paid, balance, status },
  });
}

export interface RecordPaymentInput {
  orderId?: string | null;
  invoiceId?: string | null;
  customerId?: string;
  amount: number;
  method: PaymentMethod;
  kind?: PaymentKind;
  paidAt?: Date;
  note?: string | null;
}

/**
 * Records a payment or a refund. Partial payments are the normal case: the
 * order keeps its own status and only the payment track changes.
 */
export async function recordPayment(context: AppContext, input: RecordPaymentInput) {
  const organizationId = context.user.organizationId;
  if (input.amount <= 0) throw new DomainError('Сумма платежа должна быть больше нуля.');

  return prisma.$transaction(async (tx) => {
    let customerId = input.customerId;
    let orderId = input.orderId ?? null;

    if (input.invoiceId) {
      const invoice = await tx.invoice.findFirst({
        where: { organizationId, id: input.invoiceId },
      });
      if (!invoice) throw new NotFoundError('Счёт');
      if (invoice.status === 'VOIDED') throw new ConflictError('Счёт аннулирован.');
      customerId = invoice.customerId;
      orderId = orderId ?? invoice.orderId;
    }

    if (orderId) {
      const order = await tx.customerOrder.findFirst({ where: { organizationId, id: orderId } });
      if (!order) throw new NotFoundError('Заказ');
      if (order.commercialStatus === 'CANCELLED' && (input.kind ?? 'PAYMENT') === 'PAYMENT') {
        throw new ConflictError('Нельзя принять оплату по отменённому заказу.');
      }
      customerId = customerId ?? order.customerId;
    }

    if (!customerId) throw new DomainError('Не указан клиент для платежа.');

    // At the counter the clerk takes money for an order, not "against invoice
    // #123". Attach the payment to that order's open invoice so the invoice
    // balance can never drift away from the order balance.
    let invoiceId = input.invoiceId ?? null;
    if (!invoiceId && orderId) {
      const openInvoice = await tx.invoice.findFirst({
        where: { organizationId, orderId, status: { not: 'VOIDED' } },
        orderBy: { createdAt: 'desc' },
      });
      invoiceId = openInvoice?.id ?? null;
    }

    const kind = input.kind ?? 'PAYMENT';
    if (kind === 'REFUND') {
      const order = orderId
        ? await tx.customerOrder.findUnique({ where: { id: orderId } })
        : null;
      const refundable = order ? order.paidTotal - order.refundedTotal : Number.MAX_SAFE_INTEGER;
      if (input.amount > refundable) {
        throw new ConflictError('Сумма возврата превышает фактически оплаченную сумму.');
      }
    }

    const number = await nextNumber(tx, organizationId, 'payment', { padding: 5 });

    const payment = await tx.payment.create({
      data: {
        organizationId,
        number,
        customerId,
        orderId,
        invoiceId,
        kind,
        state: 'COMPLETED',
        method: input.method,
        amount: input.amount,
        paidAt: input.paidAt ?? new Date(),
        note: input.note ?? null,
        userId: context.user.id,
      },
    });

    if (invoiceId) await syncInvoiceBalance(tx, invoiceId);
    if (orderId) await recalcOrderTotals(tx, orderId);

    await writeAudit(tx, context, {
      action: kind === 'REFUND' ? 'payment.refund' : 'payment.create',
      entity: 'Payment',
      entityId: payment.id,
      newValue: { number, amount: input.amount, method: input.method, orderId },
    });

    return payment;
  });
}

/** Voids a payment. The record stays; only its state changes. */
export async function voidPayment(context: AppContext, paymentId: string, reason: string) {
  const organizationId = context.user.organizationId;
  if (!reason?.trim()) throw new DomainError('Для аннулирования платежа нужна причина.');

  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findFirst({ where: { organizationId, id: paymentId } });
    if (!payment) throw new NotFoundError('Платёж');
    if (payment.state === 'VOIDED') throw new ConflictError('Платёж уже аннулирован.');

    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: {
        state: 'VOIDED',
        voidedAt: new Date(),
        voidedById: context.user.id,
        voidReason: reason,
      },
    });

    if (payment.invoiceId) await syncInvoiceBalance(tx, payment.invoiceId);
    if (payment.orderId) await recalcOrderTotals(tx, payment.orderId);

    await writeAudit(tx, context, {
      action: 'payment.void',
      entity: 'Payment',
      entityId: paymentId,
      oldValue: { state: 'COMPLETED', amount: payment.amount },
      newValue: { state: 'VOIDED', reason },
    });

    return updated;
  });
}

export async function voidInvoice(context: AppContext, invoiceId: string, reason: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { organizationId, id: invoiceId },
      include: { payments: { where: { state: 'COMPLETED' } } },
    });
    if (!invoice) throw new NotFoundError('Счёт');
    if (invoice.payments.length > 0) {
      throw new ConflictError('Нельзя аннулировать счёт с проведёнными платежами.');
    }

    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'VOIDED', voidedAt: new Date(), voidReason: reason },
    });

    await writeAudit(tx, context, {
      action: 'invoice.void',
      entity: 'Invoice',
      entityId: invoiceId,
      newValue: { reason },
    });

    return updated;
  });
}

export interface PaymentListQuery {
  customerId?: string;
  orderId?: string;
  method?: PaymentMethod;
  from?: Date;
  to?: Date;
  includeVoided?: boolean;
  take?: number;
  skip?: number;
}

export async function listPayments(organizationId: string, query: PaymentListQuery = {}) {
  const where = {
    organizationId,
    ...(query.customerId ? { customerId: query.customerId } : {}),
    ...(query.orderId ? { orderId: query.orderId } : {}),
    ...(query.method ? { method: query.method } : {}),
    ...(query.includeVoided ? {} : { state: 'COMPLETED' as const }),
    ...(query.from || query.to
      ? { paidAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [items, total, aggregate] = await Promise.all([
    prisma.payment.findMany({
      where,
      orderBy: { paidAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        customer: { select: { id: true, lastName: true, firstName: true, companyName: true } },
        order: { select: { id: true, number: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.payment.count({ where }),
    prisma.payment.groupBy({ by: ['kind'], where, _sum: { amount: true } }),
  ]);

  const received = aggregate.find((row) => row.kind === 'PAYMENT')?._sum.amount ?? 0;
  const refunded = aggregate.find((row) => row.kind === 'REFUND')?._sum.amount ?? 0;

  return { items, total, received, refunded, net: received - refunded };
}

/** Customers with an outstanding balance, worst first. */
export async function debtors(organizationId: string) {
  const orders = await prisma.customerOrder.findMany({
    where: { organizationId, balance: { gt: 0 }, commercialStatus: { not: 'CANCELLED' } },
    include: {
      customer: { select: { id: true, number: true, lastName: true, firstName: true, companyName: true, phone: true } },
    },
    orderBy: { balance: 'desc' },
  });

  const byCustomer = new Map<
    string,
    { customer: (typeof orders)[number]['customer']; balance: number; orders: number; oldest: Date }
  >();

  for (const order of orders) {
    const entry = byCustomer.get(order.customerId);
    if (entry) {
      entry.balance += order.balance;
      entry.orders += 1;
      if (order.createdAt < entry.oldest) entry.oldest = order.createdAt;
    } else {
      byCustomer.set(order.customerId, {
        customer: order.customer,
        balance: order.balance,
        orders: 1,
        oldest: order.createdAt,
      });
    }
  }

  return [...byCustomer.values()].sort((a, b) => b.balance - a.balance);
}
