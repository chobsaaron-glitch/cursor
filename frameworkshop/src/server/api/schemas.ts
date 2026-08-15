/**
 * Zod schemas for API input. The framing spec is the largest one: it is the
 * contract between the order constructor in the browser and the calculation
 * engine on the server, so it is validated in one place and reused everywhere.
 */

import { z } from 'zod';

const mm = z.number().min(0).max(10_000);

export const marginsSchema = z.object({
  leftMm: mm,
  rightMm: mm,
  topMm: mm,
  bottomMm: mm,
});

export const matLayerSchema = z.object({
  layer: z.number().int().min(1).max(7),
  catalogItemId: z.string().min(1),
  margins: marginsSchema.optional(),
  revealMm: z.number().min(0).max(200).optional(),
  overlapMm: z.number().min(0).max(100).optional(),
  shape: z.enum(['RECTANGLE', 'OVAL', 'CIRCLE', 'ARCH', 'CUSTOM']).optional(),
  openings: z.number().int().min(1).max(50).optional(),
  vGroove: z.boolean().optional(),
  reverseBevel: z.boolean().optional(),
  decorativeLine: z.boolean().optional(),
});

export const mouldingLayerSchema = z.object({
  role: z.enum(['INNER', 'OUTER']),
  catalogItemId: z.string().min(1),
  allowanceMm: z.number().min(0).max(50).optional(),
});

export const framingSpecSchema = z.object({
  artworkWidthMm: mm.min(1),
  artworkHeightMm: mm.min(1),
  clearanceMm: z.number().min(0).max(50).optional(),
  mats: z.array(matLayerSchema).max(7).optional(),
  mouldings: z.array(mouldingLayerSchema).max(2).optional(),
  glazing: z
    .object({
      catalogItemId: z.string().min(1),
      position: z.enum(['INNER_FRAME', 'BETWEEN_FRAMES', 'OUTER_FRAME']).optional(),
      spacerMm: z.number().min(0).max(100).optional(),
    })
    .optional(),
  backing: z.object({ catalogItemId: z.string().min(1) }).optional(),
  mounting: z
    .object({
      method: z.enum([
        'NONE',
        'HAND_STRETCH',
        'FOAM_MOUNT',
        'STRETCH_SUBFRAME',
        'STRETCH_GALLERY',
        'LAMINATE',
        'OTHER',
      ]),
      catalogItemId: z.string().min(1).optional(),
      boardCatalogItemId: z.string().min(1).optional(),
    })
    .optional(),
  subframe: z.object({ catalogItemId: z.string().min(1) }).optional(),
  hardware: z
    .array(
      z.object({
        catalogItemId: z.string().min(1),
        quantity: z.number().min(0).max(999).optional(),
      }),
    )
    .optional(),
  extras: z
    .array(
      z.object({
        catalogItemId: z.string().min(1),
        quantity: z.number().min(0).max(999).optional(),
        note: z.string().max(500).optional(),
      }),
    )
    .optional(),
  services: z
    .array(
      z.object({
        catalogItemId: z.string().min(1),
        quantity: z.number().min(0).max(999).optional(),
      }),
    )
    .optional(),
  notes: z.string().max(2000).optional(),
});

export const customerInputSchema = z.object({
  type: z.enum(['PERSON', 'ENTREPRENEUR', 'COMPANY']).default('PERSON'),
  lastName: z.string().max(120).optional().nullable(),
  firstName: z.string().max(120).optional().nullable(),
  middleName: z.string().max(120).optional().nullable(),
  companyName: z.string().max(200).optional().nullable(),
  inn: z.string().max(20).optional().nullable(),
  phone: z.string().min(6, 'Укажите телефон').max(30),
  phone2: z.string().max(30).optional().nullable(),
  email: z.string().email('Неверный e-mail').optional().nullable().or(z.literal('')),
  telegram: z.string().max(100).optional().nullable(),
  whatsapp: z.string().max(100).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  city: z.string().max(120).optional().nullable(),
  birthday: z.coerce.date().optional().nullable(),
  sourceId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
  marketingConsent: z.boolean().optional(),
  discountPercent: z.number().min(0).max(100).optional(),
});

export const createOrderSchema = z.object({
  customerId: z.string().min(1, 'Выберите клиента'),
  dueDate: z.coerce.date().optional().nullable(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT', 'CRITICAL']).optional(),
  branchId: z.string().optional().nullable(),
  managerId: z.string().optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
});

export const addWorkItemSchema = z.object({
  orderId: z.string().min(1),
  title: z.string().min(1, 'Укажите название изделия').max(200),
  description: z.string().max(2000).optional().nullable(),
  workType: z.string().max(100).optional().nullable(),
  spec: framingSpecSchema,
  quantity: z.number().int().min(1).max(999).optional(),
  discountPercent: z.number().min(0).max(100).optional(),
  priority: z.enum(['NORMAL', 'HIGH', 'URGENT', 'CRITICAL']).optional(),
  dueDate: z.coerce.date().optional().nullable(),
  masterId: z.string().optional().nullable(),
});

export const recordPaymentSchema = z.object({
  orderId: z.string().optional().nullable(),
  invoiceId: z.string().optional().nullable(),
  customerId: z.string().optional(),
  amount: z.number().int().positive('Сумма должна быть больше нуля'),
  method: z.enum(['CASH', 'CARD', 'TRANSFER', 'SBP', 'BANK', 'OTHER']),
  kind: z.enum(['PAYMENT', 'REFUND']).optional(),
  note: z.string().max(500).optional().nullable(),
});

export const workItemStatusSchema = z.object({
  status: z.enum([
    'DRAFT',
    'ESTIMATE',
    'AWAITING_CONFIRMATION',
    'CONFIRMED',
    'AWAITING_MATERIALS',
    'MATERIALS_READY',
    'IN_PRODUCTION',
    'QUALITY_CHECK',
    'READY',
    'ISSUED',
    'CLOSED',
    'CANCELLED',
  ]),
  note: z.string().max(500).optional(),
});

export const stageSchema = z.object({
  stage: z.enum([
    'NEW',
    'CONFIRMED',
    'AWAITING_MATERIALS',
    'MATERIALS_READY',
    'CUTTING',
    'ASSEMBLY',
    'STRETCHING',
    'MATTING',
    'GLAZING',
    'QUALITY_CONTROL',
    'DONE',
    'ISSUED',
  ]),
});

export const catalogGroupSchema = z.enum([
  'MOULDING',
  'MATBOARD',
  'GLAZING',
  'BACKING',
  'MOUNTING',
  'FABRIC',
  'HARDWARE',
  'FITTING',
  'EXTRA',
  'LABOUR',
  'SUPPLY',
  'SUBFRAME',
  'PRINT',
  'SERVICE',
]);

export const catalogSearchSchema = z.object({
  q: z.string().max(200).optional(),
  group: catalogGroupSchema.optional(),
  supplierId: z.string().optional(),
  categoryId: z.string().optional(),
  color: z.string().max(60).optional(),
  material: z.string().max(60).optional(),
  onlyActive: z.enum(['true', 'false']).optional(),
  /** Used by the constructor to show only mouldings there is enough stock of. */
  minAvailable: z.coerce.number().min(0).optional(),
  maxCostPrice: z.coerce.number().min(0).optional(),
  orderBy: z.enum(['name', 'sku', 'price', 'updated']).optional(),
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});
