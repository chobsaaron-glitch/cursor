'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardHeader, Field, Input, Textarea } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';
import { formatQuantity } from '@/lib/format';

type Mode = 'adjust' | 'writeoff';

export interface InventoryStockActionsProps {
  catalogItemId: string;
  name: string;
  unitLabel: string;
  quantityOnHand: number;
  canAdjust: boolean;
  canWriteOff: boolean;
}

/** Parses "12,5" and "12.5" alike — the counter enters quantities in Russian. */
function parseQuantity(value: string): number {
  return Number.parseFloat(value.replace(/\s/g, '').replace(',', '.'));
}

export function InventoryStockActions({
  catalogItemId,
  name,
  unitLabel,
  quantityOnHand,
  canAdjust,
  canWriteOff,
}: InventoryStockActionsProps) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode | null>(null);
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  if (!canAdjust && !canWriteOff) return null;

  function open(next: Mode) {
    setMode(next);
    setQuantity(next === 'adjust' ? String(quantityOnHand) : '');
    setNote('');
    setReason('');
    setError(null);
  }

  function close() {
    setMode(null);
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseQuantity(quantity);

    if (!Number.isFinite(parsed)) {
      setError('Укажите количество числом.');
      return;
    }
    if (mode === 'adjust' && parsed < 0) {
      setError('Остаток не может быть отрицательным.');
      return;
    }
    if (mode === 'writeoff') {
      if (parsed <= 0) {
        setError('Количество списания должно быть больше нуля.');
        return;
      }
      if (!reason.trim()) {
        setError('Укажите причину списания.');
        return;
      }
    }

    setPending(true);
    setError(null);
    try {
      if (mode === 'adjust') {
        await api.post('/api/inventory', {
          action: 'adjust',
          catalogItemId,
          newQuantity: parsed,
          note: note.trim() || undefined,
        });
      } else {
        await api.post('/api/inventory', {
          action: 'writeoff',
          catalogItemId,
          quantity: parsed,
          reason: reason.trim(),
        });
      }
      close();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось выполнить операцию.');
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex justify-end gap-1">
        {canAdjust ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => open('adjust')}>
            Корректировать
          </Button>
        ) : null}
        {canWriteOff ? (
          <Button type="button" variant="ghost" size="sm" onClick={() => open('writeoff')}>
            Списать
          </Button>
        ) : null}
      </div>

      {mode ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4"
          role="dialog"
          aria-modal="true"
        >
          <Card className="w-full max-w-md">
            <CardHeader
              title={mode === 'adjust' ? 'Корректировка остатка' : 'Списание материала'}
              description={`${name} · на складе ${formatQuantity(quantityOnHand)} ${unitLabel}`}
            />
            <form onSubmit={submit} className="space-y-4 p-5">
              {mode === 'adjust' ? (
                <>
                  <Field label={`Фактический остаток, ${unitLabel}`} hint="Разница будет записана в журнал движений.">
                    <Input
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      inputMode="decimal"
                      autoFocus
                    />
                  </Field>
                  <Field label="Комментарий">
                    <Textarea
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      rows={2}
                      placeholder="Например: результат инвентаризации"
                    />
                  </Field>
                </>
              ) : (
                <>
                  <Field label={`Количество к списанию, ${unitLabel}`}>
                    <Input
                      value={quantity}
                      onChange={(event) => setQuantity(event.target.value)}
                      inputMode="decimal"
                      autoFocus
                    />
                  </Field>
                  <Field label="Причина списания" hint="Обязательное поле.">
                    <Textarea
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                      rows={2}
                      placeholder="Например: брак материала"
                    />
                  </Field>
                </>
              )}

              {error ? <p className="text-sm text-danger">{error}</p> : null}

              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary" onClick={close} disabled={pending}>
                  Отмена
                </Button>
                <Button type="submit" variant={mode === 'writeoff' ? 'danger' : 'primary'} disabled={pending}>
                  {pending ? 'Сохранение…' : mode === 'adjust' ? 'Сохранить' : 'Списать'}
                </Button>
              </div>
            </form>
          </Card>
        </div>
      ) : null}
    </>
  );
}
