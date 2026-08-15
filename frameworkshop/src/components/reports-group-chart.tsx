'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '@/lib/format';
import { toRoubles } from '@/lib/money';

export interface GroupPoint {
  label: string;
  revenue: number;
  profit: number;
}

/** Revenue and profit per component group; kopecks are shown as roubles. */
export function ReportsGroupChart({ data }: { data: GroupPoint[] }) {
  const points = data.map((point) => ({
    label: point.label,
    Выручка: toRoubles(point.revenue),
    Прибыль: toRoubles(point.profit),
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <CartesianGrid stroke="var(--color-line)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11, fill: 'var(--color-ink-muted)' }}
          tickLine={false}
          axisLine={false}
          interval={0}
          angle={-20}
          textAnchor="end"
          height={56}
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
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="Выручка" fill="var(--color-accent)" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Прибыль" fill="var(--color-positive)" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
