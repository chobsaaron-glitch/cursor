import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import type { PurchaseOrderStatus } from '@/generated/prisma/client';
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatCard, Table, Td, Th } from '@/components/ui';
import { ProcurementAutoOrders } from '@/components/procurement-auto-orders';
import { ProcurementStatusFilter } from '@/components/procurement-status-filter';
import { formatDate, formatMoney, formatMoneyShort, formatQuantity } from '@/lib/format';
import { PURCHASE_ORDER_STATUS, UNIT, labelOf } from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import { listPurchaseOrders, suggestPurchases } from '@/server/modules/procurement/service';

export const dynamic = 'force-dynamic';

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function ProcurementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();

  if (!can(user, 'procurement.view')) {
    return (
      <>
        <PageHeader title="Закупки" />
        <Card className="px-5 py-8">
          <p className="text-ink-muted">Недостаточно прав</p>
          <p className="mt-1 text-sm text-ink-subtle">
            Для работы с закупками нужно право «Просмотр закупок».
          </p>
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const statusParam = firstValue(params.status);
  const status = statusParam in PURCHASE_ORDER_STATUS ? (statusParam as PurchaseOrderStatus) : undefined;

  const canEdit = can(user, 'procurement.edit');

  const [suggestions, orders] = await Promise.all([
    suggestPurchases(user.organizationId),
    listPurchaseOrders(user.organizationId, { status, take: 50 }),
  ]);

  const shortageLines = suggestions.reduce((acc, group) => acc + group.lines.length, 0);
  const shortageCost = suggestions.reduce((acc, group) => acc + group.totalCost, 0);
  const withoutSupplier = suggestions.filter((group) => !group.supplierId).length;
  const openOrders = orders.items.filter(
    (order) => order.status !== 'RECEIVED' && order.status !== 'CANCELLED',
  ).length;

  return (
    <>
      <PageHeader
        title="Закупки"
        description="Дефицит материалов и заказы поставщикам."
        action={
          canEdit ? <ProcurementAutoOrders disabled={suggestions.length === 0} /> : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Позиций в дефиците"
          value={formatQuantity(shortageLines)}
          tone={shortageLines > 0 ? 'warning' : 'positive'}
        />
        <StatCard label="Сумма закупки" value={formatMoneyShort(shortageCost)} />
        <StatCard
          label="Активных заказов поставщикам"
          value={formatQuantity(openOrders)}
          hint={`Всего заказов: ${orders.total}`}
        />
      </div>

      <section className="mt-6 space-y-4">
        <h2 className="text-lg font-medium text-ink">Дефицит</h2>

        {suggestions.length === 0 ? (
          <Card>
            <EmptyState
              title="Дефицита нет"
              description="Все позиции склада выше точки заказа."
            />
          </Card>
        ) : (
          suggestions.map((group) => (
            <Card key={group.supplierId ?? 'unknown'}>
              <CardHeader
                title={group.supplierName}
                description={`Позиций: ${group.lines.length}`}
                action={
                  <div className="text-right">
                    <p className="tabular font-medium">{formatMoney(group.totalCost)}</p>
                    {!group.supplierId ? (
                      <p className="mt-1 flex items-center gap-1 text-xs text-warning">
                        <AlertTriangle className="size-3.5" />
                        Поставщик не указан — заказ не создаётся автоматически
                      </p>
                    ) : null}
                  </div>
                }
              />
              <Table>
                <thead>
                  <tr>
                    <Th>Материал</Th>
                    <Th className="text-right">На складе</Th>
                    <Th className="text-right">Резерв</Th>
                    <Th className="text-right">Доступно</Th>
                    <Th className="text-right">К заказу</Th>
                    <Th className="text-right">Цена</Th>
                    <Th className="text-right">Сумма</Th>
                  </tr>
                </thead>
                <tbody>
                  {group.lines.map((line) => {
                    const unitLabel = UNIT[line.unit] ?? line.unit;
                    return (
                      <tr key={line.catalogItemId}>
                        <Td>
                          <p className="font-medium">{line.name}</p>
                        </Td>
                        <Td className="text-right tabular">{formatQuantity(line.onHand)}</Td>
                        <Td className="text-right tabular text-ink-muted">
                          {formatQuantity(line.reserved)}
                        </Td>
                        <Td
                          className={`text-right tabular ${line.available < 0 ? 'font-medium text-danger' : ''}`}
                        >
                          {formatQuantity(line.available)}
                        </Td>
                        <Td className="text-right tabular font-medium">
                          {formatQuantity(line.shortage)} {unitLabel}
                        </Td>
                        <Td className="text-right tabular">{formatMoney(line.unitCost)}</Td>
                        <Td className="text-right tabular">
                          {formatMoney(Math.round(line.unitCost * line.shortage))}
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            </Card>
          ))
        )}

        {withoutSupplier > 0 ? (
          <p className="text-xs text-ink-subtle">
            У части дефицитных позиций не указан поставщик — такие строки нужно заказать вручную.
          </p>
        ) : null}
      </section>

      <section className="mt-8">
        <Card>
          <CardHeader
            title="Заказы поставщикам"
            description={`Всего: ${orders.total}`}
            action={<ProcurementStatusFilter status={status ?? ''} />}
          />

          {orders.items.length === 0 ? (
            <EmptyState
              title="Заказов нет"
              description="Сформируйте заказы по дефициту или измените фильтр."
            />
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>Номер</Th>
                  <Th>Поставщик</Th>
                  <Th>Статус</Th>
                  <Th>Ожидается</Th>
                  <Th className="text-right">Позиций</Th>
                  <Th className="text-right">Сумма</Th>
                </tr>
              </thead>
              <tbody>
                {orders.items.map((order) => {
                  const badge = labelOf(PURCHASE_ORDER_STATUS, order.status);
                  return (
                    <tr key={order.id}>
                      <Td className="tabular font-medium">{order.number}</Td>
                      <Td>
                        <p>{order.supplier.name}</p>
                        <p className="text-xs text-ink-subtle">
                          Создан {formatDate(order.createdAt)}
                        </p>
                      </Td>
                      <Td>
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </Td>
                      <Td className="tabular text-ink-muted">{formatDate(order.expectedAt)}</Td>
                      <Td className="text-right tabular">{order.items.length}</Td>
                      <Td className="text-right tabular font-medium">{formatMoney(order.totalCost)}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card>

        <p className="mt-3 text-xs text-ink-subtle">
          Дефицит рассчитывается по резервам под подтверждённые заказы и точкам заказа склада —{' '}
          <Link href="/inventory?low=true" className="text-accent hover:underline">
            смотреть остатки
          </Link>
          .
        </p>
      </section>
    </>
  );
}
