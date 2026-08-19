import { AccessDenied, PageHeader } from '@/components/ui';
import { OrdersNewForm } from '@/components/orders-new-form';
import { can, currentUser } from '@/server/auth/current-user';
import { listCustomers } from '@/server/modules/customers/service';

export const dynamic = 'force-dynamic';

/**
 * The receptionist usually knows the customer by phone or surname, so the whole
 * customer list is handed to the client once and filtered locally — no round
 * trip per keystroke.
 */
const CUSTOMER_LIMIT = 200;

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!can(user, 'orders.create')) {
    return <AccessDenied title="Новый заказ" description="Создание заказов недоступно вашей роли." />;
  }

  const params = await searchParams;
  const preselected = Array.isArray(params.customerId) ? params.customerId[0] : params.customerId;

  const { items } = await listCustomers(user.organizationId, { take: CUSTOMER_LIMIT });

  const customers = items.map((customer) => ({
    id: customer.id,
    number: customer.number,
    lastName: customer.lastName,
    firstName: customer.firstName,
    companyName: customer.companyName,
    phone: customer.phone,
  }));

  return (
    <>
      <PageHeader
        title="Новый заказ"
        description="Выберите клиента и параметры — сразу после создания откроется конструктор изделия."
      />
      <OrdersNewForm customers={customers} initialCustomerId={preselected ?? ''} />
    </>
  );
}
