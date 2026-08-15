/**
 * Route plumbing shared by every API endpoint: session resolution, CSRF, rate
 * limiting, permission checks, body validation and error mapping.
 *
 * Handlers written on top of this only ever contain business intent — they
 * receive an authenticated AppContext and validated input, and return plain
 * data.
 */

import { cookies, headers } from 'next/headers';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  AuthError,
  ForbiddenError,
  SESSION_COOKIE,
  csrfCookieName,
  csrfTokensMatch,
  resolveSession,
} from '@/server/auth/session';
import { hasPermission, type Permission } from '@/server/auth/permissions';
import { DomainError, type AppContext } from '@/server/lib/context';
import { PricingError } from '@/server/modules/pricing/engine';
import { FormulaError } from '@/server/modules/pricing/formula';

export const CSRF_HEADER = 'x-csrf-token';

/** Methods that change state and therefore need a CSRF token. */
const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

export interface RouteOptions<TBody, TQuery> {
  /** Permission (or any-of list) required to call the route. */
  permission?: Permission | Permission[];
  body?: z.ZodType<TBody>;
  query?: z.ZodType<TQuery>;
  /** Set for public routes such as login. */
  anonymous?: boolean;
  /** Max requests per minute per client for this route. */
  rateLimit?: number;
}

export interface RouteInput<TBody, TQuery> {
  context: AppContext;
  body: TBody;
  query: TQuery;
  request: NextRequest;
  params: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Rate limiting
// ---------------------------------------------------------------------------

const buckets = new Map<string, { count: number; resetAt: number }>();

function rateLimited(key: string, limit: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + 60_000 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > limit;
}

// Keeps the map from growing without bound on a long-lived server.
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}, 60_000).unref?.();

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export function errorResponse(error: unknown): NextResponse {
  if (error instanceof z.ZodError) {
    return NextResponse.json(
      {
        error: 'Проверьте правильность заполнения полей.',
        details: error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
      { status: 422 },
    );
  }

  if (error instanceof AuthError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof DomainError) {
    return NextResponse.json({ error: error.message, details: error.details }, { status: error.status });
  }
  if (error instanceof PricingError || error instanceof FormulaError) {
    return NextResponse.json({ error: error.message }, { status: 400 });
  }

  console.error('Необработанная ошибка API:', error);
  return NextResponse.json({ error: 'Внутренняя ошибка сервера.' }, { status: 500 });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

/** Resolves the caller, or throws if the session is missing or expired. */
export async function requireContext(): Promise<AppContext> {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const user = await resolveSession(cookieStore.get(SESSION_COOKIE)?.value);
  if (!user) throw new AuthError('Требуется вход в систему.');

  return {
    user,
    ip: headerStore.get('x-forwarded-for')?.split(',')[0]?.trim(),
    userAgent: headerStore.get('user-agent') ?? undefined,
  };
}

async function assertCsrf(request: NextRequest): Promise<void> {
  if (!UNSAFE_METHODS.has(request.method)) return;

  const cookieStore = await cookies();
  const expected = cookieStore.get(csrfCookieName())?.value;
  const provided = request.headers.get(CSRF_HEADER) ?? undefined;

  if (!csrfTokensMatch(expected, provided)) {
    throw new AuthError('Недействительный CSRF-токен. Обновите страницу.', 403);
  }
}

async function clientKey(request: NextRequest): Promise<string> {
  const headerStore = await headers();
  const ip = headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';
  return `${ip}:${new URL(request.url).pathname}`;
}

function queryObject(request: NextRequest): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  for (const key of new Set(request.nextUrl.searchParams.keys())) {
    const values = request.nextUrl.searchParams.getAll(key);
    result[key] = values.length > 1 ? values : values[0];
  }
  return result;
}

/**
 * Wraps a handler. Next.js passes route params as a promise in its newer
 * signature, so they are awaited here rather than in every handler.
 */
export function route<TBody = undefined, TQuery = undefined>(
  options: RouteOptions<TBody, TQuery>,
  handler: (input: RouteInput<TBody, TQuery>) => Promise<unknown>,
) {
  return async (
    request: NextRequest,
    routeContext?: { params?: Promise<Record<string, string>> },
  ): Promise<NextResponse> => {
    try {
      if (options.rateLimit && rateLimited(await clientKey(request), options.rateLimit)) {
        throw new DomainError('Слишком много запросов. Попробуйте через минуту.', 429);
      }

      let context: AppContext;
      if (options.anonymous) {
        context = undefined as unknown as AppContext;
      } else {
        await assertCsrf(request);
        context = await requireContext();

        if (options.permission && !hasPermission(context.user.permissions, options.permission)) {
          throw new ForbiddenError();
        }
      }

      let body = undefined as TBody;
      if (options.body) {
        const raw = request.method === 'GET' ? {} : await request.json().catch(() => ({}));
        body = options.body.parse(raw);
      }

      let query = undefined as TQuery;
      if (options.query) {
        query = options.query.parse(queryObject(request));
      }

      const params = routeContext?.params ? await routeContext.params : {};
      const result = await handler({ context, body, query, request, params });

      if (result instanceof NextResponse) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

// ---------------------------------------------------------------------------
// Reusable schema fragments
// ---------------------------------------------------------------------------

/** Query strings arrive as text, so numbers and booleans need coercing. */
export const numeric = z.coerce.number();
export const optionalNumeric = z.coerce.number().optional();
export const booleanish = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((value) => value === true || value === 'true' || value === '1');

export const paginationSchema = z.object({
  take: z.coerce.number().int().min(1).max(200).optional(),
  skip: z.coerce.number().int().min(0).optional(),
});

export const dateish = z.coerce.date();
