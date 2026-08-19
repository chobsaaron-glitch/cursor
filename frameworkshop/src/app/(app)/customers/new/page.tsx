import { AccessDenied, PageHeader } from '@/components/ui';
import { CustomersNewForm } from '@/components/customers-new-form';
import { can, currentUser } from '@/server/auth/current-user';
import { prisma } from '@/server/db';

export const dynamic = 'force-dynamic';

export default async function NewCustomerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await currentUser();
  if (!can(user, 'customers.create')) {
    return <AccessDenied title="Новый клиент" description="Создание клиентов недоступно вашей роли." />;
  }

  const params = await searchParams;
  const nextRaw = Array.isArray(params.next) ? params.next[0] : params.next;
  const next = nextRaw && nextRaw.startsWith('/') && !nextRaw.startsWith('//') ? nextRaw : undefined;

  const sources = await prisma.customerSource.findMany({
    where: { organizationId: user.organizationId, isActive: true },
    orderBy: { name: 'asc' },
    select: { id: true, name: true },
  });

  return (
    <>
      <PageHeader
        title="Новый клиент"
        description="Телефон обязателен — по нему клиент находится в поиске и связывается с заказами."
      />
      <CustomersNewForm sources={sources} next={next} />
    </>
  );
}
