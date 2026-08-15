import Link from 'next/link';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th, cn } from '@/components/ui';
import { ReportsGroupChart } from '@/components/reports-group-chart';
import { REPORT_PERIODS, ReportsPeriodSelect } from '@/components/reports-period-select';
import {
  formatDate,
  formatMinutes,
  formatMoney,
  formatMoneyShort,
  formatPercent,
  formatQuantity,
} from '@/lib/format';
import { CATALOG_GROUP, PAYMENT_METHOD, UNIT } from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import type { Permission } from '@/server/auth/permissions';
import type { SessionUser } from '@/server/auth/session';
import {
  consumptionReport,
  financeSummary,
  inventoryReport,
  lastDays,
  mouldingAbc,
  orderProfitability,
  productionSummary,
  salesByEmployee,
  salesByGroup,
  type Period,
} from '@/server/modules/reports/service';

export const dynamic = 'force-dynamic';

interface TabDefinition {
  key: string;
  label: string;
  permission: Permission;
  /** Whether the report is bound to a period selector. */
  periodic: boolean;
}

const TABS: TabDefinition[] = [
  { key: 'finance', label: 'Финансы', permission: 'reports.finance', periodic: true },
  { key: 'employees', label: 'Продажи по сотрудникам', permission: 'reports.sales', periodic: true },
  { key: 'groups', label: 'Продажи по группам', permission: 'reports.sales', periodic: true },
  { key: 'abc', label: 'ABC-анализ багета', permission: 'reports.sales', periodic: true },
  { key: 'production', label: 'Производство', permission: 'reports.production', periodic: true },
  { key: 'inventory', label: 'Склад', permission: 'reports.inventory', periodic: false },
  { key: 'consumption', label: 'Расход материалов', permission: 'reports.inventory', periodic: true },
  { key: 'profitability', label: 'Рентабельность заказов', permission: 'reports.finance', periodic: true },
];

const ROW_LIMIT = 100;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

function marginTone(value: number): 'positive' | 'warning' | 'danger' {
  if (value >= 40) return 'positive';
  if (value >= 20) return 'warning';
  return 'danger';
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const tabs = TABS.filter((tab) => can(user, tab.permission));

  if (tabs.length === 0) {
    return (
      <>
        <PageHeader title="Отчёты" />
        <Card className="px-5 py-8">
          <p className="text-ink-muted">Недостаточно прав</p>
          <p className="mt-1 text-sm text-ink-subtle">
            Ни один из отчётов не доступен для вашей роли.
          </p>
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const requestedTab = firstValue(params.tab);
  const activeTab = tabs.find((tab) => tab.key === requestedTab) ?? tabs[0];

  const requestedDays = Number.parseInt(firstValue(params.days), 10);
  const days = REPORT_PERIODS.includes(requestedDays as (typeof REPORT_PERIODS)[number])
    ? requestedDays
    : 30;
  const period = lastDays(days);

  return (
    <>
      <PageHeader
        title="Отчёты"
        description="Аналитика по продажам, финансам, производству и складу."
        action={
          activeTab.periodic ? <ReportsPeriodSelect tab={activeTab.key} days={days} /> : null
        }
      />

      <nav className="mb-6 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <Link
            key={tab.key}
            href={`/reports?tab=${tab.key}&days=${days}`}
            className={cn(
              'rounded-lg border px-3 py-1.5 text-sm transition-colors',
              tab.key === activeTab.key
                ? 'border-accent bg-accent-soft font-medium text-accent'
                : 'border-line bg-surface text-ink-muted hover:bg-surface-muted hover:text-ink',
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      <p className="mb-4 text-sm text-ink-muted">
        {activeTab.periodic
          ? `Период: ${formatDate(period.from)} — ${formatDate(period.to)}`
          : 'Данные на текущий момент'}
      </p>

      {activeTab.key === 'finance' ? <FinanceReport user={user} period={period} /> : null}
      {activeTab.key === 'employees' ? <EmployeesReport user={user} period={period} /> : null}
      {activeTab.key === 'groups' ? <GroupsReport user={user} period={period} /> : null}
      {activeTab.key === 'abc' ? <AbcReport user={user} period={period} /> : null}
      {activeTab.key === 'production' ? <ProductionReport user={user} period={period} /> : null}
      {activeTab.key === 'inventory' ? <InventoryReport user={user} /> : null}
      {activeTab.key === 'consumption' ? <ConsumptionReport user={user} period={period} /> : null}
      {activeTab.key === 'profitability' ? <ProfitabilityReport user={user} period={period} /> : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// Финансы
// ---------------------------------------------------------------------------

async function FinanceReport({ user, period }: { user: SessionUser; period: Period }) {
  const summary = await financeSummary(user.organizationId, period);

  const lines: Array<{ label: string; value: number; tone?: 'positive' | 'danger' }> = [
    { label: 'Выручка без налога', value: summary.revenue },
    { label: 'Налог', value: summary.tax },
    { label: 'Скидки', value: summary.discounts },
    { label: 'Себестоимость', value: summary.cost },
    { label: 'Валовая прибыль', value: summary.grossProfit, tone: 'positive' },
    { label: 'Расходы', value: summary.expenses },
    { label: 'Зарплата', value: summary.payroll },
    { label: 'Чистая прибыль', value: summary.netProfit, tone: summary.netProfit >= 0 ? 'positive' : 'danger' },
    { label: 'Возвраты', value: summary.refunds },
    { label: 'Задолженность по заказам', value: summary.debt, tone: 'danger' },
  ];

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Выручка" value={formatMoneyShort(summary.revenue)} hint={`Заказов: ${summary.orderCount}`} />
        <StatCard label="Валовая прибыль" value={formatMoneyShort(summary.grossProfit)} tone="positive" />
        <StatCard label="Маржинальность" value={formatPercent(summary.marginPercent)} />
        <StatCard label="Средний чек" value={formatMoneyShort(summary.averageTicket)} />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Отчёт о прибылях" description="Все суммы за выбранный период." />
          <Table>
            <thead>
              <tr>
                <Th>Показатель</Th>
                <Th className="text-right">Сумма</Th>
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <tr key={line.label}>
                  <Td>{line.label}</Td>
                  <Td
                    className={cn(
                      'text-right tabular font-medium',
                      line.tone === 'positive' && 'text-positive',
                      line.tone === 'danger' && 'text-danger',
                    )}
                  >
                    {formatMoney(line.value)}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>

        <Card>
          <CardHeader title="Поступления по способам оплаты" />
          {summary.paymentsByMethod.length === 0 ? (
            <EmptyState title="Платежей нет" description="За выбранный период поступлений не было." />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Способ</Th>
                  <Th className="text-right">Сумма</Th>
                </tr>
              </thead>
              <tbody>
                {summary.paymentsByMethod.map((row) => (
                  <tr key={row.method}>
                    <Td>{PAYMENT_METHOD[row.method] ?? row.method}</Td>
                    <Td className="text-right tabular">{formatMoney(row.amount)}</Td>
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

// ---------------------------------------------------------------------------
// Продажи по сотрудникам
// ---------------------------------------------------------------------------

async function EmployeesReport({ user, period }: { user: SessionUser; period: Period }) {
  const rows = await salesByEmployee(user.organizationId, period);
  const showCost = can(user, 'orders.view_cost');

  return (
    <Card>
      <CardHeader title="Продажи по сотрудникам" description="Заказы, оформленные менеджером за период." />
      {rows.length === 0 ? (
        <EmptyState title="Данных нет" description="За выбранный период заказов не было." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Сотрудник</Th>
              <Th className="text-right">Заказов</Th>
              <Th className="text-right">Выручка</Th>
              <Th className="text-right">Средний чек</Th>
              {showCost ? <Th className="text-right">Себестоимость</Th> : null}
              {showCost ? <Th className="text-right">Прибыль</Th> : null}
              {showCost ? <Th className="text-right">Маржа</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <Td className="font-medium">{row.name}</Td>
                <Td className="text-right tabular">{row.orders}</Td>
                <Td className="text-right tabular">{formatMoney(row.revenue)}</Td>
                <Td className="text-right tabular">{formatMoney(row.averageTicket)}</Td>
                {showCost ? (
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.cost)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right tabular font-medium">{formatMoney(row.profit)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right">
                    <Badge tone={marginTone(row.marginPercent)}>{formatPercent(row.marginPercent)}</Badge>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Продажи по группам
// ---------------------------------------------------------------------------

async function GroupsReport({ user, period }: { user: SessionUser; period: Period }) {
  const rows = await salesByGroup(user.organizationId, period);
  const showCost = can(user, 'orders.view_cost');

  if (rows.length === 0) {
    return (
      <Card>
        <EmptyState title="Данных нет" description="За выбранный период продаж не было." />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader title="Выручка и прибыль по группам" description="Из чего складывается заработок мастерской." />
        <div className="p-4">
          <ReportsGroupChart
            data={rows.map((row) => ({
              label: CATALOG_GROUP[row.group] ?? row.group,
              revenue: row.revenue,
              profit: row.profit,
            }))}
          />
        </div>
      </Card>

      <Card>
        <CardHeader title="Продажи по группам материалов" />
        <Table>
          <thead>
            <tr>
              <Th>Группа</Th>
              <Th className="text-right">Строк</Th>
              <Th className="text-right">Количество</Th>
              <Th className="text-right">Выручка</Th>
              {showCost ? <Th className="text-right">Себестоимость</Th> : null}
              {showCost ? <Th className="text-right">Прибыль</Th> : null}
              {showCost ? <Th className="text-right">Маржа</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.group}>
                <Td className="font-medium">{CATALOG_GROUP[row.group] ?? row.group}</Td>
                <Td className="text-right tabular">{row.lines}</Td>
                <Td className="text-right tabular">{formatQuantity(row.quantity)}</Td>
                <Td className="text-right tabular">{formatMoney(row.revenue)}</Td>
                {showCost ? (
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.cost)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right tabular font-medium">{formatMoney(row.profit)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right">
                    <Badge tone={marginTone(row.marginPercent)}>{formatPercent(row.marginPercent)}</Badge>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ABC-анализ багета
// ---------------------------------------------------------------------------

async function AbcReport({ user, period }: { user: SessionUser; period: Period }) {
  const rows = await mouldingAbc(user.organizationId, period);
  const showCost = can(user, 'orders.view_cost');

  return (
    <Card>
      <CardHeader
        title="ABC-анализ багета"
        description="A — 80 % выручки, B — следующие 15 %, C — остальные."
      />
      {rows.length === 0 ? (
        <EmptyState title="Данных нет" description="За выбранный период багет не продавался." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Класс</Th>
              <Th>Артикул</Th>
              <Th>Наименование</Th>
              <Th className="text-right">Изделий</Th>
              <Th className="text-right">Метров</Th>
              <Th className="text-right">Выручка</Th>
              <Th className="text-right">Выручка за метр</Th>
              {showCost ? <Th className="text-right">Прибыль</Th> : null}
              {showCost ? <Th className="text-right">Прибыль за метр</Th> : null}
              {showCost ? <Th className="text-right">Маржа</Th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROW_LIMIT).map((row) => (
              <tr key={row.catalogItemId}>
                <Td>
                  <Badge tone={row.abc === 'A' ? 'positive' : row.abc === 'B' ? 'info' : 'neutral'}>
                    {row.abc}
                  </Badge>
                </Td>
                <Td className="tabular text-ink-muted">{row.sku}</Td>
                <Td className="font-medium">{row.name}</Td>
                <Td className="text-right tabular">{row.orders}</Td>
                <Td className="text-right tabular">{formatQuantity(row.metres)}</Td>
                <Td className="text-right tabular">{formatMoney(row.revenue)}</Td>
                <Td className="text-right tabular text-ink-muted">{formatMoney(row.revenuePerMetre)}</Td>
                {showCost ? (
                  <Td className="text-right tabular font-medium">{formatMoney(row.profit)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.profitPerMetre)}</Td>
                ) : null}
                {showCost ? (
                  <Td className="text-right">
                    <Badge tone={marginTone(row.marginPercent)}>{formatPercent(row.marginPercent)}</Badge>
                  </Td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Производство
// ---------------------------------------------------------------------------

async function ProductionReport({ user, period }: { user: SessionUser; period: Period }) {
  const summary = await productionSummary(user.organizationId, period);
  const showPay = can(user, 'payroll.view');

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Выполнено операций" value={formatQuantity(summary.completedTasks)} />
        <StatCard
          label="Просроченных изделий"
          value={formatQuantity(summary.overdue)}
          tone={summary.overdue > 0 ? 'danger' : 'positive'}
        />
        <StatCard label="Мастеров в работе" value={formatQuantity(summary.byMaster.length)} />
      </div>

      <Card className="mt-6">
        <CardHeader title="Производительность мастеров" description="Выполненные операции за период." />
        {summary.byMaster.length === 0 ? (
          <EmptyState title="Данных нет" description="За выбранный период операции не выполнялись." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Мастер</Th>
                <Th className="text-right">Операций</Th>
                <Th className="text-right">Норма</Th>
                <Th className="text-right">Факт</Th>
                <Th className="text-right">Эффективность</Th>
                {showPay ? <Th className="text-right">Начислено</Th> : null}
              </tr>
            </thead>
            <tbody>
              {summary.byMaster.map((row) => (
                <tr key={row.id}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td className="text-right tabular">{row.tasks}</Td>
                  <Td className="text-right tabular text-ink-muted">
                    {formatMinutes(row.standardMinutes)}
                  </Td>
                  <Td className="text-right tabular">{formatMinutes(row.actualMinutes)}</Td>
                  <Td className="text-right">
                    <Badge tone={row.efficiencyPercent >= 100 ? 'positive' : 'warning'}>
                      {formatPercent(row.efficiencyPercent)}
                    </Badge>
                  </Td>
                  {showPay ? (
                    <Td className="text-right tabular font-medium">{formatMoney(row.pay)}</Td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Склад
// ---------------------------------------------------------------------------

async function InventoryReport({ user }: { user: SessionUser }) {
  const report = await inventoryReport(user.organizationId);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Стоимость запаса" value={formatMoneyShort(report.totalValue)} />
        <StatCard
          label="Ниже точки заказа"
          value={formatQuantity(report.lowCount)}
          tone={report.lowCount > 0 ? 'warning' : 'positive'}
        />
        <StatCard
          label="Неликвиды"
          value={formatQuantity(report.staleCount)}
          hint="Не расходовались более 90 дней"
          tone={report.staleCount > 0 ? 'warning' : 'positive'}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Складские остатки" description="Отсортированы по стоимости запаса." />
        {report.rows.length === 0 ? (
          <EmptyState title="Склад пуст" description="Складские позиции ещё не заведены." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Артикул</Th>
                <Th>Наименование</Th>
                <Th>Группа</Th>
                <Th className="text-right">Остаток</Th>
                <Th className="text-right">Резерв</Th>
                <Th className="text-right">Доступно</Th>
                <Th className="text-right">Стоимость</Th>
                <Th>Состояние</Th>
              </tr>
            </thead>
            <tbody>
              {report.rows.slice(0, ROW_LIMIT).map((row) => (
                <tr key={row.catalogItemId} className={cn(row.isLow && 'bg-warning-soft/50')}>
                  <Td className="tabular text-ink-muted">{row.sku}</Td>
                  <Td className="font-medium">{row.name}</Td>
                  <Td className="text-ink-muted">{CATALOG_GROUP[row.group] ?? row.group}</Td>
                  <Td className="text-right tabular">
                    {formatQuantity(row.onHand)} {UNIT[row.unit] ?? row.unit}
                  </Td>
                  <Td className="text-right tabular text-ink-muted">{formatQuantity(row.reserved)}</Td>
                  <Td className="text-right tabular">{formatQuantity(row.available)}</Td>
                  <Td className="text-right tabular font-medium">{formatMoney(row.value)}</Td>
                  <Td>
                    <div className="flex gap-1">
                      {row.isLow ? <Badge tone="warning">Дефицит</Badge> : null}
                      {row.isStale ? <Badge tone="neutral">Неликвид</Badge> : null}
                      {!row.isLow && !row.isStale ? <Badge tone="positive">Норма</Badge> : null}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {report.rows.length > ROW_LIMIT ? (
          <p className="px-5 py-3 text-xs text-ink-subtle">
            Показаны {ROW_LIMIT} позиций с наибольшей стоимостью запаса из {report.rows.length}.
          </p>
        ) : null}
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Расход материалов
// ---------------------------------------------------------------------------

async function ConsumptionReport({ user, period }: { user: SessionUser; period: Period }) {
  const rows = await consumptionReport(user.organizationId, period);
  const totalCost = rows.reduce((acc, row) => acc + row.cost, 0);

  return (
    <Card>
      <CardHeader
        title="Расход материалов"
        description="Полезный расход, технологический отход и списания по журналу движений."
        action={<span className="tabular text-sm font-medium">{formatMoney(totalCost)}</span>}
      />
      {rows.length === 0 ? (
        <EmptyState title="Данных нет" description="За выбранный период материалы не списывались." />
      ) : (
        <Table>
          <thead>
            <tr>
              <Th>Материал</Th>
              <Th>Группа</Th>
              <Th className="text-right">Полезный расход</Th>
              <Th className="text-right">Отход</Th>
              <Th className="text-right">Списание</Th>
              <Th className="text-right">Доля отхода</Th>
              <Th className="text-right">Себестоимость</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, ROW_LIMIT).map((row) => {
              const unitLabel = UNIT[row.unit] ?? row.unit;
              return (
                <tr key={row.catalogItemId}>
                  <Td className="font-medium">{row.name}</Td>
                  <Td className="text-ink-muted">{CATALOG_GROUP[row.group] ?? row.group}</Td>
                  <Td className="text-right tabular">
                    {formatQuantity(row.used)} {unitLabel}
                  </Td>
                  <Td className="text-right tabular text-ink-muted">{formatQuantity(row.waste)}</Td>
                  <Td className="text-right tabular text-ink-muted">{formatQuantity(row.writeOff)}</Td>
                  <Td className="text-right">
                    <Badge tone={row.wastePercent > 15 ? 'danger' : row.wastePercent > 8 ? 'warning' : 'positive'}>
                      {formatPercent(row.wastePercent)}
                    </Badge>
                  </Td>
                  <Td className="text-right tabular font-medium">{formatMoney(row.cost)}</Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Рентабельность заказов
// ---------------------------------------------------------------------------

async function ProfitabilityReport({ user, period }: { user: SessionUser; period: Period }) {
  const rows = await orderProfitability(user.organizationId, period);
  const revenue = rows.reduce((acc, row) => acc + row.revenue, 0);
  const profit = rows.reduce((acc, row) => acc + row.grossProfit, 0);

  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Заказов" value={formatQuantity(rows.length)} />
        <StatCard label="Выручка" value={formatMoneyShort(revenue)} />
        <StatCard
          label="Валовая прибыль"
          value={formatMoneyShort(profit)}
          tone={profit >= 0 ? 'positive' : 'danger'}
        />
      </div>

      <Card className="mt-6">
        <CardHeader title="Рентабельность заказов" description="Себестоимость разложена по материалам, работе и прочему." />
        {rows.length === 0 ? (
          <EmptyState title="Данных нет" description="За выбранный период заказов не было." />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Заказ</Th>
                <Th>Дата</Th>
                <Th>Клиент</Th>
                <Th className="text-right">Выручка</Th>
                <Th className="text-right">Материалы</Th>
                <Th className="text-right">Работа</Th>
                <Th className="text-right">Прочее</Th>
                <Th className="text-right">Прибыль</Th>
                <Th className="text-right">Маржа</Th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, ROW_LIMIT).map((row) => (
                <tr key={row.id}>
                  <Td className="tabular font-medium">
                    <Link href={`/orders/${row.id}`} className="text-accent hover:underline">
                      {row.number}
                    </Link>
                  </Td>
                  <Td className="tabular text-ink-muted">{formatDate(row.createdAt)}</Td>
                  <Td>{row.customer}</Td>
                  <Td className="text-right tabular">{formatMoney(row.revenue)}</Td>
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.materials)}</Td>
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.labour)}</Td>
                  <Td className="text-right tabular text-ink-muted">{formatMoney(row.other)}</Td>
                  <Td
                    className={cn(
                      'text-right tabular font-medium',
                      row.grossProfit < 0 ? 'text-danger' : 'text-ink',
                    )}
                  >
                    {formatMoney(row.grossProfit)}
                  </Td>
                  <Td className="text-right">
                    <Badge tone={marginTone(row.marginPercent)}>{formatPercent(row.marginPercent)}</Badge>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        {rows.length > ROW_LIMIT ? (
          <p className="px-5 py-3 text-xs text-ink-subtle">
            Показаны последние {ROW_LIMIT} заказов из {rows.length}.
          </p>
        ) : null}
      </Card>
    </>
  );
}
