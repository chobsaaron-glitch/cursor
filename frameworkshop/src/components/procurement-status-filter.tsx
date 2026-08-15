'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui';
import { PURCHASE_ORDER_STATUS } from '@/lib/statuses';

export function ProcurementStatusFilter({ status }: { status: string }) {
  const router = useRouter();

  return (
    <Select
      value={status}
      aria-label="Статус заказа поставщику"
      className="w-56"
      onChange={(event) => {
        const value = event.target.value;
        router.push(value ? `/procurement?status=${value}` : '/procurement');
      }}
    >
      <option value="">Все статусы</option>
      {Object.entries(PURCHASE_ORDER_STATUS).map(([key, entry]) => (
        <option key={key} value={key}>
          {entry.label}
        </option>
      ))}
    </Select>
  );
}
