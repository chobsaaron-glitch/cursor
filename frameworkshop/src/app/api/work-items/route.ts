import { route } from '@/server/api/handler';
import { addWorkItemSchema } from '@/server/api/schemas';
import { addWorkItem } from '@/server/modules/orders/service';
import type { FramingSpec } from '@/server/modules/framing/types';

export const POST = route(
  { permission: 'orders.edit', body: addWorkItemSchema },
  async ({ context, body }) =>
    addWorkItem(context, { ...body, spec: body.spec as FramingSpec }),
);
