import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { AppShell } from '@/components/app-shell';
import { SESSION_COOKIE, resolveSession } from '@/server/auth/session';

/**
 * Every page below this layout requires a session. Resolving it here means the
 * pages themselves can assume an authenticated user.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const user = await resolveSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');

  return <AppShell user={user}>{children}</AppShell>;
}
