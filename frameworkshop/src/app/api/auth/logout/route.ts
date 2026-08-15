import { cookies } from 'next/headers';
import { route } from '@/server/api/handler';
import { SESSION_COOKIE, csrfCookieName, resolveSession } from '@/server/auth/session';
import { prisma } from '@/server/db';

export const POST = route({ anonymous: true }, async () => {
  const cookieStore = await cookies();
  const value = cookieStore.get(SESSION_COOKIE)?.value;

  if (value) {
    const user = await resolveSession(value);
    if (user) {
      // Revoke every session id carried by this cookie rather than trusting the
      // client to stop sending it.
      await prisma.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
  }

  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(csrfCookieName());
  return { ok: true };
});
