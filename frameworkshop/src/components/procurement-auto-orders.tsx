'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui';
import { api, ApiError } from '@/lib/api-client';

/** The endpoint answers with the purchase orders it created. */
interface CreatedPurchaseOrder {
  id: string;
  number: string;
}

function createdLabel(count: number): string {
  const rest = count % 100;
  if (rest >= 11 && rest <= 14) return `Создано ${count} заказов поставщикам.`;
  switch (count % 10) {
    case 1:
      return `Создан ${count} заказ поставщику.`;
    case 2:
    case 3:
    case 4:
      return `Создано ${count} заказа поставщикам.`;
    default:
      return `Создано ${count} заказов поставщикам.`;
  }
}

export function ProcurementAutoOrders({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const created = await api.post<CreatedPurchaseOrder[]>('/api/purchase-orders', { action: 'auto' });
      const count = Array.isArray(created) ? created.length : 0;
      setMessage(
        count === 0
          ? 'Новых заказов не создано: у дефицитных позиций не указан поставщик.'
          : createdLabel(count),
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Не удалось сформировать заказы.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="text-right">
      <Button type="button" onClick={run} disabled={pending || disabled}>
        {pending ? 'Формирование…' : 'Сформировать заказы поставщикам'}
      </Button>
      {message ? <p className="mt-2 text-xs text-positive">{message}</p> : null}
      {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
    </div>
  );
}
