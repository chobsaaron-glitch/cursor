import { Card, EmptyState, PageHeader, StatCard, Table, Td, Th, cn } from '@/components/ui';
import { InventoryFilters } from '@/components/inventory-filters';
import { InventoryStockActions } from '@/components/inventory-stock-actions';
import { formatMoney, formatMoneyShort, formatQuantity } from '@/lib/format';
import { CATALOG_GROUP, UNIT } from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import { listStock } from '@/server/modules/inventory/service';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 200;

function firstValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? '';
  return value ?? '';
}

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();

  if (!can(user, 'inventory.view')) {
    return (
      <>
        <PageHeader title="Склад" />
        <Card className="px-5 py-8">
          <p className="text-ink-muted">Недостаточно прав</p>
          <p className="mt-1 text-sm text-ink-subtle">
            Для просмотра складских остатков нужно право «Просмотр склада».
          </p>
        </Card>
      </>
    );
  }

  const params = await searchParams;
  const q = firstValue(params.q);
  const groupParam = firstValue(params.group);
  const group = groupParam in CATALOG_GROUP ? groupParam : '';
  const lowStockOnly = firstValue(params.low) === 'true';

  const showCost = can(user, 'orders.view_cost');
  const canAdjust = can(user, 'inventory.adjust');
  const canWriteOff = can(user, 'inventory.writeoff');
  const showActions = canAdjust || canWriteOff;

  const rows = await listStock(user.organizationId, {
    q: q || undefined,
    group: group || undefined,
    lowStockOnly,
    take: PAGE_SIZE,
  });

  const totalValue = rows.reduce((acc, row) => acc + row.value, 0);
  const lowCount = rows.filter((row) => row.isLow).length;
  const filtered = Boolean(q || group || lowStockOnly);

  return (
    <>
      <PageHeader
        title="Склад"
        description="Остатки материалов, резервы под заказы и стоимость запаса."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Позиций"
          value={formatQuantity(rows.length)}
          hint={filtered ? 'С учётом фильтров' : 'Все складские позиции'}
        />
        <StatCard label="Стоимость запаса" value={formatMoneyShort(totalValue)} />
        <StatCard
          label="Позиций в дефиците"
          value={formatQuantity(lowCount)}
          tone={lowCount > 0 ? 'warning' : 'positive'}
          hint="Доступный остаток ниже точки заказа"
        />
      </div>

      <Card className="mt-6">
        <div className="border-b border-line px-5 py-4">
          <InventoryFilters q={q} group={group} lowStockOnly={lowStockOnly} />
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Ничего не найдено"
            description="Измените условия поиска или сбросьте фильтры."
          />
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
                {showCost ? <Th className="text-right">Средняя себестоимость</Th> : null}
                <Th className="text-right">Стоимость запаса</Th>
                <Th className="text-right">Точка заказа</Th>
                {showActions ? <Th className="text-right">Действия</Th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const unitLabel = UNIT[row.catalogItem.unit] ?? row.catalogItem.unit;
                return (
                  <tr key={row.id} className={cn(row.isLow && 'bg-warning-soft/50')}>
                    <Td className="tabular text-ink-muted">{row.catalogItem.internalSku}</Td>
                    <Td>
                      <p className="font-medium">{row.catalogItem.name}</p>
                      {row.catalogItem.supplier ? (
                        <p className="text-xs text-ink-subtle">{row.catalogItem.supplier.name}</p>
                      ) : null}
                    </Td>
                    <Td className="text-ink-muted">
                      {CATALOG_GROUP[row.catalogItem.group] ?? row.catalogItem.group}
                    </Td>
                    <Td className="text-right tabular">
                      {formatQuantity(row.quantityOnHand)} {unitLabel}
                    </Td>
                    <Td className="text-right tabular text-ink-muted">
                      {formatQuantity(row.quantityReserved)}
                    </Td>
                    <Td
                      className={cn(
                        'text-right tabular',
                        row.available <= 0 ? 'font-medium text-danger' : row.isLow ? 'font-medium text-warning' : '',
                      )}
                    >
                      {formatQuantity(row.available)}
                    </Td>
                    {showCost ? (
                      <Td className="text-right tabular">{formatMoney(row.avgCost)}</Td>
                    ) : null}
                    <Td className="text-right tabular">{formatMoney(row.value)}</Td>
                    <Td className="text-right tabular text-ink-muted">
                      {formatQuantity(row.reorderPoint)}
                    </Td>
                    {showActions ? (
                      <Td>
                        <InventoryStockActions
                          catalogItemId={row.catalogItemId}
                          name={row.catalogItem.name}
                          unitLabel={unitLabel}
                          quantityOnHand={row.quantityOnHand}
                          canAdjust={canAdjust}
                          canWriteOff={canWriteOff}
                        />
                      </Td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}

        {rows.length >= PAGE_SIZE ? (
          <p className="px-5 py-3 text-xs text-ink-subtle">
            Показаны первые {PAGE_SIZE} позиций — уточните поиск, чтобы увидеть остальные.
          </p>
        ) : null}
      </Card>
    </>
  );
}
