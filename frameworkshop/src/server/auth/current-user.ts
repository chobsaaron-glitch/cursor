import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, resolveSession, type SessionUser } from './session';
import { hasPermission, type Permission } from './permissions';

/** Session for a server component. Redirects to login when there is none. */
export async function currentUser(): Promise<SessionUser> {
  const cookieStore = await cookies();
  const user = await resolveSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) redirect('/login');
  return user;
}

export async function currentContext() {
  const user = await currentUser();
  return { user };
}

export function can(user: SessionUser, permission: Permission | Permission[]): boolean {
  return hasPermission(user.permissions, permission);
}
