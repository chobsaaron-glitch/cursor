/**
 * Internal notifications plus the outbound channel abstraction.
 *
 * Nothing here knows about a concrete SMS or messenger vendor: a provider is
 * resolved by name from the environment, so swapping one out is a config change.
 */

import type { NotificationType } from '@/generated/prisma/client';
import { prisma, type Db } from '@/server/db';

export interface NotificationInput {
  organizationId: string;
  userId?: string | null;
  type: NotificationType;
  title: string;
  body?: string | null;
  entityType?: string | null;
  entityId?: string | null;
}

export async function notify(db: Db, input: NotificationInput) {
  return db.notification.create({
    data: {
      organizationId: input.organizationId,
      userId: input.userId ?? null,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
    },
  });
}

export async function listNotifications(organizationId: string, userId: string, unreadOnly = false) {
  return prisma.notification.findMany({
    where: {
      organizationId,
      OR: [{ userId }, { userId: null }],
      ...(unreadOnly ? { readAt: null } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markRead(organizationId: string, userId: string, ids?: string[]) {
  return prisma.notification.updateMany({
    where: {
      organizationId,
      OR: [{ userId }, { userId: null }],
      readAt: null,
      ...(ids && ids.length > 0 ? { id: { in: ids } } : {}),
    },
    data: { readAt: new Date() },
  });
}

// ---------------------------------------------------------------------------
// Outbound channels
// ---------------------------------------------------------------------------

export type NotificationChannel = 'email' | 'sms' | 'telegram' | 'whatsapp';

export interface OutboundMessage {
  to: string;
  subject?: string;
  body: string;
}

export interface NotificationProvider {
  readonly name: string;
  readonly channel: NotificationChannel;
  send(message: OutboundMessage): Promise<{ delivered: boolean; reference?: string }>;
}

/** Default provider: records the message instead of calling a paid API. */
class ConsoleProvider implements NotificationProvider {
  constructor(
    readonly channel: NotificationChannel,
    readonly name = 'console',
  ) {}

  async send(message: OutboundMessage) {
    const reference = `console-${this.channel}-${Date.now()}`;
    // eslint-disable-next-line no-console
    console.info(`[${this.channel}] → ${message.to}: ${message.body}`);
    return { delivered: true, reference };
  }
}

class TelegramBotProvider implements NotificationProvider {
  readonly name = 'telegram-bot';
  readonly channel: NotificationChannel = 'telegram';

  constructor(private readonly token: string) {}

  async send(message: OutboundMessage) {
    const response = await fetch(`https://api.telegram.org/bot${this.token}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: message.to, text: message.body }),
    });
    return { delivered: response.ok, reference: response.ok ? undefined : String(response.status) };
  }
}

const providerCache = new Map<NotificationChannel, NotificationProvider>();

export function resolveProvider(channel: NotificationChannel): NotificationProvider {
  const cached = providerCache.get(channel);
  if (cached) return cached;

  const driver = process.env[`NOTIFY_${channel.toUpperCase()}_DRIVER`] ?? 'console';
  let provider: NotificationProvider;

  if (channel === 'telegram' && driver === 'bot' && process.env.TELEGRAM_BOT_TOKEN) {
    provider = new TelegramBotProvider(process.env.TELEGRAM_BOT_TOKEN);
  } else {
    provider = new ConsoleProvider(channel);
  }

  providerCache.set(channel, provider);
  return provider;
}

export async function sendToCustomer(
  channel: NotificationChannel,
  message: OutboundMessage,
): Promise<{ delivered: boolean; provider: string }> {
  const provider = resolveProvider(channel);
  const result = await provider.send(message);
  return { delivered: result.delivered, provider: provider.name };
}
