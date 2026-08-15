'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatCustomerName, formatPhone } from '@/lib/format';

export interface CustomerOption {
  id: string;
  number: string;
  lastName: string | null;
  firstName: string | null;
  companyName: string | null;
  phone: string;
}

export function OrdersNewForm({
  customers,
  initialCustomerId = '',
}: {
  customers: CustomerOption[];
  initialCustomerId?: string;
}) {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [customerId, setCustomerId] = useState(initialCustomerId);
  const [dueDate, setDueDate] = useState('');
  const [priority, setPriority] = useState('NORMAL');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => {
    const term = search.trim().toLowerCase();
    const selected = customers.filter((customer) => customer.id === customerId);
    const rest = customers.filter((customer) => customer.id !== customerId);
    const filtered = term
      ? rest.filter((customer) =>
          [formatCustomerName(customer), customer.phone, customer.number]
            .join(' ')
            .toLowerCase()
            .includes(term),
        )
      : rest;
    // The chosen customer stays visible even when the search term excludes them.
    return [...selected, ...filtered].slice(0, 20);
  }, [customerId, customers, search]);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const order = await api.post<{ id: string }>('/api/orders', {
        customerId,
        dueDate: dueDate || null,
        priority,
        notes: notes || null,
      });
      // Straight into the constructor: an order without a piece is not useful.
      router.push(`/orders/${order.id}/items/new`);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось создать заказ.');
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader title="Клиент" description="Найдите по фамилии, телефону или номеру." />
        <div className="p-5">
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Иванов, +7 916…"
            autoFocus
          />

          <div className="mt-3 max-h-80 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {matches.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-ink-subtle">
                Клиенты не найдены.
              </p>
            ) : (
              matches.map((customer) => (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => setCustomerId(customer.id)}
                  className={`flex w-full items-center justify-between px-3 py-2.5 text-left text-sm transition-colors ${
                    customerId === customer.id
                      ? 'bg-accent-soft text-accent'
                      : 'hover:bg-surface-muted'
                  }`}
                >
                  <span>
                    <span className="block font-medium">{formatCustomerName(customer)}</span>
                    <span className="block text-xs text-ink-subtle">
                      {formatPhone(customer.phone)} · №{customer.number}
                    </span>
                  </span>
                </button>
              ))
            )}
          </div>

          <Link
            href="/customers/new?next=/orders/new"
            className="mt-3 inline-block text-sm text-accent hover:underline"
          >
            Клиента нет в базе — создать нового
          </Link>
        </div>
      </Card>

      <Card>
        <CardHeader title="Параметры заказа" />
        <div className="space-y-4 p-5">
          <Field label="Срок готовности">
            <Input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
            />
          </Field>

          <Field label="Приоритет">
            <Select value={priority} onChange={(event) => setPriority(event.target.value)}>
              <option value="NORMAL">Обычный</option>
              <option value="HIGH">Высокий</option>
              <option value="URGENT">Срочный</option>
              <option value="CRITICAL">Критический</option>
            </Select>
          </Field>

          <Field label="Примечание">
            <Textarea
              rows={3}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Договорённости с клиентом"
            />
          </Field>

          {error ? (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
          ) : null}

          <Button
            className="w-full"
            size="lg"
            onClick={submit}
            disabled={!customerId || saving}
          >
            {saving ? 'Создаём…' : 'Создать заказ и перейти к расчёту'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
