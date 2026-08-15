import Link from 'next/link';
import { ChevronRight, Plus } from 'lucide-react';
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td, Th } from '@/components/ui';
import { CustomersFilters } from '@/components/customers-filters';
import { CustomerTypeBadge } from '@/components/customers-type-badge';
import { formatCustomerName, formatDate, formatMoney, formatPhone } from '@/lib/format';
import { can, currentUser } from '@/server/auth/current-user';
import { listCustomers } from '@/server/modules/customers/service';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

const CUSTOMER_TYPES = ['PERSON', 'ENTREPRENEUR', 'COMPANY'] as const;

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

function parseType(value: string) {
  return CUSTOMER_TYPES.find((type) => type === value);
}

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const params = await searchParams;

  const q = first(params.q);
  const type = parseType(first(params.type));
  const withDebtOnly = first(params.debt) === 'true';

  if (!can(user, 'customers.view')) {
    return (
      <>
        <PageHeader title="Клиенты" />
        <Card>
          <EmptyState
            title="Недостаточно прав"
            description="У вашей роли нет доступа к базе клиентов."
          />
        </Card>
      </>
    );
  }

  const { items, total } = await listCustomers(user.organizationId, {
    q: q || undefined,
    type,
    withDebtOnly,
    take: PAGE_SIZE,
  });

  // The debt filter is applied after the page is fetched, so the honest count
  // for that view is the number of rows actually shown.
  const found = withDebtOnly ? items.length : total;

  return (
    <>
      <PageHeader
        title="Клиенты"
        description={`Найдено: ${found}${!withDebtOnly && total > items.length ? `, показаны первые ${items.length}` : ''}`}
        action={
          can(user, 'customers.create') ? (
            <Link href="/customers/new">
              <Button>
                <Plus className="size-4" />
                Новый клиент
              </Button>
            </Link>
          ) : null
        }
      />

      <Card>
        <CustomersFilters q={q} type={type ?? ''} withDebtOnly={withDebtOnly} />

        {items.length === 0 ? (
          <EmptyState
            title="Клиенты не найдены"
            description="Измените условия поиска или добавьте нового клиента."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>Номер</Th>
                <Th>Клиент</Th>
                <Th>Телефон</Th>
                <Th className="text-right">Заказов</Th>
                <Th className="text-right">Сумма</Th>
                <Th className="text-right">Долг</Th>
                <Th>Последний заказ</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {items.map((customer) => {
                const personName = [customer.lastName, customer.firstName, customer.middleName]
                  .filter(Boolean)
                  .join(' ');
                const secondary = customer.companyName ? personName : null;

                return (
                  <tr key={customer.id} className="hover:bg-surface-muted">
                    <Td className="tabular whitespace-nowrap">
                      <Link href={`/customers/${customer.id}`} className="text-accent hover:underline">
                        {customer.number}
                      </Link>
                    </Td>
                    <Td>
                      <Link href={`/customers/${customer.id}`} className="block">
                        <span className="flex items-center gap-2">
                          <span className="font-medium">{formatCustomerName(customer)}</span>
                          <CustomerTypeBadge type={customer.type} />
                        </span>
                        {secondary ? (
                          <span className="mt-0.5 block text-xs text-ink-subtle">{secondary}</span>
                        ) : null}
                      </Link>
                    </Td>
                    <Td className="tabular whitespace-nowrap text-ink-muted">
                      {formatPhone(customer.phone)}
                    </Td>
                    <Td className="tabular text-right">{customer.stats.orderCount}</Td>
                    <Td className="tabular text-right">{formatMoney(customer.stats.revenue)}</Td>
                    <Td className="text-right">
                      {customer.stats.debt > 0 ? (
                        <Badge tone="danger" className="tabular">
                          {formatMoney(customer.stats.debt)}
                        </Badge>
                      ) : (
                        <span className="text-ink-subtle">—</span>
                      )}
                    </Td>
                    <Td className="tabular whitespace-nowrap text-ink-muted">
                      {formatDate(customer.stats.lastOrderAt)}
                    </Td>
                    <Td>
                      <Link
                        href={`/customers/${customer.id}`}
                        aria-label={`Открыть карточку клиента ${customer.number}`}
                        className="text-ink-subtle hover:text-ink"
                      >
                        <ChevronRight className="size-4" />
                      </Link>
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
