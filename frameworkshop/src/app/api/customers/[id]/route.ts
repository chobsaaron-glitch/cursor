import { route } from '@/server/api/handler';
import { customerInputSchema } from '@/server/api/schemas';
import { getCustomer, updateCustomer } from '@/server/modules/customers/service';

export const GET = route({ permission: 'customers.view' }, async ({ context, params }) =>
  getCustomer(context.user.organizationId, params.id),
);

export const PATCH = route(
  { permission: 'customers.edit', body: customerInputSchema.partial() },
  async ({ context, body, params }) => updateCustomer(context, params.id, body),
);
