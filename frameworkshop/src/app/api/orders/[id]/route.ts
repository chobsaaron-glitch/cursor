import { z } from 'zod';
import { route } from '@/server/api/handler';
import {
  cancelOrder,
  closeOrder,
  confirmOrder,
  getOrder,
  issueOrder,
} from '@/server/modules/orders/service';

const actionSchema = z.object({
  action: z.enum(['confirm', 'cancel', 'issue', 'close']),
  reason: z.string().max(500).optional(),
});

export const GET = route({ permission: 'orders.view' }, async ({ context, params }) =>
  getOrder(context.user.organizationId, params.id),
);

/**
 * Lifecycle transitions are exposed as named actions rather than as a writable
 * status field, so the service can enforce its own rules (reservations, quality
 * gates, outstanding balance) instead of trusting the caller.
 */
export const POST = route(
  { permission: 'orders.edit', body: actionSchema },
  async ({ context, body, params }) => {
    switch (body.action) {
      case 'confirm':
        return confirmOrder(context, params.id);
      case 'cancel':
        return cancelOrder(context, params.id, body.reason ?? 'Без указания причины');
      case 'issue':
        return issueOrder(context, params.id);
      case 'close':
        return closeOrder(context, params.id);
    }
  },
);
