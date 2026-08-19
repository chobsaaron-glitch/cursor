import Link from 'next/link';
import { ArrowLeft, ArrowRight, CalendarClock } from 'lucide-react';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, cn } from '@/components/ui';
import {
  ProductionRunningTimer,
  ProductionTaskActions,
} from '@/components/production-task-actions';
import { can, currentUser } from '@/server/auth/current-user';
import { STAGE_LABELS, myTasks } from '@/server/modules/production/service';
import { formatCustomerName, formatDate, formatMinutes, formatSize } from '@/lib/format';
import { PRIORITY, TASK_STATUS, labelOf } from '@/lib/statuses';

export const dynamic = 'force-dynamic';

export default async function MyProductionTasksPage() {
  const user = await currentUser();

  if (!can(user, 'production.view')) {
    return (
      <Card>
        <CardHeader title="Недостаточно прав" description="Раздел «Производство» вам недоступен." />
      </Card>
    );
  }

  const tasks = await myTasks(user.organizationId, user.id);
  const canExecute = can(user, 'production.execute');

  const running = tasks.filter((task) => task.status === 'IN_PROGRESS').length;
  const plannedMinutes = tasks.reduce((total, task) => total + task.standardMinutes, 0);
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const overdue = tasks.filter((task) => {
    const due = task.productionOrder.workItem.dueDate;
    return due !== null && due < startOfToday;
  }).length;

  return (
    <>
      <PageHeader
        title="Мои задания"
        description={`${user.lastName} ${user.firstName} — операции, назначенные на вас.`}
        action={
          <Link
            href="/production"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-surface-muted"
          >
            <ArrowLeft className="size-4" />
            Доска
          </Link>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Операций в очереди" value={tasks.length} />
        <StatCard label="В работе сейчас" value={running} tone={running > 0 ? 'positive' : 'neutral'} />
        <StatCard
          label="Просрочено"
          value={overdue}
          tone={overdue > 0 ? 'danger' : 'neutral'}
          hint={`Норма по очереди: ${formatMinutes(plannedMinutes)}`}
        />
      </div>

      {tasks.length === 0 ? (
        <Card>
          <EmptyState
            title="Заданий нет"
            description="Как только на вас назначат операцию, она появится здесь."
          />
        </Card>
      ) : (
        <div className="space-y-4">
          {tasks.map((task) => {
            const workItem = task.productionOrder.workItem;
            const status = labelOf(TASK_STATUS, task.status);
            const priority = labelOf(PRIORITY, workItem.priority);
            const openEntry = task.timeEntries[0];
            const isOverdue = workItem.dueDate !== null && workItem.dueDate < startOfToday;

            return (
              <Card
                key={task.id}
                className={cn('p-4 sm:p-5', task.status === 'IN_PROGRESS' ? 'border-info/50' : '')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/production/${workItem.id}`}
                    className="text-base font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {workItem.number}
                  </Link>
                  <Badge tone={status.tone}>{status.label}</Badge>
                  {workItem.priority === 'NORMAL' ? null : (
                    <Badge tone={priority.tone}>{priority.label}</Badge>
                  )}
                  <Badge tone="neutral">{STAGE_LABELS[task.productionOrder.stage]}</Badge>
                  {openEntry ? (
                    <ProductionRunningTimer since={openEntry.startedAt.toISOString()} />
                  ) : null}
                </div>

                <p className="mt-2 text-xl font-semibold text-ink">{task.name}</p>
                <p className="mt-1 text-base text-ink">{workItem.title}</p>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <div>
                    <dt className="text-ink-muted">Клиент</dt>
                    <dd className="text-ink">{formatCustomerName(workItem.order.customer)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Размер</dt>
                    <dd className="tabular text-ink">
                      {formatSize(workItem.widthMm, workItem.heightMm)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Норма</dt>
                    <dd className="tabular text-ink">{formatMinutes(task.standardMinutes)}</dd>
                  </div>
                  <div>
                    <dt className="text-ink-muted">Срок</dt>
                    <dd
                      className={cn(
                        'tabular inline-flex items-center gap-1.5',
                        isOverdue ? 'font-medium text-danger' : 'text-ink',
                      )}
                    >
                      <CalendarClock className="size-4" aria-hidden />
                      {formatDate(workItem.dueDate)}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
                  <ProductionTaskActions
                    taskId={task.id}
                    status={task.status}
                    disabled={!canExecute}
                    size="lg"
                  />
                  <Link
                    href={`/production/${workItem.id}`}
                    className="inline-flex h-12 items-center gap-2 rounded-lg border border-line bg-surface px-5 text-sm font-medium text-ink hover:bg-surface-muted"
                  >
                    Карта изделия
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
