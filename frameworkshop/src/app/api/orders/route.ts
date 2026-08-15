import { z } from 'zod';
import { route } from '@/server/api/handler';
import { createOrderSchema } from '@/server/api/schemas';
import { createOrder, listOrders } from '@/server/modules/orders/service';

const querySchema = z.object({
  q: z.string().max(200).optional(),
  customerId: z.string().optional(),
  commercialStatus: z.string().optional(),
  productionStatus: z.string().optional(),
  paymentStatus: z.string().optional(),
  overdue: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const GET = route(
  { permission: 'orders.view', query: querySchema },
  async ({ context, query }) =>
    listOrders(context.user.organizationId, {
      ...query,
      overdue: query.overdue === 'true',
    } as Parameters<typeof listOrders>[1]),
);

export const POST = route(
  { permission: 'orders.create', body: createOrderSchema },
  async ({ context, body }) => createOrder(context, body),
);
