import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Plus } from 'lucide-react';
import {
  AccessDenied,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { OrderActions } from '@/components/order-actions';
import { OrderPaymentForm } from '@/components/order-payment-form';
import { WorkItemCommentForm } from '@/components/work-item-comment-form';
import { can, currentUser } from '@/server/auth/current-user';
import { NotFoundError } from '@/server/lib/context';
import { getOrder } from '@/server/modules/orders/service';
import { STAGE_LABELS } from '@/server/modules/production/service';
import {
  formatCustomerName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPhone,
  formatQuantity,
  formatSize,
} from '@/lib/format';
import {
  CATALOG_GROUP,
  COMMERCIAL_STATUS,
  INVOICE_STATUS,
  PAYMENT_METHOD,
  PAYMENT_STATUS,
  PRIORITY,
  PRODUCTION_STATUS,
  RESERVATION_STATUS,
  TASK_STATUS,
  UNIT,
  WORK_ITEM_STATUS,
  labelOf,
} from '@/lib/statuses';

export const dynamic = 'force-dynamic';

type OrderCard = Awaited<ReturnType<typeof getOrder>>;
type WorkItem = OrderCard['workItems'][number];

async function loadOrder(organizationId: string, id: string): Promise<OrderCard | null> {
  try {
    return await getOrder(organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  const { id } = await params;

  if (!can(user, 'orders.view')) {
    return <AccessDenied title="Заказ" description="У вашей роли нет доступа к заказам." />;
  }

  const order = await loadOrder(user.organizationId, id);
  if (!order) notFound();

  const showCost = can(user, 'orders.view_cost');
  const commercial = labelOf(COMMERCIAL_STATUS, order.commercialStatus);
  const production = labelOf(PRODUCTION_STATUS, order.productionStatus);
  const payment = labelOf(PAYMENT_STATUS, order.paymentStatus);
  const priority = labelOf(PRIORITY, order.priority);
  const overdue =
    order.dueDate != null &&
    order.dueDate.getTime() < Date.now() &&
    !['READY', 'ISSUED'].includes(order.productionStatus);
  const hasOpenInvoice = order.invoices.some((invoice) => invoice.status !== 'VOIDED');
  const editable =
    order.commercialStatus === 'CALCULATION' || order.commercialStatus === 'QUOTE';

  return (
    <>
      <div className="mb-4">
        <Link href="/orders" className="inline-flex items-center gap-2 text-sm text-ink-muted hover:text-accent">
          <ArrowLeft className="size-4" />
          К списку заказов
        </Link>
      </div>

      <PageHeader
        title={`Заказ №${order.number}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <Link href={`/customers/${order.customer.id}`} className="text-accent hover:underline">
              {formatCustomerName(order.customer)}
            </Link>
            <span>{formatPhone(order.customer.phone)}</span>
            <span>от {formatDate(order.createdAt)}</span>
            {order.manager ? (
              <span>
                менеджер {order.manager.lastName} {order.manager.firstName}
              </span>
            ) : null}
          </span>
        }
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={commercial.tone}>{commercial.label}</Badge>
            <Badge tone={production.tone}>{production.label}</Badge>
            <Badge tone={payment.tone}>{payment.label}</Badge>
            <Badge tone={priority.tone}>{priority.label}</Badge>
          </div>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Сумма" value={formatMoney(order.total)} />
        <StatCard label="Оплачено" value={formatMoney(order.paidTotal)} tone="positive" />
        <StatCard
          label="Долг"
          value={formatMoney(order.balance)}
          tone={order.balance > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Срок"
          value={formatDate(order.dueDate)}
          tone={overdue ? 'danger' : 'neutral'}
          hint={overdue ? 'Просрочен' : undefined}
        />
      </div>

      {showCost ? (
        <div className="mb-6 grid gap-4 sm:grid-cols-3">
          <StatCard label="Себестоимость" value={formatMoney(order.costTotal)} />
          <StatCard
            label="Валовая прибыль"
            value={formatMoney(order.total - order.costTotal)}
            tone="positive"
          />
          <StatCard
            label="Маржа"
            value={formatPercent(order.total > 0 ? ((order.total - order.costTotal) / order.total) * 100 : 0)}
          />
        </div>
      ) : null}

      <div className="mb-8">
        <OrderActions
          orderId={order.id}
          commercialStatus={order.commercialStatus}
          productionStatus={order.productionStatus}
          balance={order.balance}
          issuedAt={order.issuedAt}
          canEdit={can(user, 'orders.edit')}
          canIssue={can(user, 'orders.issue')}
          canInvoice={can(user, 'invoices.create')}
          hasInvoice={hasOpenInvoice}
          hasWorkItems={order.workItems.some((item) => item.status !== 'CANCELLED')}
        />
      </div>

      {order.notes ? (
        <Card className="mb-6 px-5 py-4">
          <p className="text-sm text-ink-muted">Примечание</p>
          <p className="mt-1 whitespace-pre-wrap">{order.notes}</p>
        </Card>
      ) : null}

      <Card className="mb-6">
        <CardHeader
          title="Изделия"
          description={`${order.workItems.length} работ в заказе`}
          action={
            can(user, 'orders.edit') && editable ? (
              <Link href={`/orders/${order.id}/items/new`}>
                <Button size="sm">
                  <Plus className="size-4" />
                  Добавить изделие
                </Button>
              </Link>
            ) : null
          }
        />

        {order.workItems.length === 0 ? (
          <EmptyState
            title="В заказе ещё нет изделий"
            description="Добавьте работу в конструкторе — расчёт, материалы и цена появятся автоматически."
          />
        ) : (
          <div className="divide-y divide-line">
            {order.workItems.map((item) => (
              <WorkItemSection
                key={item.id}
                item={item}
                showCost={showCost}
                canComment={can(user, 'orders.edit')}
              />
            ))}
          </div>
        )}
      </Card>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Платежи" description="Оплата не меняет коммерческий статус заказа." />
          <div className="p-5">
            {order.payments.length === 0 ? (
              <p className="mb-4 text-sm text-ink-subtle">Платежей ещё нет.</p>
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Дата</Th>
                    <Th>Тип</Th>
                    <Th>Способ</Th>
                    <Th className="text-right">Сумма</Th>
                  </tr>
                </thead>
                <tbody>
                  {order.payments.map((payment) => (
                    <tr key={payment.id}>
                      <Td className="whitespace-nowrap text-ink-muted">{formatDateTime(payment.paidAt)}</Td>
                      <Td>{payment.kind === 'REFUND' ? 'Возврат' : 'Оплата'}</Td>
                      <Td>{PAYMENT_METHOD[payment.method] ?? payment.method}</Td>
                      <Td
                        className={`text-right tabular ${payment.kind === 'REFUND' ? 'text-danger' : ''}`}
                      >
                        {payment.kind === 'REFUND' ? '−' : ''}
                        {formatMoney(payment.amount)}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}

            {can(user, 'payments.create') && order.commercialStatus !== 'CANCELLED' ? (
              <div className="mt-5 border-t border-line pt-5">
                <OrderPaymentForm
                  orderId={order.id}
                  customerId={order.customerId}
                  balance={order.balance}
                  paidTotal={order.paidTotal}
                  canRefund={can(user, 'payments.refund')}
                />
              </div>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="Счета" />
          {order.invoices.length === 0 ? (
            <EmptyState title="Счёт не выставлен" description="Счёт можно сформировать после расчёта изделий." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Номер</Th>
                  <Th>Статус</Th>
                  <Th className="text-right">Сумма</Th>
                  <Th className="text-right">Оплачено</Th>
                  <Th className="text-right">Остаток</Th>
                </tr>
              </thead>
              <tbody>
                {order.invoices.map((invoice) => {
                  const status = labelOf(INVOICE_STATUS, invoice.status);
                  return (
                    <tr key={invoice.id}>
                      <Td className="tabular font-medium">{invoice.number}</Td>
                      <Td>
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </Td>
                      <Td className="text-right tabular">{formatMoney(invoice.total)}</Td>
                      <Td className="text-right tabular">{formatMoney(invoice.paidTotal)}</Td>
                      <Td className="text-right tabular">{formatMoney(invoice.balance)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}

function WorkItemSection({
  item,
  showCost,
  canComment,
}: {
  item: WorkItem;
  showCost: boolean;
  canComment: boolean;
}) {
  const status = labelOf(WORK_ITEM_STATUS, item.status);
  const quality = [...item.qualityChecks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const tasks = item.productionOrder?.tasks ?? [];
  const doneTasks = tasks.filter((task) => task.status === 'DONE').length;
  const reservations = item.reservations;

  return (
    <section className="p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs text-ink-subtle">{item.number}</p>
          <h3 className="text-lg font-medium">{item.title}</h3>
          <p className="mt-0.5 text-sm text-ink-muted">
            {formatSize(item.widthMm, item.heightMm)}
            {item.workType ? ` · ${item.workType}` : ''}
            {item.quantity > 1 ? ` · ${item.quantity} шт.` : ''}
            {item.master ? ` · ${item.master.lastName} ${item.master.firstName}` : ''}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={status.tone}>{status.label}</Badge>
          <span className="tabular font-semibold">{formatMoney(item.price)}</span>
          {item.productionOrder ? (
            <Link href={`/production/${item.id}`} className="text-sm text-accent hover:underline">
              Карта мастера
            </Link>
          ) : null}
        </div>
      </div>

      {item.components.length > 0 ? (
        <div className="mt-4">
          <Table>
            <thead>
              <tr>
                <Th>Группа</Th>
                <Th>Позиция</Th>
                <Th className="text-right">Кол-во</Th>
                {showCost ? <Th className="text-right">Себест.</Th> : null}
                <Th className="text-right">Цена</Th>
              </tr>
            </thead>
            <tbody>
              {item.components.map((component) => (
                <tr key={component.id}>
                  <Td className="text-ink-muted">{CATALOG_GROUP[component.group] ?? component.group}</Td>
                  <Td>
                    <span className="font-medium">{component.name}</span>
                    {component.catalogItem?.internalSku ? (
                      <span className="ml-2 text-xs text-ink-subtle">{component.catalogItem.internalSku}</span>
                    ) : null}
                  </Td>
                  <Td className="text-right tabular">
                    {formatQuantity(component.quantity)} {UNIT[component.unit] ?? component.unit}
                  </Td>
                  {showCost ? (
                    <Td className="text-right tabular text-ink-muted">{formatMoney(component.cost)}</Td>
                  ) : null}
                  <Td className="text-right tabular">{formatMoney(component.price)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </div>
      ) : null}

      {showCost ? (
        <p className="mt-3 text-xs text-ink-subtle">
          Себестоимость {formatMoney(item.totalCost)} · прибыль {formatMoney(item.margin)} ·{' '}
          {formatPercent(item.marginPercent)}
        </p>
      ) : null}

      {reservations.length > 0 ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Материалы</p>
          <ul className="space-y-1 text-sm">
            {reservations.map((reservation) => {
              const reservationStatus = labelOf(RESERVATION_STATUS, reservation.status);
              const catalog = reservation.inventoryItem.catalogItem;
              return (
                <li key={reservation.id} className="flex flex-wrap items-center gap-2">
                  <Badge tone={reservationStatus.tone}>{reservationStatus.label}</Badge>
                  <span>{catalog.name}</span>
                  <span className="tabular text-ink-muted">
                    {formatQuantity(reservation.quantity)} {UNIT[catalog.unit] ?? catalog.unit}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {item.productionOrder ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">
            Производство · {STAGE_LABELS[item.productionOrder.stage]} · {doneTasks}/{tasks.length} операций
          </p>
          <ul className="space-y-1 text-sm">
            {tasks.map((task) => {
              const taskStatus = labelOf(TASK_STATUS, task.status);
              return (
                <li key={task.id} className="flex items-center gap-2">
                  <Badge tone={taskStatus.tone}>{taskStatus.label}</Badge>
                  <span>{task.name}</span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {quality ? (
        <div className="mt-4">
          <p className="mb-2 text-sm font-medium">Контроль качества</p>
          <ul className="grid gap-1 sm:grid-cols-2">
            {quality.items.map((check) => (
              <li key={check.id} className="text-sm">
                <span className={check.checked ? 'text-positive' : check.required ? 'text-warning' : 'text-ink-muted'}>
                  {check.checked ? '☑' : '☐'} {check.label}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {item.statusHistory.length > 0 ? (
        <p className="mt-3 text-xs text-ink-subtle">
          История:{' '}
          {item.statusHistory
            .slice(0, 4)
            .map((entry) => {
              const to = labelOf(WORK_ITEM_STATUS, entry.toStatus).label;
              const who = entry.user ? `${entry.user.lastName} ${entry.user.firstName}` : 'система';
              return `${to} (${who}, ${formatDateTime(entry.createdAt)})`;
            })
            .join(' → ')}
        </p>
      ) : null}

      {item.comments.length > 0 ? (
        <ul className="mt-3 space-y-2">
          {item.comments.map((comment) => (
            <li key={comment.id} className="rounded-lg bg-surface-muted px-3 py-2 text-sm">
              <p className="text-xs text-ink-subtle">
                {formatDateTime(comment.createdAt)}
                {comment.author ? ` · ${comment.author.lastName} ${comment.author.firstName}` : ''}
              </p>
              <p className="mt-0.5 whitespace-pre-wrap">{comment.body}</p>
            </li>
          ))}
        </ul>
      ) : null}

      {canComment && item.status !== 'CANCELLED' ? <WorkItemCommentForm workItemId={item.id} /> : null}
    </section>
  );
}
