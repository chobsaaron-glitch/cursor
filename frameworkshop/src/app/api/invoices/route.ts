import { route } from '@/server/api/handler';
import { createInvoiceSchema } from '@/server/api/schemas';
import { createInvoice } from '@/server/modules/payments/service';

export const POST = route(
  { permission: 'invoices.create', body: createInvoiceSchema },
  async ({ context, body }) => createInvoice(context, body),
);
