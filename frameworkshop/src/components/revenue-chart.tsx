'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { toRoubles } from '@/lib/money';
import { formatMoney } from '@/lib/format';

export interface RevenuePoint {
  date: string;
  revenue: number;
  profit: number;
}

export function RevenueChart({ data }: { data: RevenuePoint[] }) {
  // Recharts works in numbers, so kopecks are converted to roubles for display
  // and formatted back on the axis and tooltip.
  const points = data.map((point) => ({
    date: point.date.slice(8, 10) + '.' + point.date.slice(5, 7),
    Выручка: toRoubles(point.revenue),
    Прибыль: toRoubles(point.profit),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="revenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.25} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="date"
          tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}
          tickLine={false}
          axisLine={false}
          interval="preserveStartEnd"
        />
        <YAxis
          tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}
          tickLine={false}
          axisLine={false}
          width={70}
          tickFormatter={(value: number) => new Intl.NumberFormat('ru-RU').format(value)}
        />
        <Tooltip
          formatter={(value) => formatMoney(Math.round(Number(value) * 100))}
          contentStyle={{
            borderRadius: 8,
            border: '1px solid var(--color-line)',
            fontSize: 12,
          }}
        />
        <Area
          type="monotone"
          dataKey="Выручка"
          stroke="var(--color-accent)"
          fill="url(#revenue)"
          strokeWidth={2}
        />
        <Area
          type="monotone"
          dataKey="Прибыль"
          stroke="var(--color-positive)"
          fill="transparent"
          strokeWidth={2}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
