import { route } from '@/server/api/handler';
import { addWorkItemSchema, workItemStatusSchema } from '@/server/api/schemas';
import {
  changeWorkItemStatus,
  getWorkItem,
  updateWorkItem,
} from '@/server/modules/orders/service';
import type { FramingSpec } from '@/server/modules/framing/types';

export const GET = route({ permission: 'orders.view' }, async ({ context, params }) =>
  getWorkItem(context.user.organizationId, params.id),
);

export const PATCH = route(
  {
    permission: 'orders.edit',
    body: addWorkItemSchema.omit({ orderId: true }).partial(),
  },
  async ({ context, body, params }) =>
    updateWorkItem(context, params.id, {
      ...body,
      spec: body.spec as FramingSpec | undefined,
    }),
);

export const POST = route(
  { permission: 'orders.edit', body: workItemStatusSchema },
  async ({ context, body, params }) =>
    changeWorkItemStatus(context, params.id, body.status, body.note),
);
