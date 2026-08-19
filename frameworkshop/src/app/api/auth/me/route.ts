import { requireContext, route } from '@/server/api/handler';

export const GET = route({ anonymous: true }, async () => {
  const context = await requireContext();
  return { user: context.user };
});
