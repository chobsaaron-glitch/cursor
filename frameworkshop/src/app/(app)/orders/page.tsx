import Link from 'next/link';
import { Plus } from 'lucide-react';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  PageHeader,
  Table,
  Td,
  Th,
} from '@/components/ui';
import { OrdersFilters } from '@/components/orders-filters';
import { can, currentUser } from '@/server/auth/current-user';
import { listOrders } from '@/server/modules/orders/service';
import { formatCustomerName, formatDate, formatMoney, formatPhone } from '@/lib/format';
import {
  COMMERCIAL_STATUS,
  PAYMENT_STATUS,
  PRODUCTION_STATUS,
  labelOf,
} from '@/lib/statuses';
import type { CommercialStatus, OrderProductionStatus } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  const params = await searchParams;
  const single = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const { items, total } = await listOrders(user.organizationId, {
    q: single('q'),
    commercialStatus: single('commercialStatus') as CommercialStatus | undefined,
    productionStatus: single('productionStatus') as OrderProductionStatus | undefined,
    paymentStatus: single('paymentStatus'),
    overdueOnly: single('overdueOnly') === 'true',
    take: 50,
  });

  const now = Date.now();

  return (
    <>
      <PageHeader
        title="Заказы"
        description={`Найдено заказов: ${total}`}
        action={
          can(user, 'orders.create') ? (
            <Link href="/orders/new">
              <Button>
                <Plus className="size-4" />
                Новый заказ
              </Button>
            </Link>
          ) : null
        }
      />

      <OrdersFilters />

      <Card>
        {items.length === 0 ? (
          <EmptyState
            title="Заказы не найдены"
            description="Измените условия поиска или создайте новый заказ."
          />
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>№</Th>
                <Th>Дата</Th>
                <Th>Клиент</Th>
                <Th>Изделия</Th>
                <Th>Срок</Th>
                <Th>Статус</Th>
                <Th>Производство</Th>
                <Th>Оплата</Th>
                <Th className="text-right">Сумма</Th>
                <Th className="text-right">Долг</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((order) => {
                const commercial = labelOf(COMMERCIAL_STATUS, order.commercialStatus);
                const production = labelOf(PRODUCTION_STATUS, order.productionStatus);
                const payment = labelOf(PAYMENT_STATUS, order.paymentStatus);
                const overdue =
                  order.dueDate != null &&
                  order.dueDate.getTime() < now &&
                  !['READY', 'ISSUED'].includes(order.productionStatus);

                return (
                  <tr key={order.id} className="hover:bg-surface-muted">
                    <Td>
                      <Link
                        href={`/orders/${order.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {order.number}
                      </Link>
                    </Td>
                    <Td className="whitespace-nowrap text-ink-muted">
                      {formatDate(order.createdAt)}
                    </Td>
                    <Td>
                      <p className="font-medium">{formatCustomerName(order.customer)}</p>
                      <p className="text-xs text-ink-subtle">
                        {formatPhone(order.customer.phone)}
                      </p>
                    </Td>
                    <Td>
                      <p>{order.workItems.length} шт.</p>
                      <p className="max-w-56 truncate text-xs text-ink-subtle">
                        {order.workItems.map((item) => item.title).join(', ')}
                      </p>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <span className={overdue ? 'font-medium text-danger' : 'text-ink-muted'}>
                        {formatDate(order.dueDate)}
                      </span>
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
                    <Td className="text-right whitespace-nowrap tabular">
                      {formatMoney(order.total)}
                    </Td>
                    <Td className="text-right whitespace-nowrap tabular">
                      {order.balance > 0 ? (
                        <span className="text-danger">{formatMoney(order.balance)}</span>
                      ) : (
                        <span className="text-ink-subtle">—</span>
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
