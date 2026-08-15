/**
 * Russian labels and badge tones for every status the user sees. Kept in one
 * place so a status never renders as a raw enum name in some corner of the UI.
 */

import type { BadgeTone } from '@/components/ui';

type Entry = { label: string; tone: BadgeTone };

export const COMMERCIAL_STATUS: Record<string, Entry> = {
  CALCULATION: { label: 'Расчёт', tone: 'neutral' },
  QUOTE: { label: 'Коммерческое предложение', tone: 'info' },
  CONFIRMED: { label: 'Подтверждён', tone: 'accent' },
  CANCELLED: { label: 'Отменён', tone: 'danger' },
};

export const PRODUCTION_STATUS: Record<string, Entry> = {
  WAITING: { label: 'Ожидает', tone: 'neutral' },
  IN_PRODUCTION: { label: 'В производстве', tone: 'info' },
  READY: { label: 'Готов', tone: 'positive' },
  ISSUED: { label: 'Выдан', tone: 'neutral' },
};

export const PAYMENT_STATUS: Record<string, Entry> = {
  UNPAID: { label: 'Не оплачен', tone: 'danger' },
  PARTIAL: { label: 'Частично оплачен', tone: 'warning' },
  PAID: { label: 'Оплачен', tone: 'positive' },
  REFUNDED: { label: 'Возврат', tone: 'neutral' },
};

export const WORK_ITEM_STATUS: Record<string, Entry> = {
  DRAFT: { label: 'Черновик', tone: 'neutral' },
  ESTIMATE: { label: 'Расчёт', tone: 'neutral' },
  AWAITING_CONFIRMATION: { label: 'Ждёт подтверждения', tone: 'warning' },
  CONFIRMED: { label: 'Подтверждено', tone: 'accent' },
  AWAITING_MATERIALS: { label: 'Ждёт материалов', tone: 'warning' },
  MATERIALS_READY: { label: 'Материалы готовы', tone: 'info' },
  IN_PRODUCTION: { label: 'В производстве', tone: 'info' },
  QUALITY_CHECK: { label: 'Контроль качества', tone: 'warning' },
  READY: { label: 'Готово', tone: 'positive' },
  ISSUED: { label: 'Выдано', tone: 'neutral' },
  CLOSED: { label: 'Закрыто', tone: 'neutral' },
  CANCELLED: { label: 'Отменено', tone: 'danger' },
};

export const PRIORITY: Record<string, Entry> = {
  NORMAL: { label: 'Обычный', tone: 'neutral' },
  HIGH: { label: 'Высокий', tone: 'info' },
  URGENT: { label: 'Срочный', tone: 'warning' },
  CRITICAL: { label: 'Критический', tone: 'danger' },
};

export const PURCHASE_ORDER_STATUS: Record<string, Entry> = {
  DRAFT: { label: 'Черновик', tone: 'neutral' },
  SENT: { label: 'Отправлен', tone: 'info' },
  CONFIRMED: { label: 'Подтверждён', tone: 'accent' },
  PARTIALLY_RECEIVED: { label: 'Частично получен', tone: 'warning' },
  RECEIVED: { label: 'Получен', tone: 'positive' },
  CANCELLED: { label: 'Отменён', tone: 'danger' },
};

export const INVOICE_STATUS: Record<string, Entry> = {
  DRAFT: { label: 'Черновик', tone: 'neutral' },
  ISSUED: { label: 'Выставлен', tone: 'info' },
  PARTIALLY_PAID: { label: 'Частично оплачен', tone: 'warning' },
  PAID: { label: 'Оплачен', tone: 'positive' },
  OVERDUE: { label: 'Просрочен', tone: 'danger' },
  VOIDED: { label: 'Аннулирован', tone: 'neutral' },
};

export const PAYMENT_METHOD: Record<string, string> = {
  CASH: 'Наличные',
  CARD: 'Карта',
  TRANSFER: 'Перевод',
  SBP: 'СБП',
  BANK: 'Безналичный расчёт',
  OTHER: 'Другое',
};

export const CATALOG_GROUP: Record<string, string> = {
  MOULDING: 'Багет',
  MATBOARD: 'Паспарту',
  GLAZING: 'Стекло',
  BACKING: 'Задник',
  MOUNTING: 'Основа',
  FABRIC: 'Ткань',
  HARDWARE: 'Фурнитура',
  FITTING: 'Крепёж',
  EXTRA: 'Доп. услуги',
  LABOUR: 'Работа',
  SUPPLY: 'Расходники',
  SUBFRAME: 'Подрамник',
  PRINT: 'Печать',
  SERVICE: 'Услуга',
};

export const UNIT: Record<string, string> = {
  M: 'м',
  MM: 'мм',
  M2: 'м²',
  SHEET: 'лист',
  PIECE: 'шт.',
  LITRE: 'л',
  KG: 'кг',
  PACK: 'упак.',
  MINUTE: 'мин',
  HOUR: 'ч',
};

export const RESERVATION_STATUS: Record<string, Entry> = {
  ACTIVE: { label: 'Зарезервировано', tone: 'info' },
  RELEASED: { label: 'Снято', tone: 'neutral' },
  CONSUMED: { label: 'Списано', tone: 'positive' },
};

export const TASK_STATUS: Record<string, Entry> = {
  PENDING: { label: 'Ожидает', tone: 'neutral' },
  IN_PROGRESS: { label: 'В работе', tone: 'info' },
  DONE: { label: 'Выполнено', tone: 'positive' },
  SKIPPED: { label: 'Пропущено', tone: 'neutral' },
};

/** Falls back to the raw value so a new enum member is visible, not invisible. */
export function labelOf(map: Record<string, Entry>, key: string): Entry {
  return map[key] ?? { label: key, tone: 'neutral' };
}
