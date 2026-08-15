import Link from 'next/link';
import { ClipboardList } from 'lucide-react';
import { Card, CardHeader, EmptyState, PageHeader, StatCard } from '@/components/ui';
import {
  ProductionBoard,
  type ProductionBoardColumn,
} from '@/components/production-board';
import { can, currentUser } from '@/server/auth/current-user';
import { prisma } from '@/server/db';
import { loadProductionBoard } from '@/server/modules/production/service';
import { formatCustomerName } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ProductionBoardPage() {
  const user = await currentUser();

  if (!can(user, 'production.view')) {
    return (
      <Card>
        <CardHeader title="Недостаточно прав" description="Раздел «Производство» вам недоступен." />
      </Card>
    );
  }

  const board = await loadProductionBoard(user.organizationId);
  const canManage = can(user, 'production.manage');

  // The board returns only master ids, so the names are resolved here. When no
  // master is set on the order itself, the person actually working the tech
  // card is the useful answer.
  const orderIds = board.flatMap((column) => column.cards.map((card) => card.id));
  const masterIds = [
    ...new Set(
      board
        .flatMap((column) => column.cards.map((card) => card.masterId))
        .filter((id): id is string => Boolean(id)),
    ),
  ];

  const [masters, assignedTasks] = await Promise.all([
    masterIds.length
      ? prisma.user.findMany({
          where: { id: { in: masterIds } },
          select: { id: true, firstName: true, lastName: true },
        })
      : Promise.resolve([]),
    orderIds.length
      ? prisma.productionTask.findMany({
          where: { productionOrderId: { in: orderIds }, assigneeId: { not: null } },
          orderBy: { seq: 'asc' },
          select: {
            productionOrderId: true,
            status: true,
            assignee: { select: { firstName: true, lastName: true } },
          },
        })
      : Promise.resolve([]),
  ]);

  const masterName = new Map(
    masters.map((master) => [master.id, `${master.lastName} ${master.firstName}`]),
  );

  const workingNow = new Map<string, string>();
  const firstAssignee = new Map<string, string>();
  for (const task of assignedTasks) {
    if (!task.assignee) continue;
    const name = `${task.assignee.lastName} ${task.assignee.firstName}`;
    if (task.status === 'IN_PROGRESS' && !workingNow.has(task.productionOrderId)) {
      workingNow.set(task.productionOrderId, name);
    }
    if (!firstAssignee.has(task.productionOrderId)) {
      firstAssignee.set(task.productionOrderId, name);
    }
  }

  const columns: ProductionBoardColumn[] = board.map((column) => ({
    stage: column.stage,
    label: column.label,
    cards: column.cards.map((card) => ({
      id: card.id,
      number: card.number,
      stage: card.stage,
      workItemId: card.workItemId,
      workItemNumber: card.workItemNumber,
      orderNumber: card.orderNumber,
      title: card.title,
      customerName: formatCustomerName(card.customer),
      dueDate: card.dueDate ? card.dueDate.toISOString() : null,
      priority: card.priority,
      price: card.price,
      widthMm: card.widthMm,
      heightMm: card.heightMm,
      masterName:
        (card.masterId ? masterName.get(card.masterId) : undefined) ??
        workingNow.get(card.id) ??
        firstAssignee.get(card.id) ??
        null,
      tasksDone: card.tasksDone,
      tasksTotal: card.tasksTotal,
      isOverdue: card.isOverdue,
    })),
  }));

  const allCards = columns.flatMap((column) => column.cards);
  const overdue = allCards.filter((card) => card.isOverdue).length;
  const inWork = columns
    .filter((column) => ['CUTTING', 'ASSEMBLY', 'STRETCHING', 'MATTING', 'GLAZING'].includes(column.stage))
    .reduce((total, column) => total + column.cards.length, 0);
  const onQuality = columns.find((column) => column.stage === 'QUALITY_CONTROL')?.cards.length ?? 0;

  return (
    <>
      <PageHeader
        title="Производство"
        description={
          canManage
            ? 'Перетащите карточку в нужную колонку или выберите этап в списке на карточке.'
            : 'Доска только для просмотра — нет прав на изменение этапов.'
        }
        action={
          <Link
            href="/production/my"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            <ClipboardList className="size-4" />
            Мои задания
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Заданий на доске" value={allCards.length} />
        <StatCard label="В работе" value={inWork} />
        <StatCard label="На контроле качества" value={onQuality} />
        <StatCard
          label="Просрочено"
          value={overdue}
          tone={overdue > 0 ? 'danger' : 'positive'}
          hint="Срок сдачи изделия прошёл"
        />
      </div>

      {allCards.length === 0 ? (
        <Card>
          <EmptyState
            title="Производственных заданий нет"
            description="Задания появятся здесь после подтверждения заказа."
          />
        </Card>
      ) : (
        <ProductionBoard columns={columns} canManage={canManage} />
      )}
    </>
  );
}
