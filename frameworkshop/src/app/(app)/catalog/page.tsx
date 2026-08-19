import { Badge, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { CatalogFilters } from '@/components/catalog-filters';
import { formatMoney, formatQuantity } from '@/lib/format';
import { CATALOG_GROUP, UNIT } from '@/lib/statuses';
import { can, currentUser } from '@/server/auth/current-user';
import { searchCatalog } from '@/server/modules/catalog/service';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

const CATALOG_GROUPS = [
  'MOULDING',
  'MATBOARD',
  'GLAZING',
  'BACKING',
  'MOUNTING',
  'FABRIC',
  'HARDWARE',
  'FITTING',
  'SUBFRAME',
  'EXTRA',
  'LABOUR',
  'SUPPLY',
  'PRINT',
  'SERVICE',
] as const;

/** Smallest positive quantity the service keeps after rounding to 4 decimals. */
const MIN_IN_STOCK = 0.0001;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function parseGroup(value: string) {
  return CATALOG_GROUPS.find((group) => group === value);
}

export default async function CatalogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const params = await searchParams;

  const q = first(params.q);
  const group = parseGroup(first(params.group));
  const inStockOnly = first(params.stock) === 'true';
  const showCost = can(user, 'orders.view_cost');

  if (!can(user, 'catalog.view')) {
    return (
      <>
        <PageHeader title="Каталог" />
        <Card>
          <EmptyState
            title="Недостаточно прав"
            description="У вашей роли нет доступа к каталогу материалов."
          />
        </Card>
      </>
    );
  }

  const { items, total } = await searchCatalog(user.organizationId, {
    q: q || undefined,
    group,
    minAvailable: inStockOnly ? MIN_IN_STOCK : undefined,
    take: PAGE_SIZE,
    orderBy: 'name',
  });

  // The stock filter runs after the page is fetched, so only the rows shown can
  // be counted honestly in that view.
  const found = inStockOnly ? items.length : total;

  return (
    <>
      <PageHeader
        title="Каталог"
        description={`Найдено: ${found}${!inStockOnly && total > items.length ? `, показаны первые ${items.length}` : ''}`}
      />

      <Card>
        <CatalogFilters q={q} group={group ?? ''} inStockOnly={inStockOnly} />

        {items.length === 0 ? (
          <EmptyState
            title="Позиции не найдены"
            description="Измените запрос, выберите другую группу или снимите фильтр по наличию."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Артикул</Th>
                <Th>Наименование</Th>
                <Th>Группа</Th>
                <Th>Цвет / материал</Th>
                <Th>Поставщик</Th>
                {showCost ? <Th className="text-right">Себестоимость</Th> : null}
                <Th className="text-right">Цена</Th>
                <Th className="text-right">Остаток</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const unit = UNIT[item.unit] ?? item.unit;
                const available = item.stock.available;
                const stockTone =
                  available <= 0 ? 'danger' : available <= item.stock.minQuantity ? 'warning' : 'neutral';

                return (
                  <tr key={item.id} className="hover:bg-surface-muted">
                    <Td className="tabular whitespace-nowrap">
                      <span className="font-medium">{item.internalSku}</span>
                      {item.supplierSku ? (
                        <span className="block text-xs text-ink-subtle">{item.supplierSku}</span>
                      ) : null}
                    </Td>
                    <Td>
                      <span className="font-medium">{item.name}</span>
                      {item.collection || item.manufacturer ? (
                        <span className="block text-xs text-ink-subtle">
                          {[item.manufacturer, item.collection].filter(Boolean).join(' · ')}
                        </span>
                      ) : null}
                    </Td>
                    <Td>
                      <Badge>{CATALOG_GROUP[item.group] ?? item.group}</Badge>
                    </Td>
                    <Td className="text-ink-muted">
                      {[item.color, item.material].filter(Boolean).join(' / ') || '—'}
                    </Td>
                    <Td className="text-ink-muted">{item.supplier?.name ?? '—'}</Td>
                    {showCost ? (
                      <Td className="tabular text-right">{formatMoney(item.costPrice)}</Td>
                    ) : null}
                    <Td className="tabular text-right">
                      {item.retailPrice !== null ? (
                        formatMoney(item.retailPrice)
                      ) : (
                        <span
                          className="text-xs text-ink-subtle"
                          title={item.priceRule?.name ?? undefined}
                        >
                          по правилу
                        </span>
                      )}
                    </Td>
                    <Td className="text-right">
                      {item.trackInventory ? (
                        <>
                          <Badge tone={stockTone} className="tabular">
                            {formatQuantity(available)} {unit}
                          </Badge>
                          {item.stock.reserved > 0 ? (
                            <span className="mt-1 block tabular text-xs text-ink-subtle">
                              резерв {formatQuantity(item.stock.reserved)}
                            </span>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-ink-subtle">не складская</span>
                      )}
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
