/**
 * Payroll.
 *
 * Piecework accrues automatically when a master finishes an operation
 * (see production/service.ts). This module closes a period: it collects the
 * open entries, adds the fixed/hourly part and produces a payroll record.
 */

import { round2 } from '@/lib/money';
import type { PayrollStatus } from '@/generated/prisma/client';
import { prisma } from '@/server/db';
import { ConflictError, NotFoundError, type AppContext } from '@/server/lib/context';
import { writeAudit } from '@/server/modules/audit/service';

export interface EarningsQuery {
  employeeId?: string;
  from: Date;
  to: Date;
}

export async function earnings(organizationId: string, query: EarningsQuery) {
  const entries = await prisma.payrollEntry.findMany({
    where: {
      employee: { organizationId },
      ...(query.employeeId ? { employeeId: query.employeeId } : {}),
      earnedAt: { gte: query.from, lte: query.to },
    },
    include: {
      employee: { select: { id: true, firstName: true, lastName: true, payType: true, baseRate: true } },
      productionTask: {
        include: { productionOrder: { include: { workItem: { select: { number: true, title: true } } } } },
      },
    },
    orderBy: { earnedAt: 'desc' },
  });

  const byEmployee = new Map<
    string,
    { employee: (typeof entries)[number]['employee']; amount: number; minutes: number; count: number }
  >();

  for (const entry of entries) {
    const bucket = byEmployee.get(entry.employeeId) ?? {
      employee: entry.employee,
      amount: 0,
      minutes: 0,
      count: 0,
    };
    bucket.amount += entry.amount;
    bucket.minutes += entry.minutes;
    bucket.count += 1;
    byEmployee.set(entry.employeeId, bucket);
  }

  return {
    entries,
    byEmployee: [...byEmployee.values()].map((bucket) => ({
      ...bucket,
      minutes: round2(bucket.minutes),
      hourlyEquivalent: bucket.minutes > 0 ? Math.round((bucket.amount / bucket.minutes) * 60) : 0,
    })),
    total: entries.reduce((acc, entry) => acc + entry.amount, 0),
  };
}

export interface ClosePeriodInput {
  employeeId: string;
  periodStart: Date;
  periodEnd: Date;
  bonus?: number;
  deductions?: number;
  /** Hours worked, used for the HOURLY and MIXED schemes. */
  hours?: number;
}

/** Closes a payroll period and attaches every open entry to the record. */
export async function closePeriod(context: AppContext, input: ClosePeriodInput) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const employee = await tx.employee.findFirst({
      where: { organizationId, id: input.employeeId },
    });
    if (!employee) throw new NotFoundError('Сотрудник');

    const existing = await tx.payrollRecord.findFirst({
      where: { organizationId, employeeId: input.employeeId, periodStart: input.periodStart },
    });
    if (existing && existing.status === 'PAID') {
      throw new ConflictError('Период уже закрыт и выплачен.');
    }

    const entries = await tx.payrollEntry.findMany({
      where: {
        employeeId: input.employeeId,
        payrollRecordId: null,
        earnedAt: { gte: input.periodStart, lte: input.periodEnd },
      },
    });

    const pieceworkTotal = entries.reduce((acc, entry) => acc + entry.amount, 0);
    const hourlyTotal =
      employee.payType === 'HOURLY' || employee.payType === 'MIXED'
        ? Math.round(employee.baseRate * (input.hours ?? 0))
        : employee.payType === 'FIXED'
          ? employee.baseRate
          : 0;

    const bonus = input.bonus ?? 0;
    const deductions = input.deductions ?? 0;
    const total = pieceworkTotal + hourlyTotal + bonus - deductions;

    const record = existing
      ? await tx.payrollRecord.update({
          where: { id: existing.id },
          data: { pieceworkTotal, hourlyTotal, bonus, deductions, total, periodEnd: input.periodEnd },
        })
      : await tx.payrollRecord.create({
          data: {
            organizationId,
            employeeId: input.employeeId,
            periodStart: input.periodStart,
            periodEnd: input.periodEnd,
            pieceworkTotal,
            hourlyTotal,
            bonus,
            deductions,
            total,
          },
        });

    await tx.payrollEntry.updateMany({
      where: { id: { in: entries.map((entry) => entry.id) } },
      data: { payrollRecordId: record.id },
    });

    await writeAudit(tx, context, {
      action: 'payroll.close',
      entity: 'PayrollRecord',
      entityId: record.id,
      newValue: { employeeId: input.employeeId, total, entries: entries.length },
    });

    return record;
  });
}

export async function setPayrollStatus(context: AppContext, recordId: string, status: PayrollStatus) {
  const record = await prisma.payrollRecord.findFirst({
    where: { organizationId: context.user.organizationId, id: recordId },
  });
  if (!record) throw new NotFoundError('Расчёт зарплаты');

  const updated = await prisma.payrollRecord.update({ where: { id: recordId }, data: { status } });
  await writeAudit(prisma, context, {
    action: 'payroll.status',
    entity: 'PayrollRecord',
    entityId: recordId,
    oldValue: { status: record.status },
    newValue: { status },
  });
  return updated;
}

export async function listPayroll(organizationId: string, query: { employeeId?: string } = {}) {
  return prisma.payrollRecord.findMany({
    where: { organizationId, ...(query.employeeId ? { employeeId: query.employeeId } : {}) },
    orderBy: { periodStart: 'desc' },
    include: {
      employee: { select: { firstName: true, lastName: true, position: true, payType: true } },
      entries: true,
    },
  });
}

/** Earnings for one order — what the shop paid its masters to produce it. */
export async function orderLabourCost(organizationId: string, orderId: string) {
  const entries = await prisma.payrollEntry.findMany({
    where: {
      employee: { organizationId },
      productionTask: { productionOrder: { workItem: { orderId } } },
    },
    include: {
      employee: { select: { firstName: true, lastName: true } },
      productionTask: { select: { name: true, standardMinutes: true, actualMinutes: true } },
    },
  });

  return {
    entries,
    total: entries.reduce((acc, entry) => acc + entry.amount, 0),
    minutes: round2(entries.reduce((acc, entry) => acc + entry.minutes, 0)),
  };
}
