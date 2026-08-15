/**
 * Customer module — the CRM half of the system: profile, order history, money,
 * communication log and the analytics a workshop actually acts on (LTV, average
 * ticket, order frequency, last/next contact).
 */

import type { CommunicationChannel, CommunicationDirection, CustomerType, Prisma } from '@/generated/prisma/client';
import { prisma } from '@/server/db';
import { NotFoundError, type AppContext } from '@/server/lib/context';
import { nextNumber } from '@/server/lib/sequence';
import { writeAudit } from '@/server/modules/audit/service';

export interface CustomerInput {
  type?: CustomerType;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
  companyName?: string | null;
  inn?: string | null;
  phone: string;
  phone2?: string | null;
  email?: string | null;
  telegram?: string | null;
  whatsapp?: string | null;
  address?: string | null;
  city?: string | null;
  birthDate?: Date | null;
  sourceId?: string | null;
  managerId?: string | null;
  note?: string | null;
  marketingConsent?: boolean;
  discountPercent?: number;
  segment?: string | null;
  nextContactAt?: Date | null;
}

/** Digits only, so "+7 (912) 345-67-89" and "89123456789" find each other. */
export function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  if (digits.length === 10) return `7${digits}`;
  return digits;
}

export async function createCustomer(context: AppContext, input: CustomerInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const number = await nextNumber(tx, organizationId, 'customer', { padding: 5 });

    const customer = await tx.customer.create({
      data: {
        organizationId,
        number,
        type: input.type ?? 'PERSON',
        lastName: input.lastName ?? null,
        firstName: input.firstName ?? null,
        middleName: input.middleName ?? null,
        companyName: input.companyName ?? null,
        inn: input.inn ?? null,
        phone: normalisePhone(input.phone),
        phone2: input.phone2 ? normalisePhone(input.phone2) : null,
        email: input.email ?? null,
        telegram: input.telegram ?? null,
        whatsapp: input.whatsapp ?? null,
        address: input.address ?? null,
        city: input.city ?? null,
        birthDate: input.birthDate ?? null,
        sourceId: input.sourceId ?? null,
        managerId: input.managerId ?? context.user.id,
        note: input.note ?? null,
        marketingConsent: input.marketingConsent ?? false,
        discountPercent: input.discountPercent ?? 0,
        segment: input.segment ?? null,
        nextContactAt: input.nextContactAt ?? null,
      },
    });

    await writeAudit(tx, context, {
      action: 'customer.create',
      entity: 'Customer',
      entityId: customer.id,
      newValue: { number, phone: customer.phone },
    });

    return customer;
  });
}

export async function updateCustomer(context: AppContext, id: string, input: Partial<CustomerInput>) {
  const organizationId = context.user.organizationId;
  const existing = await prisma.customer.findFirst({ where: { organizationId, id } });
  if (!existing) throw new NotFoundError('Клиент');

  const customer = await prisma.customer.update({
    where: { id },
    data: {
      ...input,
      ...(input.phone ? { phone: normalisePhone(input.phone) } : {}),
      ...(input.phone2 ? { phone2: normalisePhone(input.phone2) } : {}),
    },
  });

  await writeAudit(prisma, context, {
    action: 'customer.update',
    entity: 'Customer',
    entityId: id,
    newValue: { ...input },
  });

  return customer;
}

export interface CustomerListQuery {
  q?: string;
  managerId?: string;
  sourceId?: string;
  type?: CustomerType;
  segment?: string;
  withDebtOnly?: boolean;
  take?: number;
  skip?: number;
}

export async function listCustomers(organizationId: string, query: CustomerListQuery = {}) {
  const term = query.q?.trim();
  const phoneDigits = term ? term.replace(/\D/g, '') : '';

  const where: Prisma.CustomerWhereInput = {
    organizationId,
    ...(query.managerId ? { managerId: query.managerId } : {}),
    ...(query.sourceId ? { sourceId: query.sourceId } : {}),
    ...(query.type ? { type: query.type } : {}),
    ...(query.segment ? { segment: query.segment } : {}),
    ...(term
      ? {
          OR: [
            { number: { contains: term, mode: 'insensitive' } },
            { lastName: { contains: term, mode: 'insensitive' } },
            { firstName: { contains: term, mode: 'insensitive' } },
            { companyName: { contains: term, mode: 'insensitive' } },
            { email: { contains: term, mode: 'insensitive' } },
            ...(phoneDigits.length >= 3 ? [{ phone: { contains: phoneDigits } }] : []),
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: {
        source: { select: { name: true } },
        manager: { select: { firstName: true, lastName: true } },
        orders: { select: { total: true, balance: true, createdAt: true } },
      },
    }),
    prisma.customer.count({ where }),
  ]);

  const mapped = items.map((customer) => {
    const orders = customer.orders;
    const revenue = orders.reduce((acc, order) => acc + order.total, 0);
    const debt = orders.reduce((acc, order) => acc + Math.max(0, order.balance), 0);
    return {
      ...customer,
      orders: undefined,
      stats: {
        orderCount: orders.length,
        revenue,
        debt,
        averageTicket: orders.length > 0 ? Math.round(revenue / orders.length) : 0,
        lastOrderAt: orders.reduce<Date | null>(
          (latest, order) => (latest === null || order.createdAt > latest ? order.createdAt : latest),
          null,
        ),
      },
    };
  });

  return {
    items: query.withDebtOnly ? mapped.filter((customer) => customer.stats.debt > 0) : mapped,
    total,
  };
}

/** Full customer card: profile, history, money and analytics in one payload. */
export async function getCustomer(organizationId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { organizationId, id },
    include: {
      source: true,
      manager: { select: { id: true, firstName: true, lastName: true } },
      contacts: true,
      addresses: true,
      notes: {
        orderBy: { createdAt: 'desc' },
        include: { author: { select: { firstName: true, lastName: true } } },
      },
      communications: {
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { firstName: true, lastName: true } } },
      },
      orders: {
        orderBy: { createdAt: 'desc' },
        include: {
          workItems: { select: { id: true, number: true, title: true, status: true, price: true } },
        },
      },
      payments: { where: { state: 'COMPLETED' }, orderBy: { paidAt: 'desc' } },
      invoices: { orderBy: { issuedAt: 'desc' } },
    },
  });
  if (!customer) throw new NotFoundError('Клиент');

  const orders = customer.orders;
  const activeOrders = orders.filter(
    (order) => order.commercialStatus !== 'CANCELLED' && order.closedAt === null,
  );
  const completedOrders = orders.filter((order) => order.closedAt !== null);

  const revenue = orders
    .filter((order) => order.commercialStatus !== 'CANCELLED')
    .reduce((acc, order) => acc + order.total, 0);
  const paid = customer.payments
    .filter((payment) => payment.kind === 'PAYMENT')
    .reduce((acc, payment) => acc + payment.amount, 0);
  const refunded = customer.payments
    .filter((payment) => payment.kind === 'REFUND')
    .reduce((acc, payment) => acc + payment.amount, 0);
  const debt = orders.reduce((acc, order) => acc + Math.max(0, order.balance), 0);

  const sortedDates = orders.map((order) => order.createdAt).sort((a, b) => a.getTime() - b.getTime());
  const spanDays =
    sortedDates.length > 1
      ? (sortedDates[sortedDates.length - 1].getTime() - sortedDates[0].getTime()) / 86_400_000
      : 0;

  return {
    ...customer,
    activeOrders,
    completedOrders,
    stats: {
      orderCount: orders.length,
      revenue,
      paid,
      refunded,
      debt,
      discountTotal: orders.reduce((acc, order) => acc + order.discountTotal, 0),
      averageTicket: orders.length > 0 ? Math.round(revenue / orders.length) : 0,
      ltv: revenue,
      lastOrderAt: sortedDates.at(-1) ?? null,
      firstOrderAt: sortedDates.at(0) ?? null,
      orderFrequencyDays:
        sortedDates.length > 1 ? Math.round(spanDays / (sortedDates.length - 1)) : null,
    },
  };
}

export async function addCustomerNote(context: AppContext, customerId: string, body: string) {
  return prisma.customerNote.create({
    data: { customerId, authorId: context.user.id, body },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
}

export async function logCommunication(
  context: AppContext,
  input: {
    customerId: string;
    channel: CommunicationChannel;
    direction: CommunicationDirection;
    subject?: string | null;
    body: string;
  },
) {
  const [communication] = await prisma.$transaction([
    prisma.customerCommunication.create({
      data: {
        customerId: input.customerId,
        userId: context.user.id,
        channel: input.channel,
        direction: input.direction,
        subject: input.subject ?? null,
        body: input.body,
      },
    }),
    prisma.customer.update({
      where: { id: input.customerId },
      data: { lastContactAt: new Date() },
    }),
  ]);
  return communication;
}

/** ABC segmentation of the customer base by revenue. */
export async function segmentCustomers(organizationId: string) {
  const customers = await prisma.customer.findMany({
    where: { organizationId },
    include: { orders: { where: { commercialStatus: { not: 'CANCELLED' } }, select: { total: true } } },
  });

  const withRevenue = customers
    .map((customer) => ({
      id: customer.id,
      number: customer.number,
      name: customer.companyName ?? [customer.lastName, customer.firstName].filter(Boolean).join(' '),
      revenue: customer.orders.reduce((acc, order) => acc + order.total, 0),
      orderCount: customer.orders.length,
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = withRevenue.reduce((acc, customer) => acc + customer.revenue, 0);
  let cumulative = 0;

  return withRevenue.map((customer) => {
    cumulative += customer.revenue;
    const share = totalRevenue > 0 ? cumulative / totalRevenue : 0;
    return {
      ...customer,
      share: totalRevenue > 0 ? customer.revenue / totalRevenue : 0,
      segment: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C',
    };
  });
}
