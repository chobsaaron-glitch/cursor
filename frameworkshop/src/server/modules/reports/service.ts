/**
 * Reporting and analytics.
 *
 * Every figure is derived from the transactional tables — nothing is stored in
 * a parallel "reporting" shape that could drift from the ledger.
 */

import { marginPercent, round2 } from '@/lib/money';
import { round4 } from '@/lib/units';
import { prisma } from '@/server/db';

export interface Period {
  from: Date;
  to: Date;
}

export function today(): Period {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date(from);
  to.setDate(to.getDate() + 1);
  return { from, to };
}

export function lastDays(days: number): Period {
  const to = new Date();
  const from = new Date(to);
  from.setDate(from.getDate() - days);
  from.setHours(0, 0, 0, 0);
  return { from, to };
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function dashboardSummary(organizationId: string) {
  const day = today();
  const month = lastDays(30);
  const now = new Date();

  const [
    ordersToday,
    revenueToday,
    paymentsToday,
    prepayments,
    debtAggregate,
    inProduction,
    overdue,
    readyToIssue,
    monthOrders,
    lowStock,
    activeMasters,
  ] = await Promise.all([
    prisma.customerOrder.count({
      where: { organizationId, createdAt: { gte: day.from, lt: day.to } },
    }),
    prisma.customerOrder.aggregate({
      where: {
        organizationId,
        createdAt: { gte: day.from, lt: day.to },
        commercialStatus: { not: 'CANCELLED' },
      },
      _sum: { total: true, costTotal: true },
    }),
    prisma.payment.aggregate({
      where: {
        organizationId,
        state: 'COMPLETED',
        kind: 'PAYMENT',
        paidAt: { gte: day.from, lt: day.to },
      },
      _sum: { amount: true },
    }),
    prisma.customerOrder.aggregate({
      where: {
        organizationId,
        paymentStatus: 'PARTIAL',
        commercialStatus: { not: 'CANCELLED' },
      },
      _sum: { paidTotal: true },
    }),
    prisma.customerOrder.aggregate({
      where: { organizationId, balance: { gt: 0 }, commercialStatus: { not: 'CANCELLED' } },
      _sum: { balance: true },
      _count: true,
    }),
    prisma.workItem.count({
      where: {
        organizationId,
        status: { in: ['AWAITING_MATERIALS', 'MATERIALS_READY', 'IN_PRODUCTION', 'QUALITY_CHECK'] },
      },
    }),
    prisma.workItem.count({
      where: {
        organizationId,
        dueDate: { lt: now },
        status: { notIn: ['READY', 'ISSUED', 'CLOSED', 'CANCELLED'] },
      },
    }),
    prisma.workItem.count({ where: { organizationId, status: 'READY' } }),
    prisma.customerOrder.aggregate({
      where: {
        organizationId,
        createdAt: { gte: month.from, lte: month.to },
        commercialStatus: { not: 'CANCELLED' },
      },
      _sum: { total: true, costTotal: true, taxTotal: true },
      _count: true,
    }),
    prisma.inventoryItem.findMany({
      where: { organizationId },
      include: { catalogItem: { select: { name: true, unit: true, internalSku: true } } },
    }),
    prisma.productionTask.groupBy({
      by: ['assigneeId'],
      where: { productionOrder: { organizationId }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
      _sum: { standardMinutes: true },
      _count: true,
    }),
  ]);

  const monthRevenue = monthOrders._sum.total ?? 0;
  const monthCost = monthOrders._sum.costTotal ?? 0;
  const monthNet = monthRevenue - (monthOrders._sum.taxTotal ?? 0);

  const critical = lowStock
    .filter((item) => item.quantityOnHand - item.quantityReserved <= item.reorderPoint)
    .map((item) => ({
      catalogItemId: item.catalogItemId,
      name: item.catalogItem.name,
      sku: item.catalogItem.internalSku,
      unit: item.catalogItem.unit,
      available: round4(item.quantityOnHand - item.quantityReserved),
      reorderPoint: item.reorderPoint,
    }));

  return {
    ordersToday,
    revenueToday: revenueToday._sum.total ?? 0,
    paidToday: paymentsToday._sum.amount ?? 0,
    prepayments: prepayments._sum.paidTotal ?? 0,
    debt: debtAggregate._sum.balance ?? 0,
    debtorCount: debtAggregate._count,
    inProduction,
    overdue,
    readyToIssue,
    averageTicket: monthOrders._count > 0 ? Math.round(monthRevenue / monthOrders._count) : 0,
    grossProfit: monthNet - monthCost,
    marginPercent: marginPercent(monthNet, monthCost),
    monthRevenue,
    monthOrders: monthOrders._count,
    criticalStock: critical.slice(0, 10),
    criticalStockCount: critical.length,
    workload: activeMasters.map((row) => ({
      userId: row.assigneeId,
      minutes: round2(row._sum.standardMinutes ?? 0),
      tasks: row._count,
    })),
  };
}

/** Revenue, cost and profit per day for the dashboard chart. */
export async function revenueSeries(organizationId: string, days = 30) {
  const period = lastDays(days);
  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId,
      createdAt: { gte: period.from, lte: period.to },
      commercialStatus: { not: 'CANCELLED' },
    },
    select: { createdAt: true, total: true, costTotal: true, taxTotal: true },
  });

  const buckets = new Map<string, { revenue: number; cost: number; orders: number }>();
  for (let index = 0; index < days; index += 1) {
    const date = new Date(period.from);
    date.setDate(date.getDate() + index);
    buckets.set(date.toISOString().slice(0, 10), { revenue: 0, cost: 0, orders: 0 });
  }

  for (const order of orders) {
    const key = order.createdAt.toISOString().slice(0, 10);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.revenue += order.total - order.taxTotal;
    bucket.cost += order.costTotal;
    bucket.orders += 1;
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    revenue: bucket.revenue,
    cost: bucket.cost,
    profit: bucket.revenue - bucket.cost,
    orders: bucket.orders,
    averageTicket: bucket.orders > 0 ? Math.round(bucket.revenue / bucket.orders) : 0,
  }));
}

// ---------------------------------------------------------------------------
// Sales
// ---------------------------------------------------------------------------

export async function salesByEmployee(organizationId: string, period: Period) {
  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId,
      createdAt: { gte: period.from, lte: period.to },
      commercialStatus: { not: 'CANCELLED' },
    },
    include: { manager: { select: { id: true, firstName: true, lastName: true } } },
  });

  const byManager = new Map<string, { name: string; revenue: number; cost: number; orders: number }>();
  for (const order of orders) {
    const key = order.managerId ?? 'unassigned';
    const bucket = byManager.get(key) ?? {
      name: order.manager ? `${order.manager.lastName} ${order.manager.firstName}` : 'Без менеджера',
      revenue: 0,
      cost: 0,
      orders: 0,
    };
    bucket.revenue += order.total - order.taxTotal;
    bucket.cost += order.costTotal;
    bucket.orders += 1;
    byManager.set(key, bucket);
  }

  return [...byManager.entries()]
    .map(([id, bucket]) => ({
      id,
      ...bucket,
      profit: bucket.revenue - bucket.cost,
      averageTicket: bucket.orders > 0 ? Math.round(bucket.revenue / bucket.orders) : 0,
      marginPercent: marginPercent(bucket.revenue, bucket.cost),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Sales split by component group — what the shop actually earns money on. */
export async function salesByGroup(organizationId: string, period: Period) {
  const components = await prisma.workItemComponent.findMany({
    where: {
      workItem: {
        organizationId,
        createdAt: { gte: period.from, lte: period.to },
        status: { not: 'CANCELLED' },
      },
    },
    select: { group: true, price: true, cost: true, quantity: true },
  });

  const byGroup = new Map<string, { revenue: number; cost: number; quantity: number; lines: number }>();
  for (const component of components) {
    const bucket = byGroup.get(component.group) ?? { revenue: 0, cost: 0, quantity: 0, lines: 0 };
    bucket.revenue += component.price;
    bucket.cost += component.cost;
    bucket.quantity += component.quantity;
    bucket.lines += 1;
    byGroup.set(component.group, bucket);
  }

  return [...byGroup.entries()]
    .map(([group, bucket]) => ({
      group,
      ...bucket,
      quantity: round4(bucket.quantity),
      profit: bucket.revenue - bucket.cost,
      marginPercent: marginPercent(bucket.revenue, bucket.cost),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** ABC analysis of mouldings: revenue, metres sold and profit per metre. */
export async function mouldingAbc(organizationId: string, period: Period) {
  const components = await prisma.workItemComponent.findMany({
    where: {
      group: 'MOULDING',
      catalogItemId: { not: null },
      workItem: {
        organizationId,
        createdAt: { gte: period.from, lte: period.to },
        status: { not: 'CANCELLED' },
      },
    },
    include: { catalogItem: { select: { id: true, name: true, internalSku: true, unit: true } } },
  });

  const byItem = new Map<
    string,
    { name: string; sku: string; revenue: number; cost: number; metres: number; orders: number }
  >();

  for (const component of components) {
    if (!component.catalogItem) continue;
    const bucket = byItem.get(component.catalogItem.id) ?? {
      name: component.catalogItem.name,
      sku: component.catalogItem.internalSku,
      revenue: 0,
      cost: 0,
      metres: 0,
      orders: 0,
    };
    bucket.revenue += component.price;
    bucket.cost += component.cost;
    bucket.metres += component.consumedQuantity;
    bucket.orders += 1;
    byItem.set(component.catalogItem.id, bucket);
  }

  const rows = [...byItem.entries()]
    .map(([id, bucket]) => ({
      catalogItemId: id,
      ...bucket,
      metres: round4(bucket.metres),
      profit: bucket.revenue - bucket.cost,
      revenuePerMetre: bucket.metres > 0 ? Math.round(bucket.revenue / bucket.metres) : 0,
      profitPerMetre: bucket.metres > 0 ? Math.round((bucket.revenue - bucket.cost) / bucket.metres) : 0,
      marginPercent: marginPercent(bucket.revenue, bucket.cost),
    }))
    .sort((a, b) => b.revenue - a.revenue);

  const totalRevenue = rows.reduce((acc, row) => acc + row.revenue, 0);
  let cumulative = 0;

  return rows.map((row) => {
    cumulative += row.revenue;
    const share = totalRevenue > 0 ? cumulative / totalRevenue : 0;
    return { ...row, abc: share <= 0.8 ? 'A' : share <= 0.95 ? 'B' : 'C' };
  });
}

// ---------------------------------------------------------------------------
// Finance
// ---------------------------------------------------------------------------

export async function financeSummary(organizationId: string, period: Period) {
  const [orders, payments, expenses, payroll] = await Promise.all([
    prisma.customerOrder.aggregate({
      where: {
        organizationId,
        createdAt: { gte: period.from, lte: period.to },
        commercialStatus: { not: 'CANCELLED' },
      },
      _sum: { total: true, costTotal: true, taxTotal: true, discountTotal: true, balance: true },
      _count: true,
    }),
    prisma.payment.groupBy({
      by: ['kind', 'method'],
      where: { organizationId, state: 'COMPLETED', paidAt: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
    }),
    prisma.expense.aggregate({
      where: { organizationId, spentAt: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
    }),
    prisma.payrollEntry.aggregate({
      where: { employee: { organizationId }, earnedAt: { gte: period.from, lte: period.to } },
      _sum: { amount: true },
    }),
  ]);

  const revenue = (orders._sum.total ?? 0) - (orders._sum.taxTotal ?? 0);
  const cost = orders._sum.costTotal ?? 0;
  const otherExpenses = expenses._sum.amount ?? 0;

  return {
    orderCount: orders._count,
    revenue,
    tax: orders._sum.taxTotal ?? 0,
    discounts: orders._sum.discountTotal ?? 0,
    cost,
    grossProfit: revenue - cost,
    marginPercent: marginPercent(revenue, cost),
    expenses: otherExpenses,
    payroll: payroll._sum.amount ?? 0,
    netProfit: revenue - cost - otherExpenses,
    debt: orders._sum.balance ?? 0,
    averageTicket: orders._count > 0 ? Math.round(revenue / orders._count) : 0,
    paymentsByMethod: payments
      .filter((row) => row.kind === 'PAYMENT')
      .map((row) => ({ method: row.method, amount: row._sum.amount ?? 0 })),
    refunds: payments
      .filter((row) => row.kind === 'REFUND')
      .reduce((acc, row) => acc + (row._sum.amount ?? 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Production & inventory
// ---------------------------------------------------------------------------

export async function productionSummary(organizationId: string, period: Period) {
  const tasks = await prisma.productionTask.findMany({
    where: {
      productionOrder: { organizationId },
      finishedAt: { gte: period.from, lte: period.to },
      status: 'DONE',
    },
    include: { assignee: { select: { id: true, firstName: true, lastName: true } } },
  });

  const byMaster = new Map<
    string,
    { name: string; tasks: number; standardMinutes: number; actualMinutes: number; pay: number }
  >();

  for (const task of tasks) {
    const key = task.assigneeId ?? 'unassigned';
    const bucket = byMaster.get(key) ?? {
      name: task.assignee ? `${task.assignee.lastName} ${task.assignee.firstName}` : 'Не назначен',
      tasks: 0,
      standardMinutes: 0,
      actualMinutes: 0,
      pay: 0,
    };
    bucket.tasks += 1;
    bucket.standardMinutes += task.standardMinutes;
    bucket.actualMinutes += task.actualMinutes;
    bucket.pay += task.payAmount;
    byMaster.set(key, bucket);
  }

  const overdue = await prisma.workItem.count({
    where: {
      organizationId,
      dueDate: { lt: new Date() },
      status: { notIn: ['READY', 'ISSUED', 'CLOSED', 'CANCELLED'] },
    },
  });

  return {
    completedTasks: tasks.length,
    overdue,
    byMaster: [...byMaster.entries()]
      .map(([id, bucket]) => ({
        id,
        ...bucket,
        standardMinutes: round2(bucket.standardMinutes),
        actualMinutes: round2(bucket.actualMinutes),
        efficiencyPercent:
          bucket.actualMinutes > 0 ? round2((bucket.standardMinutes / bucket.actualMinutes) * 100) : 0,
      }))
      .sort((a, b) => b.tasks - a.tasks),
  };
}

export async function inventoryReport(organizationId: string) {
  const items = await prisma.inventoryItem.findMany({
    where: { organizationId },
    include: {
      catalogItem: { select: { id: true, name: true, internalSku: true, group: true, unit: true } },
    },
  });

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400_000);

  const rows = items.map((item) => ({
    catalogItemId: item.catalogItemId,
    name: item.catalogItem.name,
    sku: item.catalogItem.internalSku,
    group: item.catalogItem.group,
    unit: item.catalogItem.unit,
    onHand: item.quantityOnHand,
    reserved: item.quantityReserved,
    available: round4(item.quantityOnHand - item.quantityReserved),
    value: Math.round(item.avgCost * item.quantityOnHand),
    isLow: item.quantityOnHand - item.quantityReserved <= item.reorderPoint,
    isStale: item.quantityOnHand > 0 && (!item.lastIssuedAt || item.lastIssuedAt < ninetyDaysAgo),
  }));

  return {
    rows: rows.sort((a, b) => b.value - a.value),
    totalValue: rows.reduce((acc, row) => acc + row.value, 0),
    lowCount: rows.filter((row) => row.isLow).length,
    staleCount: rows.filter((row) => row.isStale).length,
  };
}

/** Material consumption and waste from the ledger. */
export async function consumptionReport(organizationId: string, period: Period) {
  const transactions = await prisma.inventoryTransaction.findMany({
    where: {
      organizationId,
      type: { in: ['ISSUE', 'WASTE', 'WRITE_OFF'] },
      createdAt: { gte: period.from, lte: period.to },
    },
    include: {
      inventoryItem: {
        include: { catalogItem: { select: { id: true, name: true, unit: true, group: true } } },
      },
    },
  });

  const byItem = new Map<
    string,
    { name: string; unit: string; group: string; used: number; waste: number; writeOff: number; cost: number }
  >();

  for (const transaction of transactions) {
    const catalogItem = transaction.inventoryItem.catalogItem;
    const bucket = byItem.get(catalogItem.id) ?? {
      name: catalogItem.name,
      unit: catalogItem.unit,
      group: catalogItem.group,
      used: 0,
      waste: 0,
      writeOff: 0,
      cost: 0,
    };
    const quantity = Math.abs(transaction.quantity);
    if (transaction.type === 'ISSUE') bucket.used += quantity;
    if (transaction.type === 'WASTE') bucket.waste += quantity;
    if (transaction.type === 'WRITE_OFF') bucket.writeOff += quantity;
    bucket.cost += transaction.totalCost;
    byItem.set(catalogItem.id, bucket);
  }

  return [...byItem.entries()]
    .map(([id, bucket]) => ({
      catalogItemId: id,
      ...bucket,
      used: round4(bucket.used),
      waste: round4(bucket.waste),
      writeOff: round4(bucket.writeOff),
      wastePercent:
        bucket.used + bucket.waste > 0
          ? round2((bucket.waste / (bucket.used + bucket.waste)) * 100)
          : 0,
    }))
    .sort((a, b) => b.cost - a.cost);
}

/** Per-order profitability, the number an owner looks at first. */
export async function orderProfitability(organizationId: string, period: Period) {
  const orders = await prisma.customerOrder.findMany({
    where: {
      organizationId,
      createdAt: { gte: period.from, lte: period.to },
      commercialStatus: { not: 'CANCELLED' },
    },
    include: {
      customer: { select: { lastName: true, firstName: true, companyName: true } },
      workItems: { select: { materialCost: true, labourCost: true, extraCost: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return orders.map((order) => {
    const revenue = order.total - order.taxTotal;
    const materials = order.workItems.reduce((acc, item) => acc + item.materialCost, 0);
    const labour = order.workItems.reduce((acc, item) => acc + item.labourCost, 0);
    const other = order.workItems.reduce((acc, item) => acc + item.extraCost, 0);
    const cost = materials + labour + other;
    return {
      id: order.id,
      number: order.number,
      createdAt: order.createdAt,
      customer:
        order.customer.companyName ??
        [order.customer.lastName, order.customer.firstName].filter(Boolean).join(' '),
      revenue,
      materials,
      labour,
      other,
      cost,
      grossProfit: revenue - cost,
      marginPercent: marginPercent(revenue, cost),
    };
  });
}
