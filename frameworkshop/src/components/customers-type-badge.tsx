import { Badge, type BadgeTone } from '@/components/ui';

const CUSTOMER_TYPE: Record<string, { label: string; tone: BadgeTone }> = {
  PERSON: { label: 'Физлицо', tone: 'neutral' },
  ENTREPRENEUR: { label: 'ИП', tone: 'info' },
  COMPANY: { label: 'ООО', tone: 'accent' },
};

export function CustomerTypeBadge({ type }: { type: string }) {
  const entry = CUSTOMER_TYPE[type] ?? { label: type, tone: 'neutral' as BadgeTone };
  return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
