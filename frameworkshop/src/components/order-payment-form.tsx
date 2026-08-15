'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { parseMoney } from '@/lib/money';
import { formatMoney } from '@/lib/format';
import { PAYMENT_METHOD } from '@/lib/statuses';

export function OrderPaymentForm({
  orderId,
  customerId,
  balance,
  paidTotal,
  canRefund,
}: {
  orderId: string;
  customerId: string;
  balance: number;
  paidTotal: number;
  canRefund: boolean;
}) {
  const router = useRouter();
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CARD');
  const [kind, setKind] = useState<'PAYMENT' | 'REFUND'>('PAYMENT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const kopecks = parseMoney(amount);
    if (kopecks <= 0) {
      setError('Укажите сумму больше нуля.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      await api.post('/api/payments', {
        orderId,
        customerId,
        amount: kopecks,
        method,
        kind,
        note: note.trim() || null,
      });
      setAmount('');
      setNote('');
      setKind('PAYMENT');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось провести платёж.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <Field label="Сумма, ₽" hint={kind === 'PAYMENT' ? `Остаток ${formatMoney(balance)}` : `Оплачено ${formatMoney(paidTotal)}`}>
        <Input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          inputMode="decimal"
          placeholder="0,00"
          className="tabular"
        />
      </Field>

      <Field label="Способ">
        <Select value={method} onChange={(event) => setMethod(event.target.value)}>
          {Object.entries(PAYMENT_METHOD).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </Field>

      {canRefund ? (
        <Field label="Тип">
          <Select
            value={kind}
            onChange={(event) => setKind(event.target.value === 'REFUND' ? 'REFUND' : 'PAYMENT')}
          >
            <option value="PAYMENT">Оплата</option>
            <option value="REFUND">Возврат</option>
          </Select>
        </Field>
      ) : null}

      <Field label="Комментарий" className={canRefund ? undefined : 'sm:col-span-2 lg:col-span-1'}>
        <Textarea
          rows={1}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Необязательно"
        />
      </Field>

      {error ? <p className="text-sm text-danger sm:col-span-2 lg:col-span-4">{error}</p> : null}

      <div className="flex items-end sm:col-span-2 lg:col-span-4">
        <Button type="submit" disabled={pending}>
          {pending ? 'Проведение…' : kind === 'REFUND' ? 'Вернуть' : 'Принять оплату'}
        </Button>
      </div>
    </form>
  );
}
