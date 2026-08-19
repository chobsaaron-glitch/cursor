import { z } from 'zod';
import { route } from '@/server/api/handler';
import { recordPaymentSchema } from '@/server/api/schemas';
import { listPayments, recordPayment } from '@/server/modules/payments/service';

const querySchema = z.object({
  orderId: z.string().optional(),
  customerId: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
});

export const GET = route(
  { permission: 'payments.view', query: querySchema },
  async ({ context, query }) => listPayments(context.user.organizationId, query),
);

export const POST = route(
  { permission: 'payments.create', body: recordPaymentSchema },
  async ({ context, body }) =>
    recordPayment(context, body as Parameters<typeof recordPayment>[1]),
);
