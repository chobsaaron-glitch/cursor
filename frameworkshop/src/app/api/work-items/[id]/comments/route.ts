import { route } from '@/server/api/handler';
import { workItemCommentSchema } from '@/server/api/schemas';
import { addWorkItemComment } from '@/server/modules/orders/service';

export const POST = route(
  { permission: 'orders.edit', body: workItemCommentSchema },
  async ({ context, body, params }) => addWorkItemComment(context, params.id, body.body),
);
