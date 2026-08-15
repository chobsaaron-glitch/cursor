import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { SignJWT, jwtVerify } from 'jose';
import { prisma } from '@/server/db';
import { maxDiscountForRole, type Permission, hasPermission } from './permissions';

export const SESSION_COOKIE = 'fw_session';
const CSRF_COOKIE = 'fw_csrf';

export interface SessionUser {
  id: string;
  organizationId: string;
  branchId: string | null;
  email: string;
  firstName: string;
  lastName: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  maxDiscountPercent: number;
}

export interface SessionPayload {
  sub: string;
  sid: string;
  org: string;
}

export class AuthError extends Error {
  constructor(
    message: string,
    readonly status: number = 401,
  ) {
    super(message);
    this.name = 'AuthError';
  }
}

export class ForbiddenError extends AuthError {
  constructor(message = 'Недостаточно прав для выполнения операции.') {
    super(message, 403);
    this.name = 'ForbiddenError';
  }
}

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new Error('AUTH_SECRET must be set and at least 32 characters long.');
  }
  return new TextEncoder().encode(value);
}

export function sessionTtlSeconds(): number {
  const parsed = Number.parseInt(process.env.AUTH_SESSION_TTL ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 43_200;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generateCsrfToken(): string {
  return randomBytes(24).toString('hex');
}

export function csrfCookieName(): string {
  return CSRF_COOKIE;
}

/** Constant-time comparison so a CSRF token cannot be guessed byte by byte. */
export function csrfTokensMatch(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export interface CreatedSession {
  token: string;
  csrfToken: string;
  expiresAt: Date;
}

export async function createSession(
  userId: string,
  organizationId: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<CreatedSession> {
  const raw = randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + sessionTtlSeconds() * 1000);

  const session = await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(raw),
      expiresAt,
      ip: context.ip,
      userAgent: context.userAgent,
    },
  });

  const token = await new SignJWT({ sid: session.id, org: organizationId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());

  return { token: `${token}.${raw}`, csrfToken: generateCsrfToken(), expiresAt };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

/**
 * Verifies both halves of the cookie: the signed JWT (cheap, stateless) and the
 * random secret stored as a hash (allows instant revocation).
 */
export async function resolveSession(cookieValue: string | undefined): Promise<SessionUser | null> {
  if (!cookieValue) return null;

  const separator = cookieValue.lastIndexOf('.');
  if (separator === -1) return null;
  const jwt = cookieValue.slice(0, separator);
  const raw = cookieValue.slice(separator + 1);
  if (!jwt || !raw) return null;

  let payload: SessionPayload;
  try {
    const verified = await jwtVerify(jwt, secret());
    payload = verified.payload as unknown as SessionPayload;
  } catch {
    return null;
  }

  const session = await prisma.session.findFirst({
    where: {
      id: payload.sid,
      tokenHash: hashToken(raw),
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        include: { role: { include: { permissions: true } } },
      },
    },
  });

  if (!session || !session.user.isActive) return null;

  const user = session.user;
  return {
    id: user.id,
    organizationId: user.organizationId,
    branchId: user.branchId,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    roleCode: user.role.code,
    roleName: user.role.name,
    permissions: user.role.permissions.map((entry) => entry.permission),
    maxDiscountPercent: maxDiscountForRole(user.role.code),
  };
}

export function assertPermission(user: SessionUser, permission: Permission | Permission[]): void {
  if (!hasPermission(user.permissions, permission)) {
    throw new ForbiddenError();
  }
}

export interface LoginResult {
  user: SessionUser;
  session: CreatedSession;
}

/** Deliberately vague error text — it must not reveal whether the email exists. */
const INVALID_CREDENTIALS = 'Неверный e-mail или пароль.';

export async function login(
  email: string,
  password: string,
  context: { ip?: string; userAgent?: string } = {},
): Promise<LoginResult> {
  const user = await prisma.user.findFirst({
    where: { email: email.trim().toLowerCase() },
    include: { role: { include: { permissions: true } } },
  });

  if (!user) {
    // Equalise timing with the success path so accounts cannot be enumerated.
    await bcrypt.compare(password, '$2b$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalid');
    throw new AuthError(INVALID_CREDENTIALS);
  }
  if (!user.isActive) throw new AuthError('Учётная запись отключена.');

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) throw new AuthError(INVALID_CREDENTIALS);

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  const session = await createSession(user.id, user.organizationId, context);

  return {
    session,
    user: {
      id: user.id,
      organizationId: user.organizationId,
      branchId: user.branchId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roleCode: user.role.code,
      roleName: user.role.name,
      permissions: user.role.permissions.map((entry) => entry.permission),
      maxDiscountPercent: maxDiscountForRole(user.role.code),
    },
  };
}
