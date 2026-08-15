/**
 * Production engine.
 *
 * Turns a confirmed work item into a production order with a tech card, tracks
 * the time each master actually spends and accrues piecework pay from it.
 */

import { round2 } from '@/lib/money';
import { areaM2 } from '@/lib/units';
import type { ProductionStage, TaskStatus } from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db';
import { ConflictError, NotFoundError, type AppContext } from '@/server/lib/context';
import { nextNumber } from '@/server/lib/sequence';
import { writeAudit } from '@/server/modules/audit/service';
import { notify } from '@/server/modules/notifications/service';
import { OPERATION_CODES, QUALITY_CHECKLIST, techCardFor, type OperationCode } from './operations';

/** Creates (or returns) the production order and its tech card for a piece. */
export async function createProductionOrder(db: Db, context: AppContext, workItemId: string) {
  const organizationId = context.user.organizationId;

  const existing = await db.productionOrder.findUnique({ where: { workItemId } });
  if (existing) return existing;

  const workItem = await db.workItem.findFirst({
    where: { organizationId, id: workItemId },
    include: { components: true },
  });
  if (!workItem) throw new NotFoundError('Изделие');

  const groups = workItem.components.map((component) => component.group);
  const hasMounting = workItem.components.some((component) => component.role === 'MOUNTING');
  const codes = techCardFor(groups, { hasMounting });

  const operations = await db.labourOperation.findMany({
    where: { organizationId, code: { in: codes as string[] } },
  });
  const byCode = new Map(operations.map((operation) => [operation.code, operation]));

  const area = areaM2(workItem.widthMm, workItem.heightMm);
  let plannedMinutes = 0;

  const tasks = codes
    .map((code, index) => {
      const operation = byCode.get(code);
      if (!operation) return null;
      const minutes = round2(
        (operation.standardMinutes + operation.minutesPerM2 * area) *
          operation.complexityFactor *
          workItem.quantity,
      );
      plannedMinutes += minutes;
      return {
        operationId: operation.id,
        seq: (index + 1) * 10,
        name: operation.name,
        standardMinutes: minutes,
      };
    })
    .filter((task): task is NonNullable<typeof task> => task !== null);

  const number = await nextNumber(db, organizationId, 'production', { padding: 5 });

  const productionOrder = await db.productionOrder.create({
    data: {
      organizationId,
      workItemId,
      number,
      stage: 'CONFIRMED',
      masterId: workItem.masterId,
      plannedMinutes: round2(plannedMinutes),
      tasks: { create: tasks },
    },
  });

  // The checklist is created up-front so it can never be skipped later.
  await db.qualityCheck.create({
    data: {
      workItemId,
      result: 'PENDING',
      items: {
        create: QUALITY_CHECKLIST.map((item, index) => ({
          code: item.code,
          label: item.label,
          required: item.required,
          sortOrder: index,
        })),
      },
    },
  });

  await writeAudit(db, context, {
    action: 'production.create',
    entity: 'ProductionOrder',
    entityId: productionOrder.id,
    newValue: { number, workItemId, tasks: tasks.length, plannedMinutes },
  });

  return productionOrder;
}

const STAGE_TO_WORK_ITEM_STATUS: Partial<Record<ProductionStage, 'IN_PRODUCTION' | 'QUALITY_CHECK'>> = {
  CUTTING: 'IN_PRODUCTION',
  ASSEMBLY: 'IN_PRODUCTION',
  STRETCHING: 'IN_PRODUCTION',
  MATTING: 'IN_PRODUCTION',
  GLAZING: 'IN_PRODUCTION',
  QUALITY_CONTROL: 'QUALITY_CHECK',
};

/** Moves a card on the production board. */
export async function moveStage(context: AppContext, productionOrderId: string, stage: ProductionStage) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const order = await tx.productionOrder.findFirst({
      where: { organizationId, id: productionOrderId },
      include: { workItem: true },
    });
    if (!order) throw new NotFoundError('Производственное задание');

    const updated = await tx.productionOrder.update({
      where: { id: productionOrderId },
      data: {
        stage,
        ...(order.startedAt === null && stage !== 'NEW' && stage !== 'CONFIRMED'
          ? { startedAt: new Date() }
          : {}),
        ...(stage === 'DONE' ? { finishedAt: new Date() } : {}),
      },
    });

    const nextStatus = STAGE_TO_WORK_ITEM_STATUS[stage];
    if (nextStatus && order.workItem.status !== nextStatus) {
      const allowed = ['MATERIALS_READY', 'IN_PRODUCTION', 'QUALITY_CHECK', 'CONFIRMED'];
      if (allowed.includes(order.workItem.status)) {
        await tx.workItem.update({
          where: { id: order.workItemId },
          data: {
            status: nextStatus,
            statusHistory: {
              create: {
                fromStatus: order.workItem.status,
                toStatus: nextStatus,
                userId: context.user.id,
                note: `Этап производства: ${stage}`,
              },
            },
          },
        });
      }
    }

    await writeAudit(tx, context, {
      action: 'production.stage',
      entity: 'ProductionOrder',
      entityId: productionOrderId,
      oldValue: { stage: order.stage },
      newValue: { stage },
    });

    return updated;
  });
}

export async function assignMaster(context: AppContext, productionOrderId: string, masterId: string | null) {
  const organizationId = context.user.organizationId;
  const order = await prisma.productionOrder.findFirst({
    where: { organizationId, id: productionOrderId },
  });
  if (!order) throw new NotFoundError('Производственное задание');

  const [updated] = await prisma.$transaction([
    prisma.productionOrder.update({ where: { id: productionOrderId }, data: { masterId } }),
    prisma.workItem.update({ where: { id: order.workItemId }, data: { masterId } }),
    prisma.productionTask.updateMany({
      where: { productionOrderId, status: 'PENDING' },
      data: { assigneeId: masterId },
    }),
  ]);
  return updated;
}

// ---------------------------------------------------------------------------
// Time tracking and piecework pay
// ---------------------------------------------------------------------------

export async function startTask(context: AppContext, taskId: string) {
  const task = await prisma.productionTask.findFirst({
    where: { id: taskId, productionOrder: { organizationId: context.user.organizationId } },
    include: { timeEntries: { where: { endedAt: null } } },
  });
  if (!task) throw new NotFoundError('Операция');
  if (task.status === 'DONE') throw new ConflictError('Операция уже выполнена.');
  if (task.timeEntries.length > 0) throw new ConflictError('Таймер уже запущен.');

  return prisma.$transaction(async (tx) => {
    await tx.productionTimeEntry.create({
      data: { taskId, userId: context.user.id, startedAt: new Date() },
    });
    return tx.productionTask.update({
      where: { id: taskId },
      data: {
        status: 'IN_PROGRESS',
        assigneeId: task.assigneeId ?? context.user.id,
        startedAt: task.startedAt ?? new Date(),
      },
    });
  });
}

/**
 * Stops the timer, records the real duration and accrues the worker's pay.
 * Pay is based on the *standard* minutes so a slow day does not cost the shop
 * money, while the variance is kept for norm analysis.
 */
export async function finishTask(context: AppContext, taskId: string, note?: string) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const task = await tx.productionTask.findFirst({
      where: { id: taskId, productionOrder: { organizationId } },
      include: {
        timeEntries: true,
        operation: true,
        productionOrder: { include: { workItem: true } },
      },
    });
    if (!task) throw new NotFoundError('Операция');
    if (task.status === 'DONE') throw new ConflictError('Операция уже выполнена.');

    const now = new Date();
    const open = task.timeEntries.filter((entry) => entry.endedAt === null);
    for (const entry of open) {
      const minutes = round2((now.getTime() - entry.startedAt.getTime()) / 60_000);
      await tx.productionTimeEntry.update({
        where: { id: entry.id },
        data: { endedAt: now, minutes },
      });
    }

    const entries = await tx.productionTimeEntry.findMany({ where: { taskId } });
    const actualMinutes = round2(entries.reduce((acc, entry) => acc + entry.minutes, 0));

    const assigneeId = task.assigneeId ?? context.user.id;
    const payAmount = Math.round(task.standardMinutes * (task.operation?.payRatePerMinute ?? 0));

    const updated = await tx.productionTask.update({
      where: { id: taskId },
      data: {
        status: 'DONE',
        finishedAt: now,
        actualMinutes,
        assigneeId,
        payAmount,
        note: note ?? task.note,
      },
    });

    await tx.productionOrder.update({
      where: { id: task.productionOrderId },
      data: { actualMinutes: { increment: actualMinutes } },
    });

    const employee = await tx.employee.findFirst({ where: { organizationId, userId: assigneeId } });
    if (employee && payAmount > 0) {
      await tx.payrollEntry.create({
        data: {
          employeeId: employee.id,
          productionTaskId: taskId,
          description: `${task.name} · изделие ${task.productionOrder.workItem.number}`,
          minutes: task.standardMinutes,
          amount: payAmount,
          earnedAt: now,
        },
      });
    }

    const remaining = await tx.productionTask.count({
      where: { productionOrderId: task.productionOrderId, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (remaining === 0) {
      await tx.productionOrder.update({
        where: { id: task.productionOrderId },
        data: { stage: 'QUALITY_CONTROL', finishedAt: now },
      });
    }

    await writeAudit(tx, context, {
      action: 'production.task.finish',
      entity: 'ProductionTask',
      entityId: taskId,
      newValue: {
        standardMinutes: task.standardMinutes,
        actualMinutes,
        payAmount,
        deviationPercent:
          task.standardMinutes > 0
            ? round2(((actualMinutes - task.standardMinutes) / task.standardMinutes) * 100)
            : 0,
      },
    });

    return updated;
  });
}

export async function setTaskStatus(context: AppContext, taskId: string, status: TaskStatus) {
  const task = await prisma.productionTask.findFirst({
    where: { id: taskId, productionOrder: { organizationId: context.user.organizationId } },
  });
  if (!task) throw new NotFoundError('Операция');
  return prisma.productionTask.update({ where: { id: taskId }, data: { status } });
}

// ---------------------------------------------------------------------------
// Quality control
// ---------------------------------------------------------------------------

export async function updateQualityCheckItem(context: AppContext, itemId: string, checked: boolean, note?: string) {
  const item = await prisma.qualityCheckItem.findFirst({
    where: { id: itemId, qualityCheck: { workItem: { organizationId: context.user.organizationId } } },
  });
  if (!item) throw new NotFoundError('Пункт контроля качества');

  return prisma.qualityCheckItem.update({
    where: { id: itemId },
    data: { checked, note: note ?? item.note },
  });
}

/** Completes the checklist. All required items must be ticked to pass. */
export async function completeQualityCheck(
  context: AppContext,
  qualityCheckId: string,
  result: 'PASSED' | 'FAILED',
  note?: string,
) {
  const organizationId = context.user.organizationId;

  return prisma.$transaction(async (tx) => {
    const check = await tx.qualityCheck.findFirst({
      where: { id: qualityCheckId, workItem: { organizationId } },
      include: { items: true, workItem: true },
    });
    if (!check) throw new NotFoundError('Контроль качества');

    if (result === 'PASSED') {
      const missing = check.items.filter((item) => item.required && !item.checked);
      if (missing.length > 0) {
        throw new ConflictError(
          `Не отмечены обязательные пункты: ${missing.map((item) => item.label).join(', ')}.`,
        );
      }
    }

    const updated = await tx.qualityCheck.update({
      where: { id: qualityCheckId },
      data: { result, checkedById: context.user.id, checkedAt: new Date(), note },
    });

    if (result === 'FAILED') {
      await notify(tx, {
        organizationId,
        type: 'QUALITY_FAILED',
        title: `Изделие ${check.workItem.number} не прошло контроль качества`,
        body: note,
        entityType: 'WorkItem',
        entityId: check.workItemId,
      });
    }

    await writeAudit(tx, context, {
      action: 'production.quality',
      entity: 'QualityCheck',
      entityId: qualityCheckId,
      newValue: { result, note },
    });

    return updated;
  });
}

// ---------------------------------------------------------------------------
// Board & capacity
// ---------------------------------------------------------------------------

export const BOARD_STAGES: ProductionStage[] = [
  'NEW',
  'CONFIRMED',
  'AWAITING_MATERIALS',
  'MATERIALS_READY',
  'CUTTING',
  'ASSEMBLY',
  'STRETCHING',
  'MATTING',
  'GLAZING',
  'QUALITY_CONTROL',
  'DONE',
  'ISSUED',
];

export const STAGE_LABELS: Record<ProductionStage, string> = {
  NEW: 'Новые',
  CONFIRMED: 'Подтверждены',
  AWAITING_MATERIALS: 'Ожидают материалов',
  MATERIALS_READY: 'Материалы готовы',
  CUTTING: 'На раскрое',
  ASSEMBLY: 'Сборка',
  STRETCHING: 'Натяжка',
  MATTING: 'Паспарту',
  GLAZING: 'Остекление',
  QUALITY_CONTROL: 'Контроль качества',
  DONE: 'Готово',
  ISSUED: 'Выдано',
};

export async function loadProductionBoard(organizationId: string) {
  const orders = await prisma.productionOrder.findMany({
    where: { organizationId, stage: { not: 'ISSUED' } },
    include: {
      workItem: {
        include: {
          order: {
            include: {
              customer: {
                select: { lastName: true, firstName: true, companyName: true, phone: true },
              },
            },
          },
        },
      },
      tasks: { select: { status: true } },
    },
    orderBy: [{ workItem: { priority: 'desc' } }, { createdAt: 'asc' }],
  });

  return BOARD_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    cards: orders
      .filter((order) => order.stage === stage)
      .map((order) => ({
        id: order.id,
        number: order.number,
        stage: order.stage,
        workItemId: order.workItemId,
        workItemNumber: order.workItem.number,
        orderNumber: order.workItem.order.number,
        title: order.workItem.title,
        customer: order.workItem.order.customer,
        dueDate: order.workItem.dueDate,
        priority: order.workItem.priority,
        price: order.workItem.price,
        widthMm: order.workItem.widthMm,
        heightMm: order.workItem.heightMm,
        masterId: order.masterId,
        plannedMinutes: order.plannedMinutes,
        actualMinutes: order.actualMinutes,
        tasksDone: order.tasks.filter((task) => task.status === 'DONE').length,
        tasksTotal: order.tasks.length,
        isOverdue: order.workItem.dueDate ? order.workItem.dueDate < new Date() : false,
      })),
  }));
}

/** Load per master for the selected day, against their declared capacity. */
export async function capacityPlan(organizationId: string, date = new Date()) {
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);

  const employees = await prisma.employee.findMany({
    where: { organizationId, isActive: true },
    include: { user: { select: { id: true } } },
  });

  const tasks = await prisma.productionTask.findMany({
    where: {
      productionOrder: { organizationId, stage: { notIn: ['DONE', 'ISSUED'] } },
      status: { in: ['PENDING', 'IN_PROGRESS'] },
    },
    include: { productionOrder: { include: { workItem: { select: { dueDate: true } } } } },
  });

  return employees.map((employee) => {
    const assigned = tasks.filter((task) => task.assigneeId === employee.userId);
    const dueToday = assigned.filter((task) => {
      const due = task.productionOrder.workItem.dueDate;
      return due && due >= dayStart && due < dayEnd;
    });
    const loadMinutes = round2(dueToday.reduce((acc, task) => acc + task.standardMinutes, 0));
    return {
      employeeId: employee.id,
      name: `${employee.lastName} ${employee.firstName}`,
      capacityMinutes: employee.dailyCapacityMinutes,
      loadMinutes,
      loadPercent:
        employee.dailyCapacityMinutes > 0
          ? round2((loadMinutes / employee.dailyCapacityMinutes) * 100)
          : 0,
      taskCount: dueToday.length,
      backlogCount: assigned.length,
    };
  });
}

/** Actual vs standard minutes — the input for tuning the norms. */
export async function normAnalysis(organizationId: string) {
  const tasks = await prisma.productionTask.findMany({
    where: { productionOrder: { organizationId }, status: 'DONE', actualMinutes: { gt: 0 } },
    include: { operation: true, assignee: { select: { firstName: true, lastName: true } } },
  });

  const byOperation = new Map<string, { name: string; standard: number; actuals: number[] }>();
  for (const task of tasks) {
    const key = task.operationId ?? task.name;
    const bucket = byOperation.get(key) ?? {
      name: task.operation?.name ?? task.name,
      standard: task.standardMinutes,
      actuals: [],
    };
    bucket.actuals.push(task.actualMinutes);
    byOperation.set(key, bucket);
  }

  return [...byOperation.entries()].map(([key, bucket]) => {
    const sorted = [...bucket.actuals].sort((a, b) => a - b);
    const average = sorted.reduce((acc, value) => acc + value, 0) / sorted.length;
    const median =
      sorted.length % 2 === 0
        ? (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
        : sorted[(sorted.length - 1) / 2];

    return {
      operationId: key,
      name: bucket.name,
      samples: sorted.length,
      standardMinutes: round2(bucket.standard),
      averageMinutes: round2(average),
      medianMinutes: round2(median),
      deviationPercent: bucket.standard > 0 ? round2(((average - bucket.standard) / bucket.standard) * 100) : 0,
      recommendedMinutes: round2(median),
    };
  });
}

export async function myTasks(organizationId: string, userId: string) {
  return prisma.productionTask.findMany({
    where: {
      assigneeId: userId,
      status: { in: ['PENDING', 'IN_PROGRESS'] },
      productionOrder: { organizationId, stage: { notIn: ['ISSUED'] } },
    },
    orderBy: [{ productionOrder: { workItem: { dueDate: 'asc' } } }, { seq: 'asc' }],
    include: {
      timeEntries: { where: { endedAt: null } },
      productionOrder: {
        include: {
          workItem: {
            include: {
              order: { include: { customer: { select: { lastName: true, firstName: true, companyName: true } } } },
              components: { orderBy: { sortOrder: 'asc' } },
            },
          },
        },
      },
    },
  });
}

export { OPERATION_CODES };
export type { OperationCode };
