'use client';

import { useRouter } from 'next/navigation';
import { Select } from '@/components/ui';

export const REPORT_PERIODS = [7, 30, 90, 180, 365] as const;

const PERIODS = REPORT_PERIODS;

const LABELS: Record<number, string> = {
  7: 'За 7 дней',
  30: 'За 30 дней',
  90: 'За 90 дней',
  180: 'За полгода',
  365: 'За год',
};

export function ReportsPeriodSelect({ tab, days }: { tab: string; days: number }) {
  const router = useRouter();

  return (
    <Select
      value={String(days)}
      aria-label="Период отчёта"
      className="w-44"
      onChange={(event) => router.push(`/reports?tab=${tab}&days=${event.target.value}`)}
    >
      {PERIODS.map((value) => (
        <option key={value} value={value}>
          {LABELS[value]}
        </option>
      ))}
    </Select>
  );
}
