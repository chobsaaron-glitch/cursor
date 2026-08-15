'use client';

/**
 * Start/finish buttons for a single tech-card operation. Used both on the
 * master's task list and inside the production card, so the touch target stays
 * the same wherever the master taps it.
 */

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Play } from 'lucide-react';
import { Button, Textarea, cn } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatMinutes } from '@/lib/format';

/** Live "running for N minutes" label; rendered only after hydration. */
export function ProductionRunningTimer({
  since,
  className,
}: {
  since: string;
  className?: string;
}) {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  if (now === null) return null;

  const minutes = Math.max(0, (now - new Date(since).getTime()) / 60_000);
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md bg-info-soft px-2 py-1 text-xs font-medium text-info',
        className,
      )}
    >
      <span className="size-1.5 animate-pulse rounded-full bg-info" aria-hidden />
      Идёт {formatMinutes(minutes)}
    </span>
  );
}

export function ProductionTaskActions({
  taskId,
  status,
  disabled = false,
  withNote = false,
  size = 'lg',
  className,
}: {
  taskId: string;
  status: string;
  /** No `production.execute` permission — buttons are shown but inert. */
  disabled?: boolean;
  withNote?: boolean;
  size?: 'md' | 'lg';
  className?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<'start' | 'finish' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [noteOpen, setNoteOpen] = useState(false);

  if (status === 'DONE' || status === 'SKIPPED') return null;

  async function run(action: 'start' | 'finish') {
    setBusy(action);
    setError(null);
    try {
      await api.post(`/api/production/tasks/${taskId}`, {
        action,
        ...(action === 'finish' && note.trim() ? { note: note.trim() } : {}),
      });
      setNote('');
      setNoteOpen(false);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось выполнить операцию.');
    } finally {
      setBusy(null);
    }
  }

  const running = status === 'IN_PROGRESS';

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {withNote && noteOpen ? (
        <Textarea
          rows={2}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Комментарий к операции (необязательно)"
          maxLength={500}
          className="min-w-56"
        />
      ) : null}

      <div className="flex flex-wrap gap-2">
        {running ? (
          <>
            <Button
              size={size}
              variant="primary"
              disabled={disabled || busy !== null}
              onClick={() => run('finish')}
            >
              {busy === 'finish' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Check className="size-4" />
              )}
              Завершить
            </Button>
            {withNote && !noteOpen ? (
              <Button size={size} variant="ghost" onClick={() => setNoteOpen(true)}>
                Комментарий
              </Button>
            ) : null}
          </>
        ) : (
          <Button
            size={size}
            variant="secondary"
            disabled={disabled || busy !== null}
            onClick={() => run('start')}
          >
            {busy === 'start' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
            Начать
          </Button>
        )}
      </div>

      {disabled ? (
        <p className="text-xs text-ink-subtle">Нет прав на выполнение операций.</p>
      ) : null}

      {error ? (
        <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
