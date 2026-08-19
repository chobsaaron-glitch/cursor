import { notFound } from 'next/navigation';
import { PageHeader } from '@/components/ui';
import { WorkItemConstructor, type CatalogOption, type SpecTemplate } from '@/components/work-item-constructor';
import { can, currentUser } from '@/server/auth/current-user';
import { prisma } from '@/server/db';
import { getOrder } from '@/server/modules/orders/service';
import { formatCustomerName } from '@/lib/format';
import type { CatalogGroup } from '@/generated/prisma/client';

export const dynamic = 'force-dynamic';

/** Groups the constructor offers a choice from. */
const GROUPS: CatalogGroup[] = [
  'MOULDING',
  'MATBOARD',
  'GLAZING',
  'BACKING',
  'MOUNTING',
  'SUBFRAME',
  'HARDWARE',
  'EXTRA',
  'SERVICE',
];

export default async function NewWorkItemPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  const { id } = await params;

  const order = await getOrder(user.organizationId, id).catch(() => null);
  if (!order) notFound();

  const [items, templates] = await Promise.all([
    prisma.catalogItem.findMany({
      where: { organizationId: user.organizationId, isActive: true, group: { in: GROUPS } },
      orderBy: [{ group: 'asc' }, { name: 'asc' }],
      select: {
        id: true,
        group: true,
        name: true,
        internalSku: true,
        unit: true,
        color: true,
        material: true,
        costPrice: true,
        moulding: { select: { widthMm: true } },
        inventoryItems: { select: { quantityOnHand: true, quantityReserved: true } },
      },
    }),
    prisma.frameTemplate.findMany({
      where: { organizationId: user.organizationId },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, description: true, workType: true, payload: true },
    }),
  ]);

  // Availability is summed across branches: the constructor only needs to warn
  // that stock is thin, the reservation step does the authoritative check.
  const options: CatalogOption[] = items.map((item) => ({
    id: item.id,
    group: item.group,
    name: item.name,
    sku: item.internalSku,
    unit: item.unit,
    color: item.color,
    material: item.material,
    widthMm: item.moulding?.widthMm ?? null,
    costPrice: can(user, 'orders.view_cost') ? item.costPrice : null,
    available: item.inventoryItems.reduce(
      (acc, stock) => acc + stock.quantityOnHand - stock.quantityReserved,
      0,
    ),
  }));

  const specTemplates: SpecTemplate[] = templates.map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    workType: template.workType,
    payload: template.payload as SpecTemplate['payload'],
  }));

  return (
    <>
      <PageHeader
        title="Новое изделие"
        description={`Заказ №${order.number} · ${formatCustomerName(order.customer)}`}
      />
      <WorkItemConstructor
        orderId={order.id}
        options={options}
        templates={specTemplates}
        canSeeCost={can(user, 'orders.view_cost')}
        maxDiscountPercent={
          can(user, 'orders.discount') ? user.maxDiscountPercent : 0
        }
      />
    </>
  );
}
