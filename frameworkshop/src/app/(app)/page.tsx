import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from '@/components/ui';
import { RevenueChart } from '@/components/revenue-chart';
import { currentUser, can } from '@/server/auth/current-user';
import { formatMoney, formatMoneyShort, formatPercent, formatQuantity } from '@/lib/format';
import { dashboardSummary, revenueSeries } from '@/server/modules/reports/service';

export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const user = await currentUser();
  const showMoney = can(user, 'orders.view_cost');

  const [summary, series] = await Promise.all([
    dashboardSummary(user.organizationId),
    can(user, 'reports.sales') ? revenueSeries(user.organizationId, 30) : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={`Здравствуйте, ${user.firstName}`}
        description="Сводка по мастерской за сегодня и за последние 30 дней."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Заказов сегодня" value={summary.ordersToday} />
        <StatCard label="Выручка сегодня" value={formatMoneyShort(summary.revenueToday)} />
        <StatCard label="Оплачено сегодня" value={formatMoneyShort(summary.paidToday)} />
        <StatCard
          label="Долг клиентов"
          value={formatMoneyShort(summary.debt)}
          hint={`${summary.debtorCount} заказов с задолженностью`}
          tone={summary.debt > 0 ? 'warning' : 'neutral'}
        />

        <StatCard label="В производстве" value={summary.inProduction} />
        <StatCard
          label="Просрочено"
          value={summary.overdue}
          tone={summary.overdue > 0 ? 'danger' : 'positive'}
        />
        <StatCard label="Готово к выдаче" value={summary.readyToIssue} tone="positive" />
        <StatCard
          label="Критические остатки"
          value={summary.criticalStockCount}
          tone={summary.criticalStockCount > 0 ? 'warning' : 'positive'}
          hint="Позиции ниже точки заказа"
        />
      </div>

      {showMoney ? (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <StatCard label="Средний чек (30 дней)" value={formatMoney(summary.averageTicket)} />
          <StatCard label="Валовая прибыль (30 дней)" value={formatMoney(summary.grossProfit)} />
          <StatCard label="Маржинальность" value={formatPercent(summary.marginPercent)} />
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        {series.length > 0 ? (
          <Card className="xl:col-span-2">
            <CardHeader
              title="Выручка и прибыль"
              description={`За 30 дней: ${formatMoney(summary.monthRevenue)} по ${summary.monthOrders} заказам`}
            />
            <div className="p-4">
              <RevenueChart data={series} />
            </div>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            title="Требуют закупки"
            action={
              <Link href="/procurement" className="text-sm text-accent hover:underline">
                Закупки
              </Link>
            }
          />
          {summary.criticalStock.length === 0 ? (
            <EmptyState title="Дефицита нет" description="Все позиции выше точки заказа." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Позиция</Th>
                  <Th className="text-right">Доступно</Th>
                </tr>
              </thead>
              <tbody>
                {summary.criticalStock.map((item) => (
                  <tr key={item.catalogItemId}>
                    <Td>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-ink-subtle">{item.sku}</p>
                    </Td>
                    <Td className="text-right tabular">
                      <Badge tone={item.available <= 0 ? 'danger' : 'warning'}>
                        {formatQuantity(item.available)}
                      </Badge>
                      <p className="mt-1 text-xs text-ink-subtle">
                        мин. {formatQuantity(item.reorderPoint)}
                      </p>
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>
    </>
  );
}
