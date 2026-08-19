import { prisma } from '@/server/db';

/**
 * Empties every application table.
 *
 * Used by the demo seed and the integration tests. Organisations are never
 * deleted in production — users, audit records and payments are kept forever —
 * so a plain TRUNCATE is the honest way to reset a scratch database.
 */
export async function resetDatabase(): Promise<void> {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DB_RESET !== 'true') {
    throw new Error('Отказ: сброс базы данных запрещён в production.');
  }

  const tables = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (tables.length === 0) return;

  const list = tables.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}
