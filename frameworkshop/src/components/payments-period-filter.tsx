'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui';

const PERIODS = [7, 30, 90, 365];

const LABELS: Record<number, string> = {
  7: 'За 7 дней',
  30: 'За 30 дней',
  90: 'За 90 дней',
  365: 'За год',
};

export function PaymentsPeriodFilter({ days }: { days: number }) {
  const router = useRouter();

  return (
    <Select
      value={String(days)}
      aria-label="Период"
      className="w-44"
      onChange={(event) => router.push(`/payments?days=${event.target.value}`)}
    >
      {PERIODS.map((value) => (
        <option key={value} value={value}>
          {LABELS[value]}
        </option>
      ))}
    </Select>
  );
}
