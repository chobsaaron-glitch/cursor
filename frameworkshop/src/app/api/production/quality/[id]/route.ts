import { z } from 'zod';
import { route } from '@/server/api/handler';
import {
  completeQualityCheck,
  updateQualityCheckItem,
} from '@/server/modules/production/service';

const schema = z.union([
  z.object({ itemId: z.string().min(1), checked: z.boolean(), note: z.string().max(500).optional() }),
  z.object({ result: z.enum(['PASSED', 'FAILED']), note: z.string().max(500).optional() }),
]);

export const POST = route(
  { permission: 'production.quality', body: schema },
  async ({ context, body, params }) => {
    if ('itemId' in body) {
      return updateQualityCheckItem(context, body.itemId, body.checked, body.note);
    }
    return completeQualityCheck(context, params.id, body.result, body.note);
  },
);
