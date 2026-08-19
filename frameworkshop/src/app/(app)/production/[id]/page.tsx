import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, MessageSquare, Phone, Ruler, Scissors } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Table,
  Td,
  Th,
  cn,
} from '@/components/ui';
import { ProductionQualityPanel } from '@/components/production-quality-panel';
import {
  ProductionRunningTimer,
  ProductionTaskActions,
} from '@/components/production-task-actions';
import { can, currentUser } from '@/server/auth/current-user';
import { getWorkItem } from '@/server/modules/orders/service';
import { STAGE_LABELS } from '@/server/modules/production/service';
import type { CalculationResult } from '@/server/modules/framing/types';
import {
  formatCustomerName,
  formatDate,
  formatDateTime,
  formatLength,
  formatMinutes,
  formatMoney,
  formatPhone,
  formatQuantity,
  formatSize,
} from '@/lib/format';
import {
  CATALOG_GROUP,
  PRIORITY,
  TASK_STATUS,
  UNIT,
  WORK_ITEM_STATUS,
  labelOf,
} from '@/lib/statuses';

export const dynamic = 'force-dynamic';

export default async function ProductionCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await currentUser();

  if (!can(user, 'production.view')) {
    return (
      <Card>
        <CardHeader title="Недостаточно прав" description="Раздел «Производство» вам недоступен." />
      </Card>
    );
  }

  const item = await getWorkItem(user.organizationId, id).catch(() => null);
  if (!item) notFound();

  const calc = item.calculation as unknown as CalculationResult | null;
  const status = labelOf(WORK_ITEM_STATUS, item.status);
  const priority = labelOf(PRIORITY, item.priority);
  const isOverdue =
    item.dueDate !== null && item.dueDate < new Date() && !['READY', 'ISSUED', 'CLOSED'].includes(item.status);

  const tasks = item.productionOrder?.tasks ?? [];
  const doneTasks = tasks.filter((task) => task.status === 'DONE').length;
  const qualityCheck = [...item.qualityChecks].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
  )[0];

  // Components in catalog-group order, keeping the sortOrder inside each group.
  const groups = new Map<string, typeof item.components>();
  for (const component of item.components) {
    const bucket = groups.get(component.group);
    if (bucket) bucket.push(component);
    else groups.set(component.group, [component]);
  }

  return (
    <>
      <div className="mb-4">
        <Link
          href="/production"
          className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-accent"
        >
          <ArrowLeft className="size-4" />
          К доске производства
        </Link>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Шапка                                                               */}
      {/* ------------------------------------------------------------------ */}
      <Card className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">
              Заказ{' '}
              <Link href={`/orders/${item.orderId}`} className="text-accent hover:underline">
                {item.order.number}
              </Link>
              {item.productionOrder ? ` · задание ${item.productionOrder.number}` : null}
            </p>
            <h1 className="mt-1 text-3xl font-semibold text-ink">{item.number}</h1>
            <p className="mt-1 text-xl text-ink">{item.title}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={status.tone} className="px-3 py-1 text-sm">
              {status.label}
            </Badge>
            <Badge tone={priority.tone} className="px-3 py-1 text-sm">
              {priority.label}
            </Badge>
            {item.productionOrder ? (
              <Badge tone="info" className="px-3 py-1 text-sm">
                {STAGE_LABELS[item.productionOrder.stage]}
              </Badge>
            ) : null}
          </div>
        </div>

        <dl className="mt-5 grid gap-x-8 gap-y-4 border-t border-line pt-5 text-base sm:grid-cols-2 xl:grid-cols-4">
          <div>
            <dt className="text-sm text-ink-muted">Клиент</dt>
            <dd className="mt-0.5 font-medium text-ink">
              {formatCustomerName(item.order.customer)}
            </dd>
            <dd className="mt-0.5 inline-flex items-center gap-1.5 text-sm text-ink-muted tabular">
              <Phone className="size-3.5" aria-hidden />
              {formatPhone(item.order.customer.phone)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Срок сдачи</dt>
            <dd
              className={cn(
                'mt-0.5 text-lg font-semibold tabular',
                isOverdue ? 'text-danger' : 'text-ink',
              )}
            >
              {formatDate(item.dueDate)}
              {isOverdue ? <span className="ml-2 text-sm font-normal">просрочено</span> : null}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Мастер</dt>
            <dd className="mt-0.5 text-ink">
              {item.master ? `${item.master.lastName} ${item.master.firstName}` : 'Не назначен'}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-ink-muted">Количество · стоимость</dt>
            <dd className="mt-0.5 text-ink tabular">
              {formatQuantity(item.quantity)} шт. · {formatMoney(item.price)}
            </dd>
          </div>
        </dl>

        {item.description ? (
          <p className="mt-4 rounded-card bg-surface-muted px-4 py-3 text-base text-ink">
            {item.description}
          </p>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Размер                                                              */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6">
        <CardHeader title="Размер" description="Размеры работы и готовой рамы." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 xl:grid-cols-4">
          <SizeBlock label="Работа" value={formatSize(item.widthMm, item.heightMm)} strong />
          <SizeBlock
            label="Рама снаружи"
            value={calc ? formatSize(calc.outer.widthMm, calc.outer.heightMm) : '—'}
            strong
          />
          <SizeBlock
            label="Сэндвич (стекло, задник, паспарту)"
            value={calc ? formatSize(calc.sandwich.widthMm, calc.sandwich.heightMm) : '—'}
          />
          <SizeBlock
            label="Видимая часть работы"
            value={calc ? formatSize(calc.sight.widthMm, calc.sight.heightMm) : '—'}
          />
        </div>

        {calc && calc.warnings.length > 0 ? (
          <div className="border-t border-line px-5 py-4">
            <ul className="space-y-1 text-sm text-warning">
              {calc.warnings.map((warning) => (
                <li key={warning}>⚠ {warning}</li>
              ))}
            </ul>
          </div>
        ) : null}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Конструкция                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6">
        <CardHeader title="Конструкция" description="Материалы изделия по группам." />
        {item.components.length === 0 ? (
          <EmptyState title="Состав изделия не заполнен" />
        ) : (
          <div className="divide-y divide-line">
            {[...groups.entries()].map(([group, components]) => (
              <div key={group} className="px-5 py-4">
                <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
                  {CATALOG_GROUP[group] ?? group}
                </p>
                <ul className="mt-2 space-y-2">
                  {components.map((component) => (
                    <li
                      key={component.id}
                      className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
                    >
                      <span className="text-base text-ink">
                        {component.name}
                        {component.catalogItem?.internalSku ? (
                          <span className="ml-2 text-xs text-ink-subtle">
                            {component.catalogItem.internalSku}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-base text-ink tabular">
                        {formatQuantity(component.quantity)} {UNIT[component.unit] ?? component.unit}
                        {component.consumedQuantity > component.quantity ? (
                          <span className="ml-2 text-sm text-ink-subtle">
                            расход {formatQuantity(component.consumedQuantity)}{' '}
                            {UNIT[component.unit] ?? component.unit}
                          </span>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Раскрой                                                             */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6">
        <CardHeader
          title="Раскрой багета"
          description="Длина по внешнему краю (длинная точка) каждой из четырёх планок."
        />
        {!calc || calc.frames.length === 0 ? (
          <EmptyState
            title="Раскрой не рассчитан"
            description="Для изделия нет расчёта рамы или багет не используется."
          />
        ) : (
          <div className="divide-y divide-line">
            {calc.frames.map((frame, index) => (
              <div key={`${frame.catalogItemId}-${index}`} className="px-5 py-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Scissors className="size-4 text-ink-muted" aria-hidden />
                  <p className="text-lg font-medium text-ink">{frame.name ?? 'Багет'}</p>
                  <Badge tone={frame.role === 'OUTER' ? 'accent' : 'info'}>
                    {frame.role === 'OUTER' ? 'Внешняя рама' : 'Внутренняя рама'}
                  </Badge>
                  <span className="text-sm text-ink-muted tabular">
                    ширина профиля {formatLength(frame.widthMm)}
                  </span>
                </div>

                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {frame.pieces.map((piece, pieceIndex) => (
                    <div
                      key={pieceIndex}
                      className="rounded-card border border-line-strong bg-surface-muted px-4 py-3"
                    >
                      <p className="text-xs tracking-wide text-ink-muted uppercase">
                        Планка {pieceIndex + 1} · {pieceIndex % 2 === 0 ? 'горизонт' : 'вертикаль'}
                      </p>
                      <p className="mt-1 text-3xl font-semibold text-ink tabular">
                        {formatQuantity(piece)}
                        <span className="ml-1 text-base font-normal text-ink-muted">мм</span>
                      </p>
                    </div>
                  ))}
                </div>

                <dl className="mt-3 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                  <SmallFact label="Итого длина" value={formatLength(frame.totalLengthMm)} />
                  <SmallFact label="Расход со склада" value={formatLength(frame.consumedLengthMm)} />
                  <SmallFact label="Отход" value={formatLength(frame.wasteLengthMm)} />
                  <SmallFact
                    label="Фальц (проём)"
                    value={formatSize(frame.opening.widthMm, frame.opening.heightMm)}
                  />
                </dl>
              </div>
            ))}

            {calc.subframe ? (
              <div className="px-5 py-4">
                <p className="inline-flex items-center gap-2 text-base font-medium text-ink">
                  <Ruler className="size-4 text-ink-muted" aria-hidden />
                  Подрамник: {calc.subframe.name ?? '—'}
                </p>
                <dl className="mt-2 grid gap-x-6 gap-y-2 text-sm sm:grid-cols-3">
                  <SmallFact
                    label="Размер"
                    value={formatSize(calc.subframe.size.widthMm, calc.subframe.size.heightMm)}
                  />
                  <SmallFact label="Итого длина" value={formatLength(calc.subframe.totalLengthMm)} />
                  <SmallFact
                    label="Расход со склада"
                    value={formatLength(calc.subframe.consumedLengthMm)}
                  />
                </dl>
              </div>
            ) : null}

            {calc.mats.length > 0 ? (
              <div className="px-5 py-4">
                <p className="text-sm font-medium tracking-wide text-ink-muted uppercase">
                  Окна паспарту
                </p>
                <ul className="mt-2 space-y-1 text-base text-ink">
                  {calc.mats.map((mat) => (
                    <li key={mat.layer} className="tabular">
                      Слой {mat.layer}: лист{' '}
                      {formatSize(mat.outer.widthMm, mat.outer.heightMm)}, окно{' '}
                      {formatSize(mat.opening.widthMm, mat.opening.heightMm)}
                      {mat.openings > 1 ? ` × ${mat.openings}` : ''}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Операции                                                            */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6">
        <CardHeader
          title="Операции"
          description={
            item.productionOrder
              ? `Выполнено ${doneTasks} из ${tasks.length} · план ${formatMinutes(
                  item.productionOrder.plannedMinutes,
                )} · факт ${formatMinutes(item.productionOrder.actualMinutes)}`
              : undefined
          }
        />
        {tasks.length === 0 ? (
          <EmptyState
            title="Технологическая карта не создана"
            description="Задание появится после подтверждения изделия."
          />
        ) : (
          <div className="divide-y divide-line">
            {tasks.map((task) => {
              const taskStatus = labelOf(TASK_STATUS, task.status);
              return (
                <div
                  key={task.id}
                  className="flex flex-wrap items-center justify-between gap-4 px-5 py-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-ink-subtle tabular">{task.seq}</span>
                      <p className="text-lg font-medium text-ink">{task.name}</p>
                      <Badge tone={taskStatus.tone}>{taskStatus.label}</Badge>
                      {task.status === 'IN_PROGRESS' && task.startedAt ? (
                        <ProductionRunningTimer since={task.startedAt.toISOString()} />
                      ) : null}
                    </div>
                    <p className="mt-1 text-sm text-ink-muted tabular">
                      Норма {formatMinutes(task.standardMinutes)}
                      {task.actualMinutes > 0
                        ? ` · факт ${formatMinutes(task.actualMinutes)}`
                        : ''}{' '}
                      ·{' '}
                      {task.assignee
                        ? `${task.assignee.lastName} ${task.assignee.firstName}`
                        : 'исполнитель не назначен'}
                    </p>
                    {task.note ? (
                      <p className="mt-1 text-sm text-ink-muted">{task.note}</p>
                    ) : null}
                  </div>

                  <ProductionTaskActions
                    taskId={task.id}
                    status={task.status}
                    disabled={!can(user, 'production.execute')}
                    withNote
                    size="lg"
                  />
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Контроль качества                                                   */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6">
        <CardHeader
          title="Контроль качества"
          description="Отметьте пункты, закройте контроль и переведите изделие в «Готово»."
        />
        {!qualityCheck ? (
          <EmptyState
            title="Чек-лист не создан"
            description="Чек-лист создаётся вместе с производственным заданием."
          />
        ) : (
          <ProductionQualityPanel
            qualityCheckId={qualityCheck.id}
            items={qualityCheck.items.map((checkItem) => ({
              id: checkItem.id,
              label: checkItem.label,
              required: checkItem.required,
              checked: checkItem.checked,
              note: checkItem.note,
            }))}
            result={qualityCheck.result}
            checkedAt={qualityCheck.checkedAt ? qualityCheck.checkedAt.toISOString() : null}
            workItemId={item.id}
            workItemStatus={item.status}
            canQuality={can(user, 'production.quality')}
            canFinish={can(user, 'orders.edit')}
          />
        )}
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Комментарии                                                         */}
      {/* ------------------------------------------------------------------ */}
      <Card className="mt-6 mb-2">
        <CardHeader title="Комментарии" />
        {item.comments.length === 0 ? (
          <EmptyState title="Комментариев нет" />
        ) : (
          <ul className="divide-y divide-line">
            {item.comments.map((comment) => (
              <li key={comment.id} className="px-5 py-4">
                <div className="flex flex-wrap items-baseline gap-2">
                  <MessageSquare className="size-4 text-ink-subtle" aria-hidden />
                  <span className="text-sm font-medium text-ink">
                    {comment.author
                      ? `${comment.author.lastName} ${comment.author.firstName}`
                      : 'Система'}
                  </span>
                  <span className="text-xs text-ink-subtle tabular">
                    {formatDateTime(comment.createdAt)}
                  </span>
                </div>
                <p className="mt-1 text-base text-ink">{comment.body}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {item.statusHistory.length > 0 ? (
        <Card className="mt-6">
          <CardHeader title="История статусов" />
          <Table>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Статус</Th>
                <Th>Кто</Th>
                <Th>Примечание</Th>
              </tr>
            </thead>
            <tbody>
              {item.statusHistory.map((entry) => {
                const to = labelOf(WORK_ITEM_STATUS, entry.toStatus);
                return (
                  <tr key={entry.id}>
                    <Td className="tabular whitespace-nowrap">{formatDateTime(entry.createdAt)}</Td>
                    <Td>
                      <Badge tone={to.tone}>{to.label}</Badge>
                    </Td>
                    <Td>
                      {entry.user ? `${entry.user.lastName} ${entry.user.firstName}` : 'Система'}
                    </Td>
                    <Td className="text-ink-muted">{entry.note ?? '—'}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}

function SizeBlock({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-card border px-4 py-3',
        strong ? 'border-line-strong bg-surface-muted' : 'border-line',
      )}
    >
      <p className="text-sm text-ink-muted">{label}</p>
      <p
        className={cn(
          'mt-1 font-semibold text-ink tabular',
          strong ? 'text-2xl sm:text-3xl' : 'text-xl',
        )}
      >
        {value}
      </p>
    </div>
  );
}

function SmallFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-ink tabular">{value}</dd>
    </div>
  );
}
