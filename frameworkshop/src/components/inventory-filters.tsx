'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Search } from 'lucide-react';
import { Button, Input, Select } from '@/components/ui';
import { CATALOG_GROUP } from '@/lib/statuses';

export interface InventoryFiltersProps {
  q: string;
  group: string;
  lowStockOnly: boolean;
}

export function InventoryFilters({ q, group, lowStockOnly }: InventoryFiltersProps) {
  const router = useRouter();
  const [query, setQuery] = useState(q);
  const [selectedGroup, setSelectedGroup] = useState(group);
  const [onlyLow, setOnlyLow] = useState(lowStockOnly);

  function apply(next: { q?: string; group?: string; lowStockOnly?: boolean }) {
    const params = new URLSearchParams();
    const value = next.q ?? query;
    const groupValue = next.group ?? selectedGroup;
    const lowValue = next.lowStockOnly ?? onlyLow;

    if (value.trim()) params.set('q', value.trim());
    if (groupValue) params.set('group', groupValue);
    if (lowValue) params.set('low', 'true');

    const search = params.toString();
    router.push(search ? `/inventory?${search}` : '/inventory');
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply({});
  }

  function reset() {
    setQuery('');
    setSelectedGroup('');
    setOnlyLow(false);
    router.push('/inventory');
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-center gap-3">
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Поиск по названию, артикулу или штрихкоду"
          className="pl-9"
          aria-label="Поиск по складу"
        />
      </div>

      <Select
        value={selectedGroup}
        onChange={(event) => {
          setSelectedGroup(event.target.value);
          apply({ group: event.target.value });
        }}
        aria-label="Группа материалов"
        className="w-52"
      >
        <option value="">Все группы</option>
        {Object.entries(CATALOG_GROUP).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={onlyLow}
          onChange={(event) => {
            setOnlyLow(event.target.checked);
            apply({ lowStockOnly: event.target.checked });
          }}
          className="size-4 rounded border-line accent-accent"
        />
        Только дефицит
      </label>

      <Button type="submit" size="md">
        Найти
      </Button>
      <Button type="button" variant="ghost" size="md" onClick={reset}>
        Сбросить
      </Button>
    </form>
  );
}
