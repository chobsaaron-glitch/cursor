import { z } from 'zod';
import { route } from '@/server/api/handler';
import { finishTask, setTaskStatus, startTask } from '@/server/modules/production/service';

const schema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('start') }),
  z.object({ action: z.literal('finish'), note: z.string().max(500).optional() }),
  z.object({
    action: z.literal('status'),
    status: z.enum(['PENDING', 'IN_PROGRESS', 'DONE', 'SKIPPED']),
  }),
]);

export const POST = route(
  { permission: 'production.execute', body: schema },
  async ({ context, body, params }) => {
    switch (body.action) {
      case 'start':
        return startTask(context, params.id);
      case 'finish':
        return finishTask(context, params.id, body.note);
      case 'status':
        return setTaskStatus(context, params.id, body.status);
    }
  },
);
