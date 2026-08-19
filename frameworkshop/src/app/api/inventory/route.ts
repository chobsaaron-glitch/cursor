import { z } from 'zod';
import { route } from '@/server/api/handler';
import {
  adjustStock,
  collectShortages,
  listStock,
  receiveStock,
  writeOffStock,
} from '@/server/modules/inventory/service';
import { prisma } from '@/server/db';
import { catalogGroupSchema } from '@/server/api/schemas';

const querySchema = z.object({
  q: z.string().max(200).optional(),
  group: catalogGroupSchema.optional(),
  lowStockOnly: z.enum(['true', 'false']).optional(),
  shortages: z.enum(['true', 'false']).optional(),
  take: z.coerce.number().int().min(1).max(500).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const GET = route(
  { permission: 'inventory.view', query: querySchema },
  async ({ context, query }) => {
    if (query.shortages === 'true') {
      return collectShortages(context.user.organizationId);
    }
    return listStock(context.user.organizationId, {
      ...query,
      lowStockOnly: query.lowStockOnly === 'true',
    });
  },
);

const mutationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('receive'),
    catalogItemId: z.string().min(1),
    quantity: z.number().positive(),
    unitCost: z.number().int().min(0).optional(),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('adjust'),
    catalogItemId: z.string().min(1),
    newQuantity: z.number().min(0),
    note: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal('writeoff'),
    catalogItemId: z.string().min(1),
    quantity: z.number().positive(),
    reason: z.string().min(1, 'Укажите причину списания').max(500),
  }),
]);

export const POST = route(
  { permission: ['inventory.adjust', 'inventory.writeoff'], body: mutationSchema },
  async ({ context, body }) => {
    switch (body.action) {
      case 'receive':
        return receiveStock(prisma, context, {
          catalogItemId: body.catalogItemId,
          quantity: body.quantity,
          unitCost: body.unitCost,
          branchId: context.user.branchId,
          note: body.note,
          refType: 'Manual',
        });
      case 'adjust':
        return adjustStock(context, {
          catalogItemId: body.catalogItemId,
          branchId: context.user.branchId,
          newQuantity: body.newQuantity,
          note: body.note,
        });
      case 'writeoff':
        return writeOffStock(context, {
          catalogItemId: body.catalogItemId,
          branchId: context.user.branchId,
          quantity: body.quantity,
          reason: body.reason,
        });
    }
  },
);
