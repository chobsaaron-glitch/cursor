import { z } from 'zod';
import { route } from '@/server/api/handler';
import { customerInputSchema } from '@/server/api/schemas';
import { createCustomer, listCustomers } from '@/server/modules/customers/service';

const querySchema = z.object({
  q: z.string().max(200).optional(),
  type: z.enum(['PERSON', 'ENTREPRENEUR', 'COMPANY']).optional(),
  sourceId: z.string().optional(),
  managerId: z.string().optional(),
  segment: z.string().optional(),
  withDebtOnly: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const GET = route(
  { permission: 'customers.view', query: querySchema },
  async ({ context, query }) =>
    listCustomers(context.user.organizationId, {
      ...query,
      withDebtOnly: query.withDebtOnly === 'true',
    }),
);

export const POST = route(
  { permission: 'customers.create', body: customerInputSchema },
  async ({ context, body }) =>
    createCustomer(context, { ...body, email: body.email || null }),
);
