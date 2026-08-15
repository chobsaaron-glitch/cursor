'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, useTransition, type FormEvent } from 'react';
import { Search, X } from 'lucide-react';
import { Button, Input, Select, cn } from '@/components/ui';

const TYPE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'Все типы' },
  { value: 'PERSON', label: 'Физлицо' },
  { value: 'ENTREPRENEUR', label: 'ИП' },
  { value: 'COMPANY', label: 'ООО' },
];

export function CustomersFilters({
  q,
  type,
  withDebtOnly,
}: {
  q: string;
  type: string;
  withDebtOnly: boolean;
}) {
  const router = useRouter();
  const [term, setTerm] = useState(q);
  const [pending, startTransition] = useTransition();

  useEffect(() => setTerm(q), [q]);

  function apply(next: { q?: string; type?: string; debt?: boolean }) {
    const params = new URLSearchParams();
    const nextTerm = (next.q ?? term).trim();
    const nextType = next.type ?? type;
    const nextDebt = next.debt ?? withDebtOnly;

    if (nextTerm) params.set('q', nextTerm);
    if (nextType) params.set('type', nextType);
    if (nextDebt) params.set('debt', 'true');

    const search = params.toString();
    startTransition(() => router.push(search ? `/customers?${search}` : '/customers'));
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    apply({});
  }

  const hasFilters = Boolean(q || type || withDebtOnly);

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        'flex flex-wrap items-center gap-3 border-b border-line px-5 py-4',
        pending && 'opacity-70',
      )}
    >
      <div className="relative min-w-56 flex-1">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-subtle" />
        <Input
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Имя, компания, телефон, e-mail"
          aria-label="Поиск клиентов"
          className="pl-9"
        />
      </div>

      <Select
        value={type}
        onChange={(event) => apply({ type: event.target.value })}
        aria-label="Тип клиента"
        className="w-44"
      >
        {TYPE_OPTIONS.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input
          type="checkbox"
          checked={withDebtOnly}
          onChange={(event) => apply({ debt: event.target.checked })}
          className="size-4 accent-accent"
        />
        Только с долгом
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
            apply({ q: '', type: '', debt: false });
          }}
        >
          <X className="size-4" />
          Сбросить
        </Button>
      ) : null}
    </form>
  );
}
