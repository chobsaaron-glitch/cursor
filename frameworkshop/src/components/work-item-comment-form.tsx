'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';

export function WorkItemCommentForm({ workItemId }: { workItemId: string }) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!body.trim()) return;

    setPending(true);
    setError(null);
    try {
      await api.post(`/api/work-items/${workItemId}/comments`, { body: body.trim() });
      setBody('');
      router.refresh();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить комментарий.');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <Textarea
        rows={2}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        placeholder="Внутренний комментарий по изделию"
      />
      {error ? <p className="text-xs text-danger">{error}</p> : null}
      <Button type="submit" size="sm" disabled={pending || !body.trim()}>
        {pending ? 'Сохранение…' : 'Добавить'}
      </Button>
    </form>
  );
}
