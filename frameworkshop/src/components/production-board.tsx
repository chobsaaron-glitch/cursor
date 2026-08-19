'use client';

/**
 * Production kanban. Cards are moved with native HTML5 drag-and-drop on a
 * desktop; every card also carries a <select> so the same move works on a
 * tablet where dragging is unreliable.
 */

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, GripVertical, Loader2, User } from 'lucide-react';
import { Badge, Card, Select, cn } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatDate, formatMoney, formatSize } from '@/lib/format';
import { PRIORITY, labelOf } from '@/lib/statuses';

export interface ProductionBoardCard {
  /** ProductionOrder id — the thing the API moves. */
  id: string;
  number: string;
  stage: string;
  workItemId: string;
  workItemNumber: string;
  orderNumber: string;
  title: string;
  customerName: string;
  /** ISO string; null when no due date was agreed. */
  dueDate: string | null;
  priority: string;
  price: number;
  widthMm: number;
  heightMm: number;
  masterName: string | null;
  tasksDone: number;
  tasksTotal: number;
  isOverdue: boolean;
}

export interface ProductionBoardColumn {
  stage: string;
  label: string;
  cards: ProductionBoardCard[];
}

export function ProductionBoard({
  columns,
  canManage,
}: {
  columns: ProductionBoardColumn[];
  canManage: boolean;
}) {
  const router = useRouter();
  // Card id → stage it was just dropped on, so the card jumps immediately and
  // does not wait for the server round-trip.
  const [moved, setMoved] = useState<Record<string, string>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropStage, setDropStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const dragged = useRef<string | null>(null);

  // Fresh server data has arrived — the local overrides are now redundant.
  useEffect(() => {
    setMoved({});
  }, [columns]);

  const allCards = columns.flatMap((column) => column.cards);
  const stageOf = (card: ProductionBoardCard) => moved[card.id] ?? card.stage;

  async function move(cardId: string, stage: string) {
    const card = allCards.find((entry) => entry.id === cardId);
    if (!card || stageOf(card) === stage) return;

    setMoved((current) => ({ ...current, [cardId]: stage }));
    setPendingId(cardId);
    setError(null);
    try {
      await api.post('/api/production', { productionOrderId: cardId, stage });
      router.refresh();
    } catch (cause) {
      setMoved((current) => {
        const next = { ...current };
        delete next[cardId];
        return next;
      });
      setError(
        cause instanceof ApiError ? cause.message : 'Не удалось изменить этап производства.',
      );
    } finally {
      setPendingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? (
        <div
          className="flex items-start gap-2 rounded-card border border-danger/30 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{error}</span>
        </div>
      ) : null}

      <div className="-mx-5 overflow-x-auto px-5 pb-4 lg:-mx-8 lg:px-8">
        <div className="flex min-w-max gap-4">
          {columns.map((column) => {
            const cards = allCards.filter((card) => stageOf(card) === column.stage);
            const active = dropStage === column.stage;

            return (
              <section
                key={column.stage}
                onDragOver={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  event.dataTransfer.dropEffect = 'move';
                  setDropStage(column.stage);
                }}
                onDragLeave={() => setDropStage((current) => (current === column.stage ? null : current))}
                onDrop={(event) => {
                  if (!canManage) return;
                  event.preventDefault();
                  const id = event.dataTransfer.getData('text/plain') || dragged.current;
                  setDropStage(null);
                  setDraggingId(null);
                  dragged.current = null;
                  if (id) void move(id, column.stage);
                }}
                className={cn(
                  'flex w-72 shrink-0 flex-col rounded-card border bg-surface-muted/60 transition-colors',
                  active ? 'border-accent bg-accent-soft/50' : 'border-line',
                )}
              >
                <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                  <h2 className="text-sm font-medium text-ink">{column.label}</h2>
                  <span className="rounded-md bg-surface px-2 py-0.5 text-xs font-medium text-ink-muted tabular">
                    {cards.length}
                  </span>
                </header>

                <div className="flex flex-1 flex-col gap-2 p-2">
                  {cards.length === 0 ? (
                    <p className="px-2 py-6 text-center text-xs text-ink-subtle">Пусто</p>
                  ) : (
                    cards.map((card) => (
                      <BoardCardView
                        key={card.id}
                        card={card}
                        stage={stageOf(card)}
                        columns={columns}
                        canManage={canManage}
                        pending={pendingId === card.id}
                        dragging={draggingId === card.id}
                        onDragStart={(event) => {
                          dragged.current = card.id;
                          setDraggingId(card.id);
                          event.dataTransfer.setData('text/plain', card.id);
                          event.dataTransfer.effectAllowed = 'move';
                        }}
                        onDragEnd={() => {
                          setDraggingId(null);
                          setDropStage(null);
                          dragged.current = null;
                        }}
                        onStageSelect={(stage) => void move(card.id, stage)}
                      />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function BoardCardView({
  card,
  stage,
  columns,
  canManage,
  pending,
  dragging,
  onDragStart,
  onDragEnd,
  onStageSelect,
}: {
  card: ProductionBoardCard;
  stage: string;
  columns: ProductionBoardColumn[];
  canManage: boolean;
  pending: boolean;
  dragging: boolean;
  onDragStart: (event: React.DragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onStageSelect: (stage: string) => void;
}) {
  const priority = labelOf(PRIORITY, card.priority);

  return (
    <Card
      draggable={canManage}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      className={cn(
        'p-3 transition-opacity',
        canManage ? 'cursor-grab active:cursor-grabbing' : '',
        dragging ? 'opacity-40' : '',
        pending ? 'opacity-60' : '',
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/production/${card.workItemId}`}
          className="text-sm font-medium text-ink hover:text-accent hover:underline"
        >
          {card.workItemNumber}
        </Link>
        <div className="flex items-center gap-1">
          {pending ? <Loader2 className="size-3.5 animate-spin text-ink-subtle" /> : null}
          {card.priority === 'NORMAL' ? null : (
            <Badge tone={priority.tone}>{priority.label}</Badge>
          )}
          {canManage ? <GripVertical className="size-4 text-ink-subtle" aria-hidden /> : null}
        </div>
      </div>

      <p className="mt-1 line-clamp-2 text-sm text-ink">{card.title}</p>
      <p className="mt-0.5 text-xs text-ink-muted">{card.customerName}</p>

      <dl className="mt-2 space-y-1 text-xs text-ink-muted">
        <div className="flex justify-between gap-2">
          <dt>Размер</dt>
          <dd className="tabular text-ink">{formatSize(card.widthMm, card.heightMm)}</dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Срок</dt>
          <dd className={cn('tabular', card.isOverdue ? 'font-medium text-danger' : 'text-ink')}>
            {formatDate(card.dueDate)}
          </dd>
        </div>
        <div className="flex justify-between gap-2">
          <dt>Стоимость</dt>
          <dd className="tabular text-ink">{formatMoney(card.price)}</dd>
        </div>
      </dl>

      <div className="mt-2 flex items-center justify-between gap-2 border-t border-line pt-2 text-xs text-ink-muted">
        <span className="inline-flex min-w-0 items-center gap-1">
          <User className="size-3.5 shrink-0" aria-hidden />
          <span className="truncate">{card.masterName ?? 'Мастер не назначен'}</span>
        </span>
        <span className="tabular whitespace-nowrap">
          {card.tasksDone}/{card.tasksTotal}
        </span>
      </div>

      {canManage ? (
        <Select
          aria-label={`Этап изделия ${card.workItemNumber}`}
          value={stage}
          disabled={pending}
          onChange={(event) => onStageSelect(event.target.value)}
          className="mt-2 h-9 text-xs"
        >
          {columns.map((column) => (
            <option key={column.stage} value={column.stage}>
              {column.label}
            </option>
          ))}
        </Select>
      ) : null}
    </Card>
  );
}
