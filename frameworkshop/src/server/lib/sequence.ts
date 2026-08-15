import type { Db } from '@/server/db';

/**
 * Document numbering.
 *
 * The counter is incremented with a single atomic UPDATE inside the caller's
 * transaction, so two receptionists saving an order at the same moment can
 * never receive the same number.
 */
export async function nextNumber(
  db: Db,
  organizationId: string,
  key: string,
  options: { prefix?: string; padding?: number } = {},
): Promise<string> {
  const padding = options.padding ?? 4;

  const existing = await db.sequence.findUnique({
    where: { organizationId_key: { organizationId, key } },
  });

  if (!existing) {
    const prefix = options.prefix ?? defaultPrefix(key);
    const created = await db.sequence.create({
      data: { organizationId, key, prefix, value: 1 },
    });
    return format(created.prefix, 1, padding);
  }

  const updated = await db.sequence.update({
    where: { organizationId_key: { organizationId, key } },
    data: { value: { increment: 1 } },
  });

  return format(options.prefix ?? updated.prefix, updated.value, padding);
}

function format(prefix: string, value: number, padding: number): string {
  return `${prefix}${String(value).padStart(padding, '0')}`;
}

function defaultPrefix(key: string): string {
  const year = new Date().getFullYear() % 100;
  const prefixes: Record<string, string> = {
    order: `${year}`,
    customer: 'К-',
    invoice: `С-${year}-`,
    payment: `П-${year}-`,
    purchase_order: `ЗП-${year}-`,
    production: `ПР-${year}-`,
    cut_plan: `РК-${year}-`,
  };
  return prefixes[key] ?? '';
}

/** Work items are numbered inside their order: 250154-1, 250154-2… */
export function workItemNumber(orderNumber: string, seq: number): string {
  return `${orderNumber}-${seq}`;
}
