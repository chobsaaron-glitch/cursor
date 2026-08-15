import 'dotenv/config';
import { prisma } from '@/server/db';
import { formatMoney, formatSize } from '@/lib/format';

const order = await prisma.customerOrder.findFirstOrThrow({
  where: { commercialStatus: 'CONFIRMED' },
  include: { customer: true, workItems: { include: { components: true } } },
});

console.log(
  `Заказ №${order.number}  ${order.customer.lastName}  итого ${formatMoney(order.total)}  оплачено ${formatMoney(order.paidTotal)}  долг ${formatMoney(order.balance)}`,
);
for (const item of order.workItems) {
  console.log(
    ` ${item.number} ${item.title} ${formatSize(item.widthMm, item.heightMm)} цена ${formatMoney(item.price)} себест. ${formatMoney(item.totalCost)} маржа ${item.marginPercent}%`,
  );
  for (const c of item.components) {
    console.log(
      `   ${c.group.padEnd(10)} ${c.name.slice(0, 40).padEnd(42)} ${String(c.quantity).padStart(8)} ${c.unit.padEnd(6)} цена ${formatMoney(c.price).padStart(12)} себест ${formatMoney(c.cost).padStart(12)}`,
    );
  }
}

await prisma.$disconnect();
