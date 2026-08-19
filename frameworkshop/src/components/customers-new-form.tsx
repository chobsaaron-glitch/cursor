'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';

const TYPE_OPTIONS: Array<{ value: CustomerTypeValue; label: string }> = [
  { value: 'PERSON', label: 'Физическое лицо' },
  { value: 'ENTREPRENEUR', label: 'ИП' },
  { value: 'COMPANY', label: 'ООО' },
];

type CustomerTypeValue = 'PERSON' | 'ENTREPRENEUR' | 'COMPANY';

export interface CustomerSourceOption {
  id: string;
  name: string;
}

/** Empty inputs must not reach the API as empty strings. */
function trimmed(value: string): string | undefined {
  const result = value.trim();
  return result ? result : undefined;
}

export function CustomersNewForm({
  sources,
  next,
}: {
  sources: CustomerSourceOption[];
  /** Where to continue after saving, e.g. back to the order being created. */
  next?: string;
}) {
  const router = useRouter();

  const [type, setType] = useState<CustomerTypeValue>('PERSON');
  const [lastName, setLastName] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [inn, setInn] = useState('');
  const [phone, setPhone] = useState('');
  const [phone2, setPhone2] = useState('');
  const [email, setEmail] = useState('');
  const [telegram, setTelegram] = useState('');
  const [address, setAddress] = useState('');
  const [city, setCity] = useState('');
  const [birthday, setBirthday] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [discountPercent, setDiscountPercent] = useState('0');
  const [note, setNote] = useState('');
  const [marketingConsent, setMarketingConsent] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const isCompany = type === 'COMPANY' || type === 'ENTREPRENEUR';

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});

    const discount = Number(discountPercent.replace(',', '.'));

    try {
      const created = await api.post<{ id: string }>('/api/customers', {
        type,
        lastName: trimmed(lastName),
        firstName: trimmed(firstName),
        middleName: trimmed(middleName),
        companyName: isCompany ? trimmed(companyName) : undefined,
        inn: isCompany ? trimmed(inn) : undefined,
        phone: phone.trim(),
        phone2: trimmed(phone2),
        email: trimmed(email),
        telegram: trimmed(telegram),
        address: trimmed(address),
        city: trimmed(city),
        birthDate: trimmed(birthday),
        sourceId: trimmed(sourceId),
        note: trimmed(note),
        marketingConsent,
        discountPercent: Number.isFinite(discount) ? discount : 0,
      });

      if (next && next.startsWith('/') && !next.startsWith('//')) {
        const separator = next.includes('?') ? '&' : '?';
        router.push(`${next}${separator}customerId=${encodeURIComponent(created.id)}`);
      } else {
        router.push(`/customers/${created.id}`);
      }
    } catch (cause) {
      if (cause instanceof ApiError) {
        setError(cause.message);
        setFieldErrors(cause.fieldErrors);
      } else {
        setError('Не удалось сохранить клиента.');
      }
      setPending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <Card>
        <CardHeader title="Основное" description="Тип клиента определяет обязательные реквизиты." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Тип клиента" error={fieldErrors.type}>
            <Select value={type} onChange={(event) => setType(toCustomerType(event.target.value))}>
              {TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>

          {isCompany ? (
            <>
              <Field label="Название компании" error={fieldErrors.companyName}>
                <Input
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  placeholder={type === 'COMPANY' ? 'ООО «Галерея»' : 'ИП Иванов И. И.'}
                />
              </Field>
              <Field label="ИНН" error={fieldErrors.inn}>
                <Input value={inn} onChange={(event) => setInn(event.target.value)} inputMode="numeric" />
              </Field>
            </>
          ) : null}

          <Field label="Фамилия" error={fieldErrors.lastName}>
            <Input value={lastName} onChange={(event) => setLastName(event.target.value)} />
          </Field>
          <Field label="Имя" error={fieldErrors.firstName}>
            <Input value={firstName} onChange={(event) => setFirstName(event.target.value)} />
          </Field>
          <Field label="Отчество" error={fieldErrors.middleName}>
            <Input value={middleName} onChange={(event) => setMiddleName(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="Контакты" description="Телефон обязателен — по нему клиент находится в поиске." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Телефон" error={fieldErrors.phone}>
            <Input
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
              placeholder="+7 (912) 345-67-89"
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </Field>
          <Field label="Доп. телефон" error={fieldErrors.phone2}>
            <Input
              value={phone2}
              onChange={(event) => setPhone2(event.target.value)}
              inputMode="tel"
            />
          </Field>
          <Field label="E-mail" error={fieldErrors.email}>
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
            />
          </Field>
          <Field label="Telegram" error={fieldErrors.telegram}>
            <Input
              value={telegram}
              onChange={(event) => setTelegram(event.target.value)}
              placeholder="@nickname"
            />
          </Field>
          <Field label="Город" error={fieldErrors.city}>
            <Input value={city} onChange={(event) => setCity(event.target.value)} />
          </Field>
          <Field label="Адрес" error={fieldErrors.address}>
            <Input value={address} onChange={(event) => setAddress(event.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader title="CRM" description="Источник и скидка влияют на аналитику и расчёт заказов." />
        <div className="grid gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Дата рождения" error={fieldErrors.birthDate}>
            <Input type="date" value={birthday} onChange={(event) => setBirthday(event.target.value)} />
          </Field>

          <Field label="Источник" error={fieldErrors.sourceId}>
            <Select value={sourceId} onChange={(event) => setSourceId(event.target.value)}>
              <option value="">Не указан</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Скидка, %" error={fieldErrors.discountPercent}>
            <Input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={discountPercent}
              onChange={(event) => setDiscountPercent(event.target.value)}
              className="tabular"
            />
          </Field>

          <Field label="Примечание" error={fieldErrors.note} className="sm:col-span-2 lg:col-span-3">
            <Textarea
              value={note}
              onChange={(event) => setNote(event.target.value)}
              rows={3}
              placeholder="Предпочтения по оформлению, особенности работы, договорённости"
            />
          </Field>

          <label className="flex items-start gap-2 text-sm text-ink-muted sm:col-span-2 lg:col-span-3">
            <input
              type="checkbox"
              checked={marketingConsent}
              onChange={(event) => setMarketingConsent(event.target.checked)}
              className="mt-0.5 size-4 accent-accent"
            />
            Согласие на коммуникации (рассылки, поздравления, напоминания)
          </label>
        </div>
      </Card>

      {error ? (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Сохранение…' : 'Создать клиента'}
        </Button>
        <Link
          href="/customers"
          className="text-sm text-ink-muted hover:text-ink"
          aria-disabled={pending}
        >
          Отмена
        </Link>
      </div>
    </form>
  );
}

function toCustomerType(value: string): CustomerTypeValue {
  return TYPE_OPTIONS.find((option) => option.value === value)?.value ?? 'PERSON';
}
