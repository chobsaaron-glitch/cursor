import { z } from 'zod';
import { route } from '@/server/api/handler';
import { catalogSearchSchema } from '@/server/api/schemas';
import { createCatalogItem, searchCatalog } from '@/server/modules/catalog/service';
import { catalogGroupSchema } from '@/server/api/schemas';

const createSchema = z.object({
  group: catalogGroupSchema,
  internalSku: z.string().min(1).max(60),
  name: z.string().min(1).max(200),
  unit: z.string().min(1),
  supplierId: z.string().optional().nullable(),
  supplierSku: z.string().max(60).optional().nullable(),
  barcode: z.string().max(60).optional().nullable(),
  color: z.string().max(60).optional().nullable(),
  material: z.string().max(60).optional().nullable(),
  costPrice: z.number().int().min(0).optional(),
  retailPrice: z.number().int().min(0).optional().nullable(),
  priceRuleId: z.string().optional().nullable(),
  taxRateId: z.string().optional().nullable(),
  wasteFactor: z.number().min(0).max(1).optional(),
  minCharge: z.number().int().min(0).optional().nullable(),
  trackInventory: z.boolean().optional(),
});

export const GET = route(
  { permission: 'catalog.view', query: catalogSearchSchema },
  async ({ context, query }) =>
    searchCatalog(context.user.organizationId, {
      ...query,
      onlyActive: query.onlyActive !== 'false',
    }),
);

export const POST = route(
  { permission: 'catalog.edit', body: createSchema },
  async ({ context, body }) =>
    createCatalogItem(context, body as Parameters<typeof createCatalogItem>[1]),
);
