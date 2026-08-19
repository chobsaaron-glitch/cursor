import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from '@/components/ui';
import { PaymentsPeriodFilter } from '@/components/payments-period-filter';
import {
  formatCustomerName,
  formatDate,
  formatDateTime,
  formatMoney,
  formatMoneyShort,
  formatPhone,
} from '@/lib/format';
import { PAYMENT_METHOD } from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import { debtors, listPayments } from '@/server/modules/payments/service';
import { lastDays } from '@/server/modules/reports/service';

export const dynamic = 'force-dynamic';

const TAKE = 100;

/** Kept in step with the options rendered by PaymentsPeriodFilter. */
const PERIODS = [7, 30, 90, 365];

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();

  if (!can(user, 'payments.view')) {
    return (
      <>
        <PageHeader title="Оплаты" />
        <Card className="px-5 py-8">
          <p className="text-ink-muted">Недостаточно прав</p>
          <p className="mt-1 text-sm text-ink-subtle">
            Для просмотра платежей нужно право «Просмотр платежей».
          </p>
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const requestedDays = Number.parseInt(firstValue(params.days), 10);
  const days = PERIODS.includes(requestedDays) ? requestedDays : 30;
  const period = lastDays(days);

  const [payments, debtorRows] = await Promise.all([
    listPayments(user.organizationId, { from: period.from, to: period.to, take: TAKE }),
    debtors(user.organizationId),
  ]);

  const debt = debtorRows.reduce((acc, row) => acc + row.balance, 0);
  const debtOrders = debtorRows.reduce((acc, row) => acc + row.orders, 0);

  return (
    <>
      <PageHeader
        title="Оплаты"
        description="Поступления, возвраты и задолженность клиентов."
        action={<PaymentsPeriodFilter days={days} />}
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label={`Оплачено за ${days} дней`}
          value={formatMoneyShort(payments.received)}
          tone="positive"
          hint={`Платежей: ${payments.total}`}
        />
        <StatCard
          label="Возвраты"
          value={formatMoneyShort(payments.refunded)}
          tone={payments.refunded > 0 ? 'warning' : 'neutral'}
          hint={`Чистое поступление: ${formatMoney(payments.net)}`}
        />
        <StatCard
          label="Текущий долг"
          value={formatMoneyShort(debt)}
          tone={debt > 0 ? 'danger' : 'positive'}
          hint={`${debtorRows.length} клиентов · ${debtOrders} заказов`}
        />
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Платежи"
          description={`Показаны последние ${Math.min(payments.items.length, TAKE)} операций за выбранный период`}
        />

        {payments.items.length === 0 ? (
          <EmptyState title="Платежей нет" description="За выбранный период операций не было." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Дата</Th>
                <Th>Номер</Th>
                <Th>Клиент</Th>
                <Th>Заказ</Th>
                <Th>Способ</Th>
                <Th>Вид</Th>
                <Th className="text-right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {payments.items.map((payment) => {
                const isRefund = payment.kind === 'REFUND';
                return (
                  <tr key={payment.id}>
                    <Td className="tabular whitespace-nowrap text-ink-muted">
                      {formatDateTime(payment.paidAt)}
                    </Td>
                    <Td className="tabular font-medium">{payment.number}</Td>
                    <Td>
                      <Link
                        href={`/customers/${payment.customer.id}`}
                        className="text-accent hover:underline"
                      >
                        {formatCustomerName(payment.customer)}
                      </Link>
                    </Td>
                    <Td>
                      {payment.order ? (
                        <Link
                          href={`/orders/${payment.order.id}`}
                          className="tabular text-accent hover:underline"
                        >
                          {payment.order.number}
                        </Link>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="text-ink-muted">
                      {PAYMENT_METHOD[payment.method] ?? payment.method}
                    </Td>
                    <Td>
                      <Badge tone={isRefund ? 'warning' : 'positive'}>
                        {isRefund ? 'Возврат' : 'Платёж'}
                      </Badge>
                    </Td>
                    <Td
                      className={`text-right tabular font-medium ${isRefund ? 'text-danger' : 'text-ink'}`}
                    >
                      {isRefund ? '−' : ''}
                      {formatMoney(payment.amount)}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Должники"
          description="Клиенты с непогашенным остатком по заказам."
          action={
            <span className="tabular text-sm font-medium text-danger">{formatMoney(debt)}</span>
          }
        />

        {debtorRows.length === 0 ? (
          <EmptyState title="Долгов нет" description="Все заказы оплачены полностью." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Клиент</Th>
                <Th>Телефон</Th>
                <Th className="text-right">Заказов</Th>
                <Th>Самый ранний заказ</Th>
                <Th className="text-right">Долг</Th>
              </tr>
            </thead>
            <tbody>
              {debtorRows.map((row) => (
                <tr key={row.customer.id}>
                  <Td>
                    <Link
                      href={`/customers/${row.customer.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      {formatCustomerName(row.customer)}
                    </Link>
                    <p className="tabular text-xs text-ink-subtle">{row.customer.number}</p>
                  </Td>
                  <Td className="tabular text-ink-muted">{formatPhone(row.customer.phone)}</Td>
                  <Td className="text-right tabular">{row.orders}</Td>
                  <Td className="tabular text-ink-muted">{formatDate(row.oldest)}</Td>
                  <Td className="text-right tabular font-medium text-danger">
                    {formatMoney(row.balance)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
