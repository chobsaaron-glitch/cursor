'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button, Card, CardHeader, Field, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatQuantity } from '@/lib/format';
import { UNIT } from '@/lib/statuses';

interface Shortage {
  name: string;
  unit: string;
  shortage: number;
}

export function OrderActions({
  orderId,
  commercialStatus,
  productionStatus,
  balance,
  issuedAt,
  canEdit,
  canIssue,
  canInvoice,
  hasInvoice,
  hasWorkItems,
}: {
  orderId: string;
  commercialStatus: string;
  productionStatus: string;
  balance: number;
  issuedAt: string | Date | null;
  canEdit: boolean;
  canIssue: boolean;
  canInvoice: boolean;
  hasInvoice: boolean;
  hasWorkItems: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shortages, setShortages] = useState<Shortage[]>([]);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [reason, setReason] = useState('');

  const canConfirm =
    canEdit && hasWorkItems && ['CALCULATION', 'QUOTE'].includes(commercialStatus);
  const canCancel =
    canEdit && commercialStatus !== 'CANCELLED' && productionStatus !== 'ISSUED';
  const canIssueOrder =
    canIssue && productionStatus === 'READY' && commercialStatus === 'CONFIRMED';
  const canClose =
    canEdit && Boolean(issuedAt) && balance <= 0 && commercialStatus !== 'CANCELLED';
  const canCreateInvoice = canInvoice && hasWorkItems && !hasInvoice && commercialStatus !== 'CANCELLED';

  if (!canConfirm && !canCancel && !canIssueOrder && !canClose && !canCreateInvoice) {
    return shortages.length > 0 ? <ShortageNotice shortages={shortages} /> : null;
  }

  async function run(action: 'confirm' | 'issue' | 'close', extra?: { reason?: string }) {
    setPending(action);
    setError(null);
    try {
      const result = await api.post<{ shortages?: Shortage[] }>(`/api/orders/${orderId}`, {
        action,
        ...extra,
      });
      if (action === 'confirm') setShortages(result.shortages ?? []);
      setCancelOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось выполнить действие.');
    } finally {
      setPending(null);
    }
  }

  async function cancel() {
    if (!reason.trim()) {
      setError('Укажите причину отмены.');
      return;
    }
    setPending('cancel');
    setError(null);
    try {
      await api.post(`/api/orders/${orderId}`, { action: 'cancel', reason: reason.trim() });
      setCancelOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось отменить заказ.');
    } finally {
      setPending(null);
    }
  }

  async function issueInvoice() {
    setPending('invoice');
    setError(null);
    try {
      await api.post('/api/invoices', { orderId });
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось выставить счёт.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {canConfirm ? (
          <Button onClick={() => run('confirm')} disabled={pending !== null}>
            {pending === 'confirm' ? 'Подтверждение…' : 'Подтвердить заказ'}
          </Button>
        ) : null}
        {canIssueOrder ? (
          <Button onClick={() => run('issue')} disabled={pending !== null}>
            {pending === 'issue' ? 'Выдача…' : 'Выдать клиенту'}
          </Button>
        ) : null}
        {canClose ? (
          <Button variant="secondary" onClick={() => run('close')} disabled={pending !== null}>
            {pending === 'close' ? 'Закрытие…' : 'Закрыть заказ'}
          </Button>
        ) : null}
        {canCreateInvoice ? (
          <Button variant="secondary" onClick={issueInvoice} disabled={pending !== null}>
            {pending === 'invoice' ? 'Формирование…' : 'Выставить счёт'}
          </Button>
        ) : null}
        {canCancel ? (
          <Button variant="danger" onClick={() => setCancelOpen(true)} disabled={pending !== null}>
            Отменить
          </Button>
        ) : null}
      </div>

      {error ? <p className="text-sm text-danger">{error}</p> : null}
      {shortages.length > 0 ? <ShortageNotice shortages={shortages} /> : null}

      {cancelOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-md">
            <CardHeader
              title="Отмена заказа"
              description="Материалы снимутся с резерва. Оплаты нужно возвращать отдельно."
            />
            <div className="space-y-4 p-5">
              <Field label="Причина">
                <Textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="Клиент отказался, ошибка в расчёте…"
                />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCancelOpen(false)} disabled={pending !== null}>
                  Назад
                </Button>
                <Button variant="danger" onClick={cancel} disabled={pending !== null}>
                  {pending === 'cancel' ? 'Отмена…' : 'Отменить заказ'}
                </Button>
              </div>
            </div>
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function ShortageNotice({ shortages }: { shortages: Shortage[] }) {
  return (
    <div className="rounded-lg bg-warning-soft px-4 py-3 text-sm text-warning">
      <p className="font-medium">Не хватает материалов — заказ подтверждён, закупка нужна отдельно.</p>
      <ul className="mt-2 list-disc space-y-0.5 pl-4">
        {shortages.map((line) => (
          <li key={`${line.name}-${line.shortage}`}>
            {line.name}: {formatQuantity(line.shortage)} {UNIT[line.unit] ?? line.unit}
          </li>
        ))}
      </ul>
    </div>
  );
}
