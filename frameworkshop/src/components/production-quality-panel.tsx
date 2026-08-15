'use client';

/**
 * Quality checklist for one work item: tick the points, close the check, then
 * move the piece to «Готово». The server refuses the last step until the
 * required points are ticked — that refusal is shown here verbatim.
 */

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, CheckCircle2, Loader2, XCircle } from 'lucide-react';
import { Badge, Button, Textarea, cn } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';

export interface ProductionQualityItem {
  id: string;
  label: string;
  required: boolean;
  checked: boolean;
  note: string | null;
}

const RESULT_LABELS: Record<string, { label: string; tone: 'neutral' | 'positive' | 'danger' }> = {
  PENDING: { label: 'Не проведён', tone: 'neutral' },
  PASSED: { label: 'Пройден', tone: 'positive' },
  FAILED: { label: 'Брак', tone: 'danger' },
};

export function ProductionQualityPanel({
  qualityCheckId,
  items,
  result,
  checkedAt,
  workItemId,
  workItemStatus,
  canQuality,
  canFinish,
}: {
  qualityCheckId: string;
  items: ProductionQualityItem[];
  result: string;
  /** ISO string of when the check was closed. */
  checkedAt: string | null;
  workItemId: string;
  workItemStatus: string;
  canQuality: boolean;
  /** `orders.edit` — required by the API that moves the item to «Готово». */
  canFinish: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');

  const status = RESULT_LABELS[result] ?? { label: result, tone: 'neutral' as const };
  const requiredLeft = items.filter((item) => item.required && !item.checked).length;
  const passed = result === 'PASSED';
  const alreadyReady = ['READY', 'ISSUED', 'CLOSED'].includes(workItemStatus);

  async function call(key: string, body: unknown) {
    setBusy(key);
    setError(null);
    try {
      await api.post(`/api/production/quality/${qualityCheckId}`, body);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить контроль качества.');
    } finally {
      setBusy(null);
    }
  }

  async function markReady() {
    setBusy('ready');
    setError(null);
    try {
      await api.post(`/api/work-items/${workItemId}`, { status: 'READY' });
      router.refresh();
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : 'Не удалось перевести изделие в «Готово».',
      );
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={status.tone}>{status.label}</Badge>
        {checkedAt ? (
          <span className="text-sm text-ink-muted">Проверено {formatDateTime(checkedAt)}</span>
        ) : (
          <span className="text-sm text-ink-muted">
            {requiredLeft > 0
              ? `Осталось обязательных пунктов: ${requiredLeft}`
              : 'Все обязательные пункты отмечены'}
          </span>
        )}
      </div>

      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id}>
            <label
              className={cn(
                'flex cursor-pointer items-start gap-3 rounded-card border px-4 py-3 transition-colors',
                item.checked ? 'border-positive/40 bg-positive-soft' : 'border-line bg-surface',
                canQuality ? 'hover:border-line-strong' : 'cursor-default',
              )}
            >
              <input
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-[var(--color-accent)]"
                checked={item.checked}
                disabled={!canQuality || busy !== null}
                onChange={(event) =>
                  void call(item.id, { itemId: item.id, checked: event.target.checked })
                }
              />
              <span className="min-w-0">
                <span className="block text-base text-ink">{item.label}</span>
                {item.required ? (
                  <span className="mt-0.5 block text-xs text-ink-subtle">Обязательный пункт</span>
                ) : null}
                {item.note ? (
                  <span className="mt-0.5 block text-xs text-ink-muted">{item.note}</span>
                ) : null}
              </span>
              {busy === item.id ? (
                <Loader2 className="ml-auto size-4 animate-spin text-ink-subtle" />
              ) : null}
            </label>
          </li>
        ))}
      </ul>

      {canQuality && !passed ? (
        <Textarea
          rows={2}
          value={note}
          maxLength={500}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Замечание по качеству (необязательно)"
        />
      ) : null}

      <div className="flex flex-wrap gap-3">
        {canQuality && !passed ? (
          <>
            <Button
              size="lg"
              disabled={busy !== null}
              onClick={() => void call('passed', { result: 'PASSED', note: note.trim() || undefined })}
            >
              {busy === 'passed' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Контроль пройден
            </Button>
            <Button
              size="lg"
              variant="danger"
              disabled={busy !== null}
              onClick={() => void call('failed', { result: 'FAILED', note: note.trim() || undefined })}
            >
              {busy === 'failed' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <XCircle className="size-4" />
              )}
              Брак
            </Button>
          </>
        ) : null}

        {alreadyReady ? null : (
          <Button
            size="lg"
            variant={passed ? 'primary' : 'secondary'}
            disabled={busy !== null || !canFinish}
            onClick={() => void markReady()}
          >
            {busy === 'ready' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Check className="size-4" />
            )}
            Готово
          </Button>
        )}
      </div>

      {!canFinish && !alreadyReady ? (
        <p className="text-xs text-ink-subtle">
          Перевод изделия в «Готово» требует права на редактирование заказов.
        </p>
      ) : null}

      {error ? (
        <div
          className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}
    </div>
  );
}
