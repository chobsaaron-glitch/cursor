import { toRoubles } from './money';
import { fromMm } from './units';

const moneyFormatter = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const numberFormatter = new Intl.NumberFormat('ru-RU', {
  maximumFractionDigits: 3,
});

/** 1_850_000 → "18 500,00 ₽" */
export function formatMoney(kopecks: number, withSymbol = true): string {
  const value = moneyFormatter.format(toRoubles(kopecks));
  return withSymbol ? `${value} ₽` : value;
}

/** Compact variant for dashboards: "18 500 ₽", "1,2 млн ₽" */
export function formatMoneyShort(kopecks: number): string {
  const roubles = toRoubles(kopecks);
  if (Math.abs(roubles) >= 1_000_000) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(roubles / 1_000_000)} млн ₽`;
  }
  if (Math.abs(roubles) >= 10_000) {
    return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(roubles)} ₽`;
  }
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(roubles)} ₽`;
}

export function formatNumber(value: number, digits = 2): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value);
}

export function formatQuantity(value: number): string {
  return numberFormatter.format(value);
}

export function formatPercent(value: number, digits = 1): string {
  return `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: digits }).format(value)} %`;
}

/** 650 × 850 мм */
export function formatSize(widthMm: number, heightMm: number, unit: 'mm' | 'cm' | 'in' = 'mm'): string {
  if (unit === 'mm') {
    return `${formatNumber(widthMm, 0)} × ${formatNumber(heightMm, 0)} мм`;
  }
  if (unit === 'cm') {
    return `${formatNumber(fromMm(widthMm, 'cm'), 1)} × ${formatNumber(fromMm(heightMm, 'cm'), 1)} см`;
  }
  return `${formatNumber(fromMm(widthMm, 'in'), 2)}" × ${formatNumber(fromMm(heightMm, 'in'), 2)}"`;
}

export function formatLength(mm: number): string {
  if (mm >= 1000) return `${formatNumber(mm / 1000, 3)} м`;
  return `${formatNumber(mm, 1)} мм`;
}

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const dateTimeFormatter = new Intl.DateTimeFormat('ru-RU', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export function formatDate(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

export function formatDateTime(value: Date | string | null | undefined): string {
  if (!value) return '—';
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return '—';
  return dateTimeFormatter.format(date);
}

export function formatMinutes(minutes: number): string {
  const total = Math.round(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest} мин`;
  if (rest === 0) return `${hours} ч`;
  return `${hours} ч ${rest} мин`;
}

export function formatCustomerName(customer: {
  type?: string;
  companyName?: string | null;
  lastName?: string | null;
  firstName?: string | null;
  middleName?: string | null;
}): string {
  if (customer.companyName) return customer.companyName;
  return [customer.lastName, customer.firstName, customer.middleName].filter(Boolean).join(' ') || 'Без имени';
}

export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '—';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11) {
    return `+${digits[0]} (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7, 9)}-${digits.slice(9)}`;
  }
  return phone;
}
