'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Badge, Button, Card, CardHeader, Field, Input, Select, Textarea } from '@/components/ui';
import { ApiError, api } from '@/lib/api-client';
import { formatMoney, formatPercent, formatQuantity, formatSize } from '@/lib/format';
import { CATALOG_GROUP, UNIT } from '@/lib/statuses';
import { toMm } from '@/lib/units';
import type { FramingSpec, MatLayerSpec, MountingMethod } from '@/server/modules/framing/types';
import type { CalculationResult } from '@/server/modules/framing/types';

export interface CatalogOption {
  id: string;
  group: string;
  name: string;
  sku: string;
  unit: string;
  color: string | null;
  material: string | null;
  widthMm: number | null;
  costPrice: number | null;
  available: number;
}

export interface SpecTemplate {
  id: string;
  name: string;
  description: string | null;
  workType: string | null;
  payload: Partial<FramingSpec>;
}

interface PreviewComponent {
  group: string;
  name: string;
  quantity: number;
  unit: string;
  price: number;
  cost?: number;
}

interface PreviewResponse {
  calculation: CalculationResult;
  components: PreviewComponent[];
  totals: {
    subtotal: number;
    discountAmount: number;
    taxAmount: number;
    price: number;
    totalCost?: number;
    margin?: number;
    marginPercent?: number;
  };
}

const MOUNTING_METHODS: Array<{ value: MountingMethod; label: string }> = [
  { value: 'NONE', label: 'Без натяжки' },
  { value: 'HINGE', label: 'На петли (музейный монтаж)' },
  { value: 'DRY_MOUNT', label: 'Сухой монтаж' },
  { value: 'FOAM_MOUNT', label: 'Накатка на пенокартон' },
  { value: 'STRETCH_MANUAL', label: 'Натяжка вручную' },
  { value: 'STRETCH_FOAM', label: 'Натяжка на пенокартон' },
  { value: 'STRETCH_SUBFRAME', label: 'Натяжка на подрамник' },
  { value: 'STRETCH_GALLERY', label: 'Галерейная натяжка' },
  { value: 'FLOAT_MOUNT', label: 'Float mount' },
];

const GLAZING_POSITIONS = [
  { value: 'INNER', label: 'Внутри внутреннего багета' },
  { value: 'BETWEEN', label: 'Между багетами' },
  { value: 'OUTER', label: 'Внутри внешнего багета' },
] as const;

const UNITS = [
  { value: 'mm', label: 'мм' },
  { value: 'cm', label: 'см' },
  { value: 'in', label: 'дюймы' },
] as const;

const DEFAULT_MARGIN_MM = 70;

function emptyMat(layer: number): MatLayerSpec {
  return layer === 1
    ? {
        layer,
        catalogItemId: null,
        margins: {
          leftMm: DEFAULT_MARGIN_MM,
          rightMm: DEFAULT_MARGIN_MM,
          topMm: DEFAULT_MARGIN_MM,
          bottomMm: DEFAULT_MARGIN_MM + 15,
        },
      }
    : { layer, catalogItemId: null, revealMm: 5 };
}

export function WorkItemConstructor({
  orderId,
  options,
  templates,
  canSeeCost,
  maxDiscountPercent,
}: {
  orderId: string;
  options: CatalogOption[];
  templates: SpecTemplate[];
  canSeeCost: boolean;
  maxDiscountPercent: number;
}) {
  const router = useRouter();

  const byGroup = useMemo(() => {
    const map = new Map<string, CatalogOption[]>();
    for (const option of options) {
      const list = map.get(option.group) ?? [];
      list.push(option);
      map.set(option.group, list);
    }
    return map;
  }, [options]);

  const [title, setTitle] = useState('');
  const [workType, setWorkType] = useState('');
  const [unit, setUnit] = useState<'mm' | 'cm' | 'in'>('mm');
  const [width, setWidth] = useState('400');
  const [height, setHeight] = useState('600');
  const [quantity, setQuantity] = useState(1);
  const [discountPercent, setDiscountPercent] = useState(0);
  const [notes, setNotes] = useState('');

  const [mats, setMats] = useState<MatLayerSpec[]>([]);
  const [innerMoulding, setInnerMoulding] = useState('');
  const [outerMoulding, setOuterMoulding] = useState('');
  const [glazingId, setGlazingId] = useState('');
  const [glazingPosition, setGlazingPosition] =
    useState<(typeof GLAZING_POSITIONS)[number]['value']>('INNER');
  const [backingId, setBackingId] = useState('');
  const [mountingMethod, setMountingMethod] = useState<MountingMethod>('NONE');
  const [mountingServiceId, setMountingServiceId] = useState('');
  const [mountingBoardId, setMountingBoardId] = useState('');
  const [subframeId, setSubframeId] = useState('');
  const [hardwareIds, setHardwareIds] = useState<string[]>([]);
  const [extraIds, setExtraIds] = useState<string[]>([]);

  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [calculating, setCalculating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const widthMm = toMm(Number(width.replace(',', '.')) || 0, unit);
  const heightMm = toMm(Number(height.replace(',', '.')) || 0, unit);

  const spec: FramingSpec = useMemo(
    () => ({
      artworkWidthMm: Math.round(widthMm),
      artworkHeightMm: Math.round(heightMm),
      mats: mats.filter((mat) => mat.catalogItemId),
      mouldings: [
        ...(innerMoulding
          ? [{ role: 'INNER' as const, catalogItemId: innerMoulding }]
          : []),
        ...(outerMoulding
          ? [{ role: 'OUTER' as const, catalogItemId: outerMoulding }]
          : []),
      ],
      glazing: glazingId
        ? { catalogItemId: glazingId, position: glazingPosition }
        : null,
      backing: backingId ? { catalogItemId: backingId } : null,
      mounting:
        mountingMethod === 'NONE'
          ? null
          : {
              method: mountingMethod,
              catalogItemId: mountingServiceId || null,
              boardCatalogItemId: mountingBoardId || null,
            },
      subframe: subframeId ? { catalogItemId: subframeId } : null,
      hardware: hardwareIds.map((id) => ({ catalogItemId: id })),
      extras: extraIds.map((id) => ({ catalogItemId: id })),
      notes: notes || undefined,
    }),
    [
      widthMm,
      heightMm,
      mats,
      innerMoulding,
      outerMoulding,
      glazingId,
      glazingPosition,
      backingId,
      mountingMethod,
      mountingServiceId,
      mountingBoardId,
      subframeId,
      hardwareIds,
      extraIds,
      notes,
    ],
  );

  // Debounced live preview. The server runs the same engines that will run on
  // save, so what the receptionist quotes is exactly what gets stored.
  const requestId = useRef(0);
  useEffect(() => {
    if (!spec.artworkWidthMm || !spec.artworkHeightMm) {
      setPreview(null);
      return;
    }
    if (!innerMoulding && !glazingId && mats.length === 0) {
      setPreview(null);
      return;
    }

    const id = ++requestId.current;
    const timer = setTimeout(async () => {
      setCalculating(true);
      try {
        const result = await api.post<PreviewResponse>('/api/pricing/calculate', {
          spec,
          quantity,
          discountPercent,
        });
        if (id === requestId.current) {
          setPreview(result);
          setPreviewError(null);
        }
      } catch (cause) {
        if (id === requestId.current) {
          setPreview(null);
          setPreviewError(
            cause instanceof ApiError ? cause.message : 'Не удалось рассчитать стоимость.',
          );
        }
      } finally {
        if (id === requestId.current) setCalculating(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [spec, quantity, discountPercent, innerMoulding, glazingId, mats.length]);

  function applyTemplate(templateId: string) {
    const template = templates.find((entry) => entry.id === templateId);
    if (!template) return;
    const payload = template.payload;

    setMats((payload.mats ?? []).map((mat) => ({ ...mat })));
    setInnerMoulding(
      payload.mouldings?.find((moulding) => moulding.role === 'INNER')?.catalogItemId ?? '',
    );
    setOuterMoulding(
      payload.mouldings?.find((moulding) => moulding.role === 'OUTER')?.catalogItemId ?? '',
    );
    setGlazingId(payload.glazing?.catalogItemId ?? '');
    setGlazingPosition(payload.glazing?.position ?? 'INNER');
    setBackingId(payload.backing?.catalogItemId ?? '');
    setMountingMethod(payload.mounting?.method ?? 'NONE');
    setMountingServiceId(payload.mounting?.catalogItemId ?? '');
    setMountingBoardId(payload.mounting?.boardCatalogItemId ?? '');
    setSubframeId(payload.subframe?.catalogItemId ?? '');
    setHardwareIds((payload.hardware ?? []).map((entry) => entry.catalogItemId));
    setExtraIds((payload.extras ?? []).map((entry) => entry.catalogItemId));
    if (!workType && template.workType) setWorkType(template.workType);
  }

  async function save() {
    setSaving(true);
    setSaveError(null);
    try {
      await api.post('/api/work-items', {
        orderId,
        title: title || `${workType || 'Изделие'} ${spec.artworkWidthMm}×${spec.artworkHeightMm}`,
        workType: workType || null,
        spec,
        quantity,
        discountPercent,
      });
      router.push(`/orders/${orderId}`);
      router.refresh();
    } catch (cause) {
      setSaveError(cause instanceof ApiError ? cause.message : 'Не удалось сохранить изделие.');
      setSaving(false);
    }
  }

  function optionList(group: string) {
    return byGroup.get(group) ?? [];
  }

  const calc = preview?.calculation;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="Изделие" description="Что оформляем и в каком размере." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Название" className="sm:col-span-2">
              <Input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="Например: Вышивка «Маки»"
              />
            </Field>

            <Field label="Тип работы">
              <Input
                value={workType}
                onChange={(event) => setWorkType(event.target.value)}
                placeholder="Картина, вышивка, постер…"
              />
            </Field>

            <Field label="Шаблон оформления" hint="Заполняет конструкцию в один клик">
              <Select defaultValue="" onChange={(event) => applyTemplate(event.target.value)}>
                <option value="">Без шаблона</option>
                {templates.map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Ширина изображения">
              <Input
                value={width}
                onChange={(event) => setWidth(event.target.value)}
                inputMode="decimal"
              />
            </Field>

            <Field label="Высота изображения">
              <Input
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                inputMode="decimal"
              />
            </Field>

            <Field label="Единицы измерения">
              <Select
                value={unit}
                onChange={(event) => setUnit(event.target.value as typeof unit)}
              >
                {UNITS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Количество">
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(event) => setQuantity(Math.max(1, Number(event.target.value) || 1))}
              />
            </Field>

            {unit !== 'mm' ? (
              <p className="text-sm text-ink-subtle sm:col-span-2">
                В миллиметрах: {formatSize(Math.round(widthMm), Math.round(heightMm))}
              </p>
            ) : null}
          </div>
        </Card>

        <Card>
          <CardHeader
            title="Паспарту"
            description="До 7 слоёв. Поля задаются для верхнего слоя, нижние показываются как «выпуск»."
            action={
              mats.length < 7 ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => setMats([...mats, emptyMat(mats.length + 1)])}
                >
                  <Plus className="size-4" />
                  Слой
                </Button>
              ) : null
            }
          />
          {mats.length === 0 ? (
            <p className="px-5 py-6 text-sm text-ink-subtle">Без паспарту.</p>
          ) : (
            <div className="divide-y divide-line">
              {mats.map((mat, index) => (
                <div key={mat.layer} className="grid gap-4 p-5 sm:grid-cols-2">
                  <div className="flex items-center justify-between sm:col-span-2">
                    <Badge tone="accent">Слой {mat.layer}</Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setMats(
                          mats
                            .filter((_, position) => position !== index)
                            .map((entry, position) => ({ ...entry, layer: position + 1 })),
                        )
                      }
                    >
                      <Trash2 className="size-4" />
                      Удалить
                    </Button>
                  </div>

                  <Field label="Материал" className="sm:col-span-2">
                    <Select
                      value={mat.catalogItemId ?? ''}
                      onChange={(event) =>
                        setMats(
                          mats.map((entry, position) =>
                            position === index
                              ? { ...entry, catalogItemId: event.target.value || null }
                              : entry,
                          ),
                        )
                      }
                    >
                      <option value="">Выберите паспарту</option>
                      {optionList('MATBOARD').map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name} · {option.sku}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {index === 0 ? (
                    <>
                      {(['topMm', 'bottomMm', 'leftMm', 'rightMm'] as const).map((side) => (
                        <Field
                          key={side}
                          label={
                            {
                              topMm: 'Поле сверху, мм',
                              bottomMm: 'Поле снизу, мм',
                              leftMm: 'Поле слева, мм',
                              rightMm: 'Поле справа, мм',
                            }[side]
                          }
                        >
                          <Input
                            type="number"
                            value={mat.margins?.[side] ?? DEFAULT_MARGIN_MM}
                            onChange={(event) =>
                              setMats(
                                mats.map((entry, position) =>
                                  position === index
                                    ? {
                                        ...entry,
                                        margins: {
                                          leftMm: entry.margins?.leftMm ?? DEFAULT_MARGIN_MM,
                                          rightMm: entry.margins?.rightMm ?? DEFAULT_MARGIN_MM,
                                          topMm: entry.margins?.topMm ?? DEFAULT_MARGIN_MM,
                                          bottomMm: entry.margins?.bottomMm ?? DEFAULT_MARGIN_MM,
                                          [side]: Number(event.target.value) || 0,
                                        },
                                      }
                                    : entry,
                                ),
                              )
                            }
                          />
                        </Field>
                      ))}
                    </>
                  ) : (
                    <Field label="Выпуск (reveal), мм">
                      <Input
                        type="number"
                        value={mat.revealMm ?? 5}
                        onChange={(event) =>
                          setMats(
                            mats.map((entry, position) =>
                              position === index
                                ? { ...entry, revealMm: Number(event.target.value) || 0 }
                                : entry,
                            ),
                          )
                        }
                      />
                    </Field>
                  )}

                  <label className="flex items-center gap-2 text-sm text-ink-muted">
                    <input
                      type="checkbox"
                      checked={mat.vGroove ?? false}
                      onChange={(event) =>
                        setMats(
                          mats.map((entry, position) =>
                            position === index
                              ? { ...entry, vGroove: event.target.checked }
                              : entry,
                          ),
                        )
                      }
                    />
                    V-groove (декоративная линия)
                  </label>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Багет" description="Внутренний обязателен, внешний — по желанию." />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Внутренний багет">
              <Select
                value={innerMoulding}
                onChange={(event) => setInnerMoulding(event.target.value)}
              >
                <option value="">Не выбран</option>
                {optionList('MOULDING').map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.widthMm ?? '?'} мм · остаток{' '}
                    {formatQuantity(option.available)} м
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Внешний багет">
              <Select
                value={outerMoulding}
                onChange={(event) => setOuterMoulding(event.target.value)}
              >
                <option value="">Без второго багета</option>
                {optionList('MOULDING').map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name} · {option.widthMm ?? '?'} мм
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Остекление и основа" />
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Стекло">
              <Select value={glazingId} onChange={(event) => setGlazingId(event.target.value)}>
                <option value="">Без стекла</option>
                {optionList('GLAZING').map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>

            {glazingId && outerMoulding ? (
              <Field label="Расположение стекла">
                <Select
                  value={glazingPosition}
                  onChange={(event) =>
                    setGlazingPosition(event.target.value as typeof glazingPosition)
                  }
                >
                  {GLAZING_POSITIONS.map((entry) => (
                    <option key={entry.value} value={entry.value}>
                      {entry.label}
                    </option>
                  ))}
                </Select>
              </Field>
            ) : null}

            <Field label="Задник">
              <Select value={backingId} onChange={(event) => setBackingId(event.target.value)}>
                <option value="">Без задника</option>
                {optionList('BACKING').map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Натяжка / накатка">
              <Select
                value={mountingMethod}
                onChange={(event) => setMountingMethod(event.target.value as MountingMethod)}
              >
                {MOUNTING_METHODS.map((entry) => (
                  <option key={entry.value} value={entry.value}>
                    {entry.label}
                  </option>
                ))}
              </Select>
            </Field>

            {mountingMethod !== 'NONE' ? (
              <>
                <Field label="Услуга натяжки">
                  <Select
                    value={mountingServiceId}
                    onChange={(event) => setMountingServiceId(event.target.value)}
                  >
                    <option value="">Не выбрана</option>
                    {optionList('SERVICE').map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>

                <Field label="Основа для накатки">
                  <Select
                    value={mountingBoardId}
                    onChange={(event) => setMountingBoardId(event.target.value)}
                  >
                    <option value="">Без основы</option>
                    {optionList('MOUNTING').map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </>
            ) : null}

            <Field label="Подрамник">
              <Select value={subframeId} onChange={(event) => setSubframeId(event.target.value)}>
                <option value="">Без подрамника</option>
                {optionList('SUBFRAME').map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </Card>

        <Card>
          <CardHeader title="Фурнитура и дополнительные услуги" />
          <div className="grid gap-6 p-5 sm:grid-cols-2">
            <div>
              <p className="mb-2 text-sm text-ink-muted">Фурнитура</p>
              <div className="space-y-1.5">
                {optionList('HARDWARE').map((option) => (
                  <label key={option.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={hardwareIds.includes(option.id)}
                      onChange={(event) =>
                        setHardwareIds(
                          event.target.checked
                            ? [...hardwareIds, option.id]
                            : hardwareIds.filter((id) => id !== option.id),
                        )
                      }
                    />
                    {option.name}
                  </label>
                ))}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm text-ink-muted">Дополнительные операции</p>
              <div className="space-y-1.5">
                {optionList('EXTRA').map((option) => (
                  <label key={option.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={extraIds.includes(option.id)}
                      onChange={(event) =>
                        setExtraIds(
                          event.target.checked
                            ? [...extraIds, option.id]
                            : extraIds.filter((id) => id !== option.id),
                        )
                      }
                    />
                    {option.name}
                  </label>
                ))}
              </div>
            </div>

            <Field label="Комментарий к изделию" className="sm:col-span-2">
              <Textarea
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Пожелания клиента, особенности предмета…"
              />
            </Field>
          </div>
        </Card>
      </div>

      <div className="xl:sticky xl:top-6 xl:self-start">
        <Card>
          <CardHeader
            title="Расчёт"
            description={calculating ? 'Пересчитываем…' : 'Обновляется автоматически'}
          />

          <div className="space-y-4 p-5">
            {previewError ? (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
                {previewError}
              </p>
            ) : null}

            {calc ? (
              <dl className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Изображение</dt>
                  <dd className="tabular">
                    {formatSize(calc.artwork.widthMm, calc.artwork.heightMm)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-ink-muted">Раскрой паспарту/стекла</dt>
                  <dd className="tabular">
                    {formatSize(calc.sandwich.widthMm, calc.sandwich.heightMm)}
                  </dd>
                </div>
                <div className="flex justify-between font-medium">
                  <dt>Габарит рамы</dt>
                  <dd className="tabular">
                    {formatSize(calc.outer.widthMm, calc.outer.heightMm)}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="text-sm text-ink-subtle">
                Укажите размер и выберите хотя бы багет, паспарту или стекло.
              </p>
            )}

            {preview ? (
              <>
                <div className="border-t border-line pt-3">
                  <table className="w-full text-xs">
                    <tbody>
                      {preview.components.map((component, index) => (
                        <tr key={`${component.name}-${index}`}>
                          <td className="py-1 pr-2 align-top">
                            <p className="text-ink">{component.name}</p>
                            <p className="text-ink-subtle">
                              {CATALOG_GROUP[component.group] ?? component.group} ·{' '}
                              {formatQuantity(component.quantity)}{' '}
                              {UNIT[component.unit] ?? component.unit}
                            </p>
                          </td>
                          <td className="py-1 text-right align-top tabular whitespace-nowrap">
                            {formatMoney(component.price)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {maxDiscountPercent > 0 ? (
                  <Field label={`Скидка, % (до ${maxDiscountPercent})`}>
                    <Input
                      type="number"
                      min={0}
                      max={maxDiscountPercent}
                      value={discountPercent}
                      onChange={(event) =>
                        setDiscountPercent(
                          Math.min(maxDiscountPercent, Math.max(0, Number(event.target.value) || 0)),
                        )
                      }
                    />
                  </Field>
                ) : null}

                <dl className="space-y-1 border-t border-line pt-3 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-ink-muted">Сумма</dt>
                    <dd className="tabular">{formatMoney(preview.totals.subtotal)}</dd>
                  </div>
                  {preview.totals.discountAmount > 0 ? (
                    <div className="flex justify-between text-warning">
                      <dt>Скидка</dt>
                      <dd className="tabular">−{formatMoney(preview.totals.discountAmount)}</dd>
                    </div>
                  ) : null}
                  {preview.totals.taxAmount > 0 ? (
                    <div className="flex justify-between">
                      <dt className="text-ink-muted">НДС</dt>
                      <dd className="tabular">{formatMoney(preview.totals.taxAmount)}</dd>
                    </div>
                  ) : null}
                  <div className="flex justify-between text-lg font-semibold">
                    <dt>Итого</dt>
                    <dd className="tabular">{formatMoney(preview.totals.price)}</dd>
                  </div>

                  {canSeeCost && preview.totals.totalCost != null ? (
                    <div className="mt-2 space-y-1 border-t border-line pt-2 text-xs">
                      <div className="flex justify-between text-ink-muted">
                        <dt>Себестоимость</dt>
                        <dd className="tabular">{formatMoney(preview.totals.totalCost)}</dd>
                      </div>
                      <div className="flex justify-between text-positive">
                        <dt>Прибыль</dt>
                        <dd className="tabular">
                          {formatMoney(preview.totals.margin ?? 0)} ·{' '}
                          {formatPercent(preview.totals.marginPercent ?? 0)}
                        </dd>
                      </div>
                    </div>
                  ) : null}
                </dl>
              </>
            ) : null}

            {saveError ? (
              <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{saveError}</p>
            ) : null}

            <Button
              className="w-full"
              size="lg"
              onClick={save}
              disabled={saving || !preview}
            >
              {saving ? 'Сохраняем…' : 'Добавить в заказ'}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
