import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  StatCard,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { CustomerTypeBadge } from '@/components/customers-type-badge';
import {
  formatCustomerName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPhone,
} from '@/lib/format';
import {
  COMMERCIAL_STATUS,
  PAYMENT_STATUS,
  PRODUCTION_STATUS,
  WORK_ITEM_STATUS,
  labelOf,
} from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import { NotFoundError } from '@/server/lib/context';
import { getCustomer } from '@/server/modules/customers/service';

export const dynamic = 'force-dynamic';

const CHANNEL_LABEL: Record<string, string> = {
  PHONE: 'Телефон',
  EMAIL: 'E-mail',
  SMS: 'SMS',
  TELEGRAM: 'Telegram',
  WHATSAPP: 'WhatsApp',
  IN_PERSON: 'Личная встреча',
  OTHER: 'Другое',
};

type CustomerCard = Awaited<ReturnType<typeof getCustomer>>;

async function loadCustomer(organizationId: string, id: string): Promise<CustomerCard | null> {
  try {
    return await getCustomer(organizationId, id);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
}

export default async function CustomerCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await currentUser();
  const { id } = await params;

  if (!can(user, 'customers.view')) {
    return (
      <>
        <PageHeader title="Карточка клиента" />
        <Card>
          <EmptyState
            title="Недостаточно прав"
            description="У вашей роли нет доступа к базе клиентов."
          />
        </Card>
      </>
    );
  }

  const customer = await loadCustomer(user.organizationId, id);
  if (!customer) notFound();

  const { stats } = customer;
  const manager = customer.manager
    ? [customer.manager.lastName, customer.manager.firstName].filter(Boolean).join(' ')
    : null;

  return (
    <>
      <Link
        href="/customers"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" />
        Клиенты
      </Link>

      <PageHeader
        title={formatCustomerName(customer)}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <CustomerTypeBadge type={customer.type} />
            <span className="tabular">{formatPhone(customer.phone)}</span>
            {customer.phone2 ? (
              <span className="tabular text-ink-subtle">доп. {formatPhone(customer.phone2)}</span>
            ) : null}
            <span className="text-ink-subtle">№ {customer.number}</span>
          </span>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <StatCard label="Всего заказов" value={stats.orderCount} />
        <StatCard
          label="Выручка (LTV)"
          value={formatMoney(stats.ltv)}
          hint={stats.firstOrderAt ? `С ${formatDate(stats.firstOrderAt)}` : 'Заказов ещё не было'}
        />
        <StatCard label="Оплачено" value={formatMoney(stats.paid)} tone="positive" hint={stats.refunded > 0 ? `Возвраты: ${formatMoney(stats.refunded)}` : undefined} />
        <StatCard
          label="Долг"
          value={formatMoney(stats.debt)}
          tone={stats.debt > 0 ? 'danger' : 'neutral'}
        />
        <StatCard
          label="Средний чек"
          value={formatMoney(stats.averageTicket)}
          hint={
            stats.orderFrequencyDays !== null
              ? `Заказ раз в ${stats.orderFrequencyDays} дн.`
              : undefined
          }
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <Card>
          <CardHeader title="Профиль" />
          <dl className="divide-y divide-line text-sm">
            <Row label="Источник" value={customer.source?.name ?? '—'} />
            <Row label="Менеджер" value={manager ?? '—'} />
            <Row label="Дата рождения" value={formatDate(customer.birthDate)} />
            <Row
              label="Согласие на коммуникации"
              value={
                <Badge tone={customer.marketingConsent ? 'positive' : 'neutral'}>
                  {customer.marketingConsent ? 'Получено' : 'Нет'}
                </Badge>
              }
            />
            <Row label="Скидка" value={formatPercent(customer.discountPercent)} />
            {customer.inn ? <Row label="ИНН" value={customer.inn} /> : null}
            <Row label="E-mail" value={customer.email ?? '—'} />
            <Row label="Telegram" value={customer.telegram ?? '—'} />
            {customer.whatsapp ? <Row label="WhatsApp" value={customer.whatsapp} /> : null}
            <Row
              label="Адрес"
              value={[customer.city, customer.address].filter(Boolean).join(', ') || '—'}
            />
            {customer.segment ? <Row label="Сегмент" value={customer.segment} /> : null}
            <Row label="Последний контакт" value={formatDateTime(customer.lastContactAt)} />
            {customer.nextContactAt ? (
              <Row label="Следующий контакт" value={formatDateTime(customer.nextContactAt)} />
            ) : null}
            <Row label="В базе с" value={formatDate(customer.createdAt)} />
            {customer.note ? <Row label="Примечание" value={customer.note} /> : null}
          </dl>

          {customer.contacts.length > 0 ? (
            <div className="border-t border-line px-5 py-4">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                Контактные лица
              </p>
              <ul className="mt-2 space-y-2">
                {customer.contacts.map((contact) => (
                  <li key={contact.id} className="text-sm">
                    <span className="font-medium">{contact.name}</span>
                    {contact.position ? (
                      <span className="text-ink-subtle"> — {contact.position}</span>
                    ) : null}
                    <span className="block tabular text-xs text-ink-muted">
                      {formatPhone(contact.phone)}
                      {contact.email ? ` · ${contact.email}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>

        <div className="space-y-6 xl:col-span-2">
          <Card>
            <CardHeader
              title="Текущие заказы"
              description={`В работе: ${customer.activeOrders.length}`}
            />
            {customer.activeOrders.length === 0 ? (
              <EmptyState title="Активных заказов нет" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Заказ</Th>
                    <Th>Статус</Th>
                    <Th>Производство</Th>
                    <Th>Оплата</Th>
                    <Th className="text-right">Сумма</Th>
                    <Th className="text-right">Долг</Th>
                    <Th>Срок</Th>
                  </tr>
                </thead>
                <tbody>
                  {customer.activeOrders.map((order) => {
                    const commercial = labelOf(COMMERCIAL_STATUS, order.commercialStatus);
                    const production = labelOf(PRODUCTION_STATUS, order.productionStatus);
                    const payment = labelOf(PAYMENT_STATUS, order.paymentStatus);

                    return (
                      <tr key={order.id} className="hover:bg-surface-muted">
                        <Td>
                          <Link
                            href={`/orders/${order.id}`}
                            className="tabular font-medium text-accent hover:underline"
                          >
                            {order.number}
                          </Link>
                          <span className="mt-0.5 block text-xs text-ink-subtle">
                            от {formatDate(order.createdAt)}
                          </span>
                          {order.workItems.length > 0 ? (
                            <span className="mt-1 flex flex-wrap gap-1">
                              {order.workItems.map((item) => {
                                const itemStatus = labelOf(WORK_ITEM_STATUS, item.status);
                                return (
                                  <Badge key={item.id} tone={itemStatus.tone}>
                                    {item.title} · {itemStatus.label}
                                  </Badge>
                                );
                              })}
                            </span>
                          ) : null}
                        </Td>
                        <Td>
                          <Badge tone={commercial.tone}>{commercial.label}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={production.tone}>{production.label}</Badge>
                        </Td>
                        <Td>
                          <Badge tone={payment.tone}>{payment.label}</Badge>
                        </Td>
                        <Td className="tabular text-right">{formatMoney(order.total)}</Td>
                        <Td className="tabular text-right">
                          {order.balance > 0 ? (
                            <span className="text-danger">{formatMoney(order.balance)}</span>
                          ) : (
                            <span className="text-ink-subtle">—</span>
                          )}
                        </Td>
                        <Td className="tabular whitespace-nowrap text-ink-muted">
                          {formatDate(order.dueDate)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>

          <Card>
            <CardHeader
              title="Завершённые заказы"
              description={`Закрыто: ${customer.completedOrders.length}`}
            />
            {customer.completedOrders.length === 0 ? (
              <EmptyState title="Завершённых заказов нет" />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Заказ</Th>
                    <Th>Оплата</Th>
                    <Th className="text-right">Сумма</Th>
                    <Th className="text-right">Скидка</Th>
                    <Th>Закрыт</Th>
                  </tr>
                </thead>
                <tbody>
                  {customer.completedOrders.map((order) => {
                    const payment = labelOf(PAYMENT_STATUS, order.paymentStatus);
                    return (
                      <tr key={order.id} className="hover:bg-surface-muted">
                        <Td>
                          <Link
                            href={`/orders/${order.id}`}
                            className="tabular font-medium text-accent hover:underline"
                          >
                            {order.number}
                          </Link>
                          <span className="mt-0.5 block text-xs text-ink-subtle">
                            {order.workItems.length} изд.
                          </span>
                        </Td>
                        <Td>
                          <Badge tone={payment.tone}>{payment.label}</Badge>
                        </Td>
                        <Td className="tabular text-right">{formatMoney(order.total)}</Td>
                        <Td className="tabular text-right text-ink-muted">
                          {order.discountTotal > 0 ? formatMoney(order.discountTotal) : '—'}
                        </Td>
                        <Td className="tabular whitespace-nowrap text-ink-muted">
                          {formatDate(order.closedAt)}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="История контактов"
            description="Звонки, письма и сообщения клиенту"
          />
          {customer.communications.length === 0 ? (
            <EmptyState title="Контактов пока не было" />
          ) : (
            <ul className="divide-y divide-line">
              {customer.communications.map((communication) => {
                const inbound = communication.direction === 'IN';
                return (
                  <li key={communication.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={inbound ? 'info' : 'accent'}>
                        {inbound ? (
                          <ArrowDownLeft className="mr-1 size-3" />
                        ) : (
                          <ArrowUpRight className="mr-1 size-3" />
                        )}
                        {inbound ? 'Входящий' : 'Исходящий'}
                      </Badge>
                      <span className="text-sm text-ink-muted">
                        {CHANNEL_LABEL[communication.channel] ?? communication.channel}
                      </span>
                      <span className="tabular ml-auto text-xs text-ink-subtle">
                        {formatDateTime(communication.createdAt)}
                      </span>
                    </div>
                    {communication.subject ? (
                      <p className="mt-2 text-sm font-medium">{communication.subject}</p>
                    ) : null}
                    <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">
                      {communication.body}
                    </p>
                    {communication.user ? (
                      <p className="mt-1 text-xs text-ink-subtle">
                        {communication.user.lastName} {communication.user.firstName}
                      </p>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Внутренние заметки"
            description="Видны только сотрудникам мастерской"
          />
          {customer.notes.length === 0 ? (
            <EmptyState title="Заметок нет" />
          ) : (
            <ul className="divide-y divide-line">
              {customer.notes.map((note) => (
                <li key={note.id} className="px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium">
                      {note.author
                        ? `${note.author.lastName} ${note.author.firstName}`
                        : 'Система'}
                    </span>
                    <span className="tabular text-xs text-ink-subtle">
                      {formatDateTime(note.createdAt)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm whitespace-pre-line text-ink-muted">{note.body}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 px-5 py-2.5">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
