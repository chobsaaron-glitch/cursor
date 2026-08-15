'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input, cn } from '@/components/ui';
import { CATALOG_GROUP } from '@/lib/statuses';

const GROUPS = Object.keys(CATALOG_GROUP);

export function CatalogFilters({
  q,
  group,
  inStockOnly,
}: {
  q: string;
  group: string;
  inStockOnly: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(q);
  const [pending, startTransition] = useTransition();

  useEffect(() => setTerm(q), [q]);

  function apply(next: { q?: string; group?: string; stock?: boolean }) {
    const params = new URLSearchParams();
    const nextTerm = (next.q ?? term).trim();
    const nextGroup = next.group ?? group;
    const nextStock = next.stock ?? inStockOnly;

    if (nextTerm) params.set('q', nextTerm);
    if (nextGroup) params.set('group', nextGroup);
    if (nextStock) params.set('stock', 'true');

    const search = params.toString();
    startTransition(() => router.push(search ? `/catalog?${search}` : '/catalog'));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    apply({});
  }

  const hasFilters = Boolean(q || group || inStockOnly);

  return (
    <div className={cn('border-b border-line px-5 py-4', pending && 'opacity-70')}>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-56 flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder="Артикул, штрих-код, название, цвет, материал"
            aria-label="Поиск по каталогу"
            className="pl-9"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input
            type="checkbox"
            checked={inStockOnly}
            onChange={(event) => apply({ stock: event.target.checked })}
            className="size-4 accent-accent"
          />
          Только в наличии
        </label>

        <Button type="submit" size="sm" disabled={pending}>
          Найти
        </Button>

        {hasFilters ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => {
              setTerm('');
              apply({ q: '', group: '', stock: false });
            }}
          >
            <X className="size-4" />
            Сбросить
          </Button>
        ) : null}
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <GroupChip label="Все группы" active={group === ''} onClick={() => apply({ group: '' })} />
        {GROUPS.map((code) => (
          <GroupChip
            key={code}
            label={CATALOG_GROUP[code] ?? code}
            active={group === code}
            onClick={() => apply({ group: code })}
          />
        ))}
      </div>
    </div>
  );
}

function GroupChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-line text-ink-muted hover:bg-surface-muted hover:text-ink',
      )}
    >
      {label}
    </button>
  );
}
