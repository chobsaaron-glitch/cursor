/**
 * The acceptance scenario: customer → order → framing → calculation → payment
 * → production → material consumption → quality control → issue → close.
 *
 * Every step goes through the real services against a real database, and each
 * one asserts the side effects the workshop actually depends on — reserved
 * stock, wage accrual, invoice balance, audit trail.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { roubles } from '@/lib/money';
import { prisma } from '@/server/db';
import { ConflictError } from '@/server/lib/context';
import { createCustomer, getCustomer } from '@/server/modules/customers/service';
import {
  addWorkItem,
  changeWorkItemStatus,
  closeOrder,
  confirmOrder,
  createOrder,
  issueOrder,
} from '@/server/modules/orders/service';
import { consumeForWorkItem } from '@/server/modules/inventory/service';
import { createInvoice, recordPayment } from '@/server/modules/payments/service';
import { earnings } from '@/server/modules/payroll/service';
import {
  completeQualityCheck,
  finishTask,
  moveStage,
  startTask,
} from '@/server/modules/production/service';
import { dashboardSummary, orderProfitability, lastDays } from '@/server/modules/reports/service';
import type { FramingSpec } from '@/server/modules/framing/types';
import { buildWorkshop, type Workshop } from './fixture';

describe('полный цикл заказа', () => {
  let workshop: Workshop;
  let customerId: string;
  let orderId: string;
  let workItemId: string;

  beforeAll(async () => {
    workshop = await buildWorkshop();
  }, 60_000);

  it('создаёт клиента', async () => {
    const customer = await createCustomer(workshop.receptionist, {
      type: 'PERSON',
      lastName: 'Иванов',
      firstName: 'Иван',
      middleName: 'Петрович',
      phone: '+7 (916) 111-22-33',
      email: 'ivanov@example.ru',
      city: 'Москва',
      marketingConsent: true,
    });

    customerId = customer.id;

    expect(customer.number).toBeTruthy();
    // Phones are stored digits-only so the same person cannot be entered twice
    // under different formatting; the display format is applied on the way out.
    expect(customer.phone).toBe('79161112233');
  });

  it('создаёт заказ и рассчитывает изделие по конструкции', async () => {
    const order = await createOrder(workshop.receptionist, {
      customerId,
      dueDate: new Date(Date.now() + 7 * 86_400_000),
      priority: 'NORMAL',
      branchId: workshop.branchId,
    });
    orderId = order.id;
    expect(order.commercialStatus).toBe('CALCULATION');

    const spec: FramingSpec = {
      artworkWidthMm: 400,
      artworkHeightMm: 600,
      mats: [
        {
          layer: 1,
          catalogItemId: workshop.items.mat,
          margins: { leftMm: 70, rightMm: 70, topMm: 70, bottomMm: 85 },
        },
      ],
      mouldings: [{ role: 'INNER', catalogItemId: workshop.items.moulding }],
      glazing: { catalogItemId: workshop.items.glazing },
      backing: { catalogItemId: workshop.items.backing },
      mounting: { method: 'FOAM_MOUNT', catalogItemId: workshop.items.mountingService },
      hardware: [{ catalogItemId: workshop.items.hardware }],
    };

    const { workItem, calculation } = await addWorkItem(workshop.receptionist, {
      orderId,
      title: 'Вышивка 400×600',
      workType: 'Вышивка',
      spec,
    });
    workItemId = workItem.id;

    // The work item stores the artwork size; the construction sizes come from
    // the calculation engine.
    expect(workItem.widthMm).toBe(400);
    expect(workItem.heightMm).toBe(600);

    // Mat margins widen the sandwich, minus the 5 mm the mat overlaps the
    // artwork on each side so the edges cannot show through the window.
    const geometry = calculation.calculation;
    expect(geometry.sandwich.widthMm).toBe(400 + 70 + 70 - 5 - 5);
    expect(geometry.sandwich.heightMm).toBe(600 + 70 + 85 - 5 - 5);
    expect(geometry.outer.widthMm).toBeGreaterThan(geometry.sandwich.widthMm);
    expect(geometry.frames[0].pieces).toHaveLength(4);
    expect(geometry.frames[0].cuts).toBe(4);

    const components = await prisma.workItemComponent.findMany({ where: { workItemId } });
    const groups = components.map((component) => component.group);
    expect(groups).toContain('MOULDING');
    expect(groups).toContain('MATBOARD');
    expect(groups).toContain('GLAZING');
    expect(groups).toContain('BACKING');
    expect(groups).toContain('HARDWARE');

    // No line may be sold below what it cost the workshop.
    for (const component of components) {
      expect(component.price).toBeGreaterThanOrEqual(component.cost);
    }

    expect(workItem.price).toBeGreaterThan(0);
    expect(workItem.totalCost).toBeGreaterThan(0);
    expect(workItem.marginPercent).toBeGreaterThan(30);
  });

  it('подтверждение резервирует материалы и открывает производство', async () => {
    const mouldingBefore = await prisma.inventoryItem.findFirstOrThrow({
      where: { catalogItemId: workshop.items.moulding },
    });
    expect(mouldingBefore.quantityReserved).toBe(0);

    await confirmOrder(workshop.admin, orderId);

    const mouldingAfter = await prisma.inventoryItem.findFirstOrThrow({
      where: { catalogItemId: workshop.items.moulding },
    });
    // The perimeter of a 540×755 frame is about 2.6 m, plus waste.
    expect(mouldingAfter.quantityReserved).toBeGreaterThan(2.5);
    expect(mouldingAfter.quantityOnHand).toBe(mouldingBefore.quantityOnHand);

    const reservations = await prisma.inventoryReservation.findMany({
      where: { workItemId, status: 'ACTIVE' },
    });
    expect(reservations.length).toBeGreaterThan(0);

    const production = await prisma.productionOrder.findFirstOrThrow({
      where: { workItemId },
      include: { tasks: true },
    });
    expect(production.tasks.length).toBeGreaterThan(0);

    const check = await prisma.qualityCheck.findFirstOrThrow({ where: { workItemId } });
    const checkItems = await prisma.qualityCheckItem.findMany({
      where: { qualityCheckId: check.id },
    });
    expect(checkItems.some((item) => item.required)).toBe(true);
  });

  it('принимает частичную предоплату, не трогая статус заказа', async () => {
    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    await createInvoice(workshop.accountant, { orderId });

    const prepayment = Math.round(order.total / 2);
    await recordPayment(workshop.receptionist, {
      orderId,
      amount: prepayment,
      method: 'CARD',
      note: 'Предоплата 50 %',
    });

    const afterPayment = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(afterPayment.paidTotal).toBe(prepayment);
    expect(afterPayment.balance).toBe(order.total - prepayment);
    expect(afterPayment.paymentStatus).toBe('PARTIAL');
    // Money must never drive the commercial track.
    expect(afterPayment.commercialStatus).toBe('CONFIRMED');

    // The invoice follows the order even though the payment was taken against
    // the order rather than against the invoice number.
    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId } });
    expect(invoice.paidTotal).toBe(prepayment);
    expect(invoice.balance).toBe(order.total - prepayment);
    expect(invoice.status).toBe('PARTIALLY_PAID');
  });

  it('мастер выполняет операции и зарабатывает сдельную оплату', async () => {
    const production = await prisma.productionOrder.findFirstOrThrow({
      where: { workItemId },
      include: { tasks: { orderBy: { seq: 'asc' } } },
    });

    // Moving the card on the board also advances the work item status.
    await moveStage(workshop.master, production.id, 'CUTTING');
    const inProduction = await prisma.workItem.findUniqueOrThrow({ where: { id: workItemId } });
    expect(inProduction.status).toBe('IN_PRODUCTION');

    for (const task of production.tasks) {
      await prisma.productionTask.update({
        where: { id: task.id },
        data: { assigneeId: workshop.master.user.id },
      });
      await startTask(workshop.master, task.id);
      await finishTask(workshop.master, task.id);
    }

    const done = await prisma.productionTask.findMany({ where: { productionOrderId: production.id } });
    expect(done.every((task) => task.status === 'DONE')).toBe(true);

    const timeEntries = await prisma.productionTimeEntry.findMany({
      where: { userId: workshop.master.user.id },
    });
    expect(timeEntries.length).toBe(production.tasks.length);

    const employee = await prisma.employee.findFirstOrThrow({
      where: { userId: workshop.master.user.id },
    });
    const wage = await earnings(workshop.organizationId, {
      employeeId: employee.id,
      from: new Date(Date.now() - 86_400_000),
      to: new Date(Date.now() + 86_400_000),
    });
    expect(wage.total).toBeGreaterThan(0);
  });

  it('списывает материалы со склада', async () => {
    const before = await prisma.inventoryItem.findFirstOrThrow({
      where: { catalogItemId: workshop.items.moulding },
    });

    await consumeForWorkItem(prisma, workshop.admin, workItemId);

    const after = await prisma.inventoryItem.findFirstOrThrow({
      where: { catalogItemId: workshop.items.moulding },
    });
    expect(after.quantityOnHand).toBeLessThan(before.quantityOnHand);
    expect(after.quantityReserved).toBe(0);

    const consumed = await prisma.inventoryReservation.findMany({ where: { workItemId } });
    expect(consumed.every((reservation) => reservation.status === 'CONSUMED')).toBe(true);

    // Consumption is split into what ends up in the frame and what is waste,
    // otherwise the real cost of the piece is understated.
    const movements = await prisma.inventoryTransaction.findMany({
      where: {
        inventoryItem: { catalogItemId: workshop.items.moulding },
        type: { in: ['ISSUE', 'WASTE'] },
      },
    });
    expect(movements.some((movement) => movement.type === 'ISSUE')).toBe(true);
    expect(movements.some((movement) => movement.type === 'WASTE')).toBe(true);
  });

  it('не выпускает изделие без контроля качества', async () => {
    const production = await prisma.productionOrder.findFirstOrThrow({ where: { workItemId } });
    await moveStage(workshop.master, production.id, 'QUALITY_CONTROL');

    await expect(changeWorkItemStatus(workshop.master, workItemId, 'READY')).rejects.toThrow(
      ConflictError,
    );

    const check = await prisma.qualityCheck.findFirstOrThrow({ where: { workItemId } });
    await expect(
      completeQualityCheck(workshop.master, check.id, 'PASSED'),
    ).rejects.toThrow(ConflictError);
  });

  it('проходит контроль качества и переводит изделие в «Готово»', async () => {
    const check = await prisma.qualityCheck.findFirstOrThrow({ where: { workItemId } });
    await prisma.qualityCheckItem.updateMany({
      where: { qualityCheckId: check.id },
      data: { checked: true },
    });

    await completeQualityCheck(workshop.master, check.id, 'PASSED', 'Проверено');
    const ready = await changeWorkItemStatus(workshop.master, workItemId, 'READY');
    expect(ready.status).toBe('READY');
    expect(ready.readyAt).toBeTruthy();

    const order = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.productionStatus).toBe('READY');
  });

  it('не закрывает заказ с долгом, закрывает после полной оплаты', async () => {
    await issueOrder(workshop.receptionist, orderId);

    const issued = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(issued.productionStatus).toBe('ISSUED');
    expect(issued.balance).toBeGreaterThan(0);

    await expect(closeOrder(workshop.admin, orderId)).rejects.toThrow(ConflictError);

    await recordPayment(workshop.receptionist, {
      orderId,
      amount: issued.balance,
      method: 'CASH',
      note: 'Окончательный расчёт',
    });

    const settled = await prisma.customerOrder.findUniqueOrThrow({ where: { id: orderId } });
    expect(settled.balance).toBe(0);
    expect(settled.paymentStatus).toBe('PAID');

    await closeOrder(workshop.admin, orderId);
    const closed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: orderId },
      include: { workItems: true },
    });
    expect(closed.closedAt).toBeTruthy();
    expect(closed.workItems.every((item) => item.status === 'CLOSED')).toBe(true);

    const invoice = await prisma.invoice.findFirstOrThrow({ where: { orderId } });
    expect(invoice.status).toBe('PAID');
  });

  it('отчёты и карточка клиента показывают результат цикла', async () => {
    const summary = await dashboardSummary(workshop.organizationId);
    expect(summary.revenueToday).toBeGreaterThan(0);

    const profitability = await orderProfitability(workshop.organizationId, lastDays(7));
    const row = profitability.find((entry) => entry.id === orderId);
    expect(row).toBeDefined();
    expect(row!.revenue).toBeGreaterThan(0);
    expect(row!.grossProfit).toBeGreaterThan(0);
    expect(row!.cost).toBeGreaterThan(0);

    const customer = await getCustomer(workshop.organizationId, customerId);
    expect(customer.stats.orderCount).toBe(1);
    expect(customer.stats.debt).toBe(0);
    expect(customer.stats.paid).toBeGreaterThan(0);
    expect(customer.stats.ltv).toBe(customer.stats.revenue);
    expect(customer.completedOrders).toHaveLength(1);

    // Every money- and stock-moving step left a trace.
    const audit = await prisma.auditLog.findMany({ where: { organizationId: workshop.organizationId } });
    const actions = new Set(audit.map((entry) => entry.action));
    expect(actions).toContain('order.confirm');
    expect(actions).toContain('payment.create');
    expect(actions).toContain('order.close');
  });

  it('изолирует данные другой организации', async () => {
    const otherOrg = await prisma.organization.create({ data: { name: 'Чужая мастерская' } });
    const orders = await prisma.customerOrder.findMany({ where: { organizationId: otherOrg.id } });
    expect(orders).toHaveLength(0);

    const summary = await dashboardSummary(otherOrg.id);
    expect(summary.revenueToday).toBe(0);
    expect(summary.ordersToday).toBe(0);
  });

  it('не даёт приёмщику превысить лимит скидки', async () => {
    const order = await createOrder(workshop.receptionist, {
      customerId,
      branchId: workshop.branchId,
    });

    await expect(
      addWorkItem(workshop.receptionist, {
        orderId: order.id,
        title: 'Скидочная проверка',
        workType: 'Постер',
        spec: {
          artworkWidthMm: 300,
          artworkHeightMm: 400,
          mouldings: [{ role: 'INNER', catalogItemId: workshop.items.moulding }],
          glazing: { catalogItemId: workshop.items.glazing },
        },
        discountPercent: 40,
      }),
    ).rejects.toThrow(/скидк/i);

    // The administrator has no ceiling.
    const { workItem } = await addWorkItem(workshop.admin, {
      orderId: order.id,
      title: 'Скидочная проверка',
      workType: 'Постер',
      spec: {
        artworkWidthMm: 300,
        artworkHeightMm: 400,
        mouldings: [{ role: 'INNER', catalogItemId: workshop.items.moulding }],
        glazing: { catalogItemId: workshop.items.glazing },
      },
      discountPercent: 40,
    });
    expect(workItem.discountAmount).toBeGreaterThan(0);
  });

  it('предлагает закупку при нехватке материала', async () => {
    const { collectShortages } = await import('@/server/modules/inventory/service');
    const { suggestPurchases, createPurchaseOrdersFromShortages } = await import(
      '@/server/modules/procurement/service'
    );

    await prisma.inventoryItem.updateMany({
      where: { catalogItemId: workshop.items.moulding },
      data: { quantityOnHand: 1, reorderPoint: 10, reorderQuantity: 30 },
    });

    const shortages = await collectShortages(workshop.organizationId);
    expect(shortages.some((line) => line.catalogItemId === workshop.items.moulding)).toBe(true);

    const suggestions = await suggestPurchases(workshop.organizationId);
    expect(suggestions.length).toBeGreaterThan(0);

    const created = await createPurchaseOrdersFromShortages(workshop.admin);
    expect(created.length).toBeGreaterThan(0);

    const purchaseOrder = await prisma.purchaseOrder.findFirstOrThrow({
      where: { organizationId: workshop.organizationId },
      include: { items: true },
    });
    expect(purchaseOrder.status).toBe('DRAFT');
    expect(purchaseOrder.items.length).toBeGreaterThan(0);
    expect(purchaseOrder.totalCost).toBeGreaterThan(roubles(0));
  });
});
