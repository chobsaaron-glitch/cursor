import { cookies, headers } from 'next/headers';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { route } from '@/server/api/handler';
import {
  SESSION_COOKIE,
  csrfCookieName,
  login,
  sessionTtlSeconds,
} from '@/server/auth/session';

const schema = z.object({
  email: z.string().email('Введите корректный e-mail'),
  password: z.string().min(1, 'Введите пароль'),
});

export const POST = route(
  // Login cannot require a session, and is the one route worth throttling hard.
  { anonymous: true, body: schema, rateLimit: 10 },
  async ({ body }) => {
    const headerStore = await headers();
    const result = await login(body.email, body.password, {
      ip: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim(),
      userAgent: headerStore.get('user-agent') ?? undefined,
    });

    const cookieStore = await cookies();
    const secure = process.env.NODE_ENV === 'production';

    cookieStore.set(SESSION_COOKIE, result.session.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: sessionTtlSeconds(),
    });
    // Readable by the browser on purpose: the client echoes it back in a header
    // so a cross-site form post cannot forge a state-changing request.
    cookieStore.set(csrfCookieName(), result.session.csrfToken, {
      httpOnly: false,
      sameSite: 'lax',
      secure,
      path: '/',
      maxAge: sessionTtlSeconds(),
    });

    return NextResponse.json({ user: result.user });
  },
);
