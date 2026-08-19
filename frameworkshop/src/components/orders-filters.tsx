'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { COMMERCIAL_STATUS, PAYMENT_STATUS, PRODUCTION_STATUS } from '@/lib/statuses';

/**
 * Filters live in the query string so a filtered view can be bookmarked and
 * shared, and so the server component stays the single source of the data.
 */
export function OrdersFilters() {
  const router = useRouter();
  const params = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');

  function apply(changes: Record<string, string>) {
    const next = new URLSearchParams(params.toString());
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('skip');
    router.push(`/orders?${next.toString()}`);
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply({ q: query });
  }

  return (
    <form onSubmit={submit} className="mb-4 flex flex-wrap items-center gap-2">
      <div className="relative min-w-56 flex-1">
        <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Номер заказа, клиент, телефон, изделие"
          className="pl-9"
        />
      </div>

      <Select
        value={params.get('commercialStatus') ?? ''}
        onChange={(event) => apply({ commercialStatus: event.target.value })}
        className="w-auto"
      >
        <option value="">Все коммерческие статусы</option>
        {Object.entries(COMMERCIAL_STATUS).map(([value, entry]) => (
          <option key={value} value={value}>
            {entry.label}
          </option>
        ))}
      </Select>

      <Select
        value={params.get('productionStatus') ?? ''}
        onChange={(event) => apply({ productionStatus: event.target.value })}
        className="w-auto"
      >
        <option value="">Всё производство</option>
        {Object.entries(PRODUCTION_STATUS).map(([value, entry]) => (
          <option key={value} value={value}>
            {entry.label}
          </option>
        ))}
      </Select>

      <Select
        value={params.get('paymentStatus') ?? ''}
        onChange={(event) => apply({ paymentStatus: event.target.value })}
        className="w-auto"
      >
        <option value="">Любая оплата</option>
        {Object.entries(PAYMENT_STATUS).map(([value, entry]) => (
          <option key={value} value={value}>
            {entry.label}
          </option>
        ))}
      </Select>

      <Button
        type="button"
        variant={params.get('overdueOnly') === 'true' ? 'primary' : 'secondary'}
        onClick={() =>
          apply({ overdueOnly: params.get('overdueOnly') === 'true' ? '' : 'true' })
        }
      >
        Просроченные
      </Button>

      <Button type="submit" variant="secondary">
        Найти
      </Button>
    </form>
  );
}
