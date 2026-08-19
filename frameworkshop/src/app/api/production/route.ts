import { z } from 'zod';
import { route } from '@/server/api/handler';
import { stageSchema } from '@/server/api/schemas';
import {
  assignMaster,
  loadProductionBoard,
  moveStage,
} from '@/server/modules/production/service';

export const GET = route({ permission: 'production.view' }, async ({ context }) =>
  loadProductionBoard(context.user.organizationId),
);

const moveSchema = z.union([
  stageSchema.extend({ productionOrderId: z.string().min(1) }),
  z.object({ productionOrderId: z.string().min(1), masterId: z.string().nullable() }),
]);

export const POST = route(
  { permission: 'production.manage', body: moveSchema },
  async ({ context, body }) => {
    if ('stage' in body) return moveStage(context, body.productionOrderId, body.stage);
    return assignMaster(context, body.productionOrderId, body.masterId);
  },
);
