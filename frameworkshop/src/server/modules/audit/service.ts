import type { Db } from '@/server/db';
import { prisma } from '@/server/db';
import type { AppContext } from '@/server/lib/context';

export interface AuditEntry {
  action: string;
  entity: string;
  entityId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/**
 * Writes an audit record. Callers inside a transaction must pass their `tx`
 * so the log is committed or rolled back together with the change it describes.
 */
export async function writeAudit(db: Db, context: AppContext, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      organizationId: context.user.organizationId,
      userId: context.user.id,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      oldValue: entry.oldValue === undefined ? undefined : (entry.oldValue as never),
      newValue: entry.newValue === undefined ? undefined : (entry.newValue as never),
      ip: context.ip,
      userAgent: context.userAgent,
    },
  });
}

export interface AuditQuery {
  entity?: string;
  entityId?: string;
  userId?: string;
  action?: string;
  from?: Date;
  to?: Date;
  take?: number;
  skip?: number;
}

export async function listAudit(organizationId: string, query: AuditQuery = {}) {
  const where = {
    organizationId,
    ...(query.entity ? { entity: query.entity } : {}),
    ...(query.entityId ? { entityId: query.entityId } : {}),
    ...(query.userId ? { userId: query.userId } : {}),
    ...(query.action ? { action: { contains: query.action, mode: 'insensitive' as const } } : {}),
    ...(query.from || query.to
      ? { createdAt: { ...(query.from ? { gte: query.from } : {}), ...(query.to ? { lte: query.to } : {}) } }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: query.take ?? 50,
      skip: query.skip ?? 0,
      include: { user: { select: { firstName: true, lastName: true, email: true } } },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return { items, total };
}

/** Compact diff so the audit log stores changed fields only. */
export function diff<T extends Record<string, unknown>>(
  before: T | null | undefined,
  after: T | null | undefined,
): { old: Record<string, unknown>; new: Record<string, unknown> } {
  const oldValue: Record<string, unknown> = {};
  const newValue: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    const previous = before?.[key];
    const next = after?.[key];
    if (JSON.stringify(previous) === JSON.stringify(next)) continue;
    if (previous !== undefined) oldValue[key] = previous;
    if (next !== undefined) newValue[key] = next;
  }

  return { old: oldValue, new: newValue };
}
