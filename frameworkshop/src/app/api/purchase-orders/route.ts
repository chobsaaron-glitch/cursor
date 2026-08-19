import { z } from 'zod';
import { route } from '@/server/api/handler';
import {
  createPurchaseOrdersFromShortages,
  listPurchaseOrders,
  receivePurchaseOrder,
  setPurchaseOrderStatus,
  suggestPurchases,
} from '@/server/modules/procurement/service';

const querySchema = z.object({
  status: z.string().optional(),
  supplierId: z.string().optional(),
  suggestions: z.enum(['true', 'false']).optional(),
});

export const GET = route(
  { permission: 'procurement.view', query: querySchema },
  async ({ context, query }) => {
    if (query.suggestions === 'true') return suggestPurchases(context.user.organizationId);
    return listPurchaseOrders(
      context.user.organizationId,
      query as Parameters<typeof listPurchaseOrders>[1],
    );
  },
);

const mutationSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('auto') }),
  z.object({
    action: z.literal('status'),
    purchaseOrderId: z.string().min(1),
    status: z.enum([
      'DRAFT',
      'SENT',
      'CONFIRMED',
      'PARTIALLY_RECEIVED',
      'RECEIVED',
      'CANCELLED',
    ]),
  }),
  z.object({
    action: z.literal('receive'),
    purchaseOrderId: z.string().min(1),
    lines: z.array(
      z.object({
        itemId: z.string().min(1),
        quantity: z.number().min(0),
        unitCost: z.number().int().min(0).optional(),
      }),
    ),
  }),
]);

export const POST = route(
  { permission: 'procurement.edit', body: mutationSchema },
  async ({ context, body }) => {
    switch (body.action) {
      case 'auto':
        return createPurchaseOrdersFromShortages(context);
      case 'status':
        return setPurchaseOrderStatus(context, body.purchaseOrderId, body.status);
      case 'receive':
        return receivePurchaseOrder(context, {
          purchaseOrderId: body.purchaseOrderId,
          lines: body.lines,
        });
    }
  },
);
