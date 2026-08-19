import type { SessionUser } from '@/server/auth/session';

/** Everything a service needs to know about "who is doing this, and where". */
export interface AppContext {
  user: SessionUser;
  ip?: string;
  userAgent?: string;
}

export class DomainError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

export class NotFoundError extends DomainError {
  constructor(entity = 'Запись') {
    super(`${entity} не найдена.`, 404);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
    this.name = 'ConflictError';
  }
}
