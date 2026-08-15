import { z } from 'zod';
import { route } from '@/server/api/handler';
import { framingSpecSchema } from '@/server/api/schemas';
import { prisma } from '@/server/db';
import { hasPermission } from '@/server/auth/permissions';
import { calculateWorkItem, profitability } from '@/server/modules/orders/calculator';
import type { FramingSpec } from '@/server/modules/framing/types';

const schema = z.object({
  spec: framingSpecSchema,
  quantity: z.number().int().min(1).max(999).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
});

/**
 * Live preview for the order constructor: runs the real geometry and pricing
 * engines without persisting anything, so the number on screen is always the
 * number that will be saved.
 */
export const POST = route(
  { permission: 'orders.view', body: schema },
  async ({ context, body }) => {
    const result = await calculateWorkItem(
      prisma,
      context.user.organizationId,
      body.spec as FramingSpec,
      { quantity: body.quantity ?? 1, discountPercent: body.discountPercent ?? 0 },
    );

    // Cost and margin are commercially sensitive: a receptionist sees the price
    // the customer pays, nothing else.
    if (!hasPermission(context.user.permissions, 'orders.view_cost')) {
      return {
        calculation: result.calculation,
        components: result.components.map(({ unitCost, cost, ...rest }) => rest),
        totals: {
          subtotal: result.totals.subtotal,
          discountAmount: result.totals.discountAmount,
          taxAmount: result.totals.taxAmount,
          price: result.totals.price,
        },
      };
    }

    return { ...result, profitability: profitability(result.totals) };
  },
);
