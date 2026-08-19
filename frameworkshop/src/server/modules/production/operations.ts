import type { CatalogGroup, ProductionStage } from '@/generated/prisma/client';

/** Canonical operation codes seeded into every organisation. */
export const OPERATION_CODES = {
  INSPECT: 'INSPECT',
  PREPARE_BASE: 'PREPARE_BASE',
  MOUNT: 'MOUNT',
  LAMINATE: 'LAMINATE',
  CUT_MAT: 'CUT_MAT',
  CUT_MOULDING: 'CUT_MOULDING',
  ASSEMBLE_FRAME: 'ASSEMBLE_FRAME',
  CUT_GLASS: 'CUT_GLASS',
  CLEAN_GLASS: 'CLEAN_GLASS',
  FIT_ARTWORK: 'FIT_ARTWORK',
  FIT_BACKING: 'FIT_BACKING',
  FIT_HARDWARE: 'FIT_HARDWARE',
  CLEAN: 'CLEAN',
  QC: 'QC',
  PHOTO: 'PHOTO',
  PACK: 'PACK',
} as const;

export type OperationCode = (typeof OPERATION_CODES)[keyof typeof OPERATION_CODES];

export interface OperationSeed {
  code: OperationCode;
  name: string;
  standardMinutes: number;
  minutesPerM2: number;
  payRatePerMinute: number;
  stage: ProductionStage;
  sortOrder: number;
}

/** Norms are a realistic starting point; every workshop tunes them later. */
export const DEFAULT_OPERATIONS: OperationSeed[] = [
  { code: 'INSPECT', name: 'Проверка изделия при приёмке', standardMinutes: 5, minutesPerM2: 0, payRatePerMinute: 800, stage: 'NEW', sortOrder: 10 },
  { code: 'PREPARE_BASE', name: 'Подготовка основы', standardMinutes: 8, minutesPerM2: 4, payRatePerMinute: 800, stage: 'MATERIALS_READY', sortOrder: 20 },
  { code: 'MOUNT', name: 'Натяжка', standardMinutes: 15, minutesPerM2: 10, payRatePerMinute: 900, stage: 'STRETCHING', sortOrder: 30 },
  { code: 'LAMINATE', name: 'Накатка', standardMinutes: 12, minutesPerM2: 12, payRatePerMinute: 900, stage: 'STRETCHING', sortOrder: 35 },
  { code: 'CUT_MAT', name: 'Резка паспарту', standardMinutes: 8, minutesPerM2: 6, payRatePerMinute: 1000, stage: 'MATTING', sortOrder: 40 },
  { code: 'CUT_MOULDING', name: 'Раскрой багета', standardMinutes: 10, minutesPerM2: 0, payRatePerMinute: 1000, stage: 'CUTTING', sortOrder: 50 },
  { code: 'ASSEMBLE_FRAME', name: 'Сборка и склейка рамы', standardMinutes: 20, minutesPerM2: 0, payRatePerMinute: 1000, stage: 'ASSEMBLY', sortOrder: 60 },
  { code: 'CUT_GLASS', name: 'Резка стекла', standardMinutes: 7, minutesPerM2: 5, payRatePerMinute: 1000, stage: 'GLAZING', sortOrder: 70 },
  { code: 'CLEAN_GLASS', name: 'Очистка стекла', standardMinutes: 5, minutesPerM2: 4, payRatePerMinute: 800, stage: 'GLAZING', sortOrder: 80 },
  { code: 'FIT_ARTWORK', name: 'Установка изображения и паспарту', standardMinutes: 10, minutesPerM2: 4, payRatePerMinute: 900, stage: 'ASSEMBLY', sortOrder: 90 },
  { code: 'FIT_BACKING', name: 'Установка задника', standardMinutes: 6, minutesPerM2: 3, payRatePerMinute: 800, stage: 'ASSEMBLY', sortOrder: 100 },
  { code: 'FIT_HARDWARE', name: 'Установка фурнитуры и подвеса', standardMinutes: 6, minutesPerM2: 0, payRatePerMinute: 800, stage: 'ASSEMBLY', sortOrder: 110 },
  { code: 'CLEAN', name: 'Финальная очистка', standardMinutes: 5, minutesPerM2: 2, payRatePerMinute: 700, stage: 'QUALITY_CONTROL', sortOrder: 120 },
  { code: 'QC', name: 'Контроль качества', standardMinutes: 6, minutesPerM2: 0, payRatePerMinute: 900, stage: 'QUALITY_CONTROL', sortOrder: 130 },
  { code: 'PHOTO', name: 'Фотография готового изделия', standardMinutes: 3, minutesPerM2: 0, payRatePerMinute: 700, stage: 'QUALITY_CONTROL', sortOrder: 140 },
  { code: 'PACK', name: 'Упаковка', standardMinutes: 7, minutesPerM2: 3, payRatePerMinute: 700, stage: 'DONE', sortOrder: 150 },
];

/**
 * Builds the tech card for a piece: which operations are actually required is
 * decided by the components the receptionist selected, not by a fixed list.
 */
export function techCardFor(groups: CatalogGroup[], options: { hasMounting?: boolean; hasLamination?: boolean } = {}): OperationCode[] {
  const present = new Set(groups);
  const card: OperationCode[] = ['INSPECT'];

  if (options.hasMounting || present.has('MOUNTING') || present.has('SUBFRAME')) {
    card.push('PREPARE_BASE', 'MOUNT');
  }
  if (options.hasLamination) card.push('LAMINATE');
  if (present.has('MATBOARD')) card.push('CUT_MAT');
  if (present.has('MOULDING')) card.push('CUT_MOULDING', 'ASSEMBLE_FRAME');
  if (present.has('GLAZING')) card.push('CUT_GLASS', 'CLEAN_GLASS');

  card.push('FIT_ARTWORK');
  if (present.has('BACKING')) card.push('FIT_BACKING');
  if (present.has('HARDWARE') || present.has('FITTING')) card.push('FIT_HARDWARE');

  card.push('CLEAN', 'QC', 'PHOTO', 'PACK');
  return card;
}

/** Mandatory checklist that gates the transition to «Готово». */
export const QUALITY_CHECKLIST: Array<{ code: string; label: string; required: boolean }> = [
  { code: 'DIMENSIONS', label: 'Размеры проверены', required: true },
  { code: 'GLASS_CLEAN', label: 'Стекло очищено', required: true },
  { code: 'GLASS_INTACT', label: 'Стекло без дефектов', required: true },
  { code: 'MAT_CLEAN', label: 'Паспарту без загрязнений', required: true },
  { code: 'MOULDING_INTACT', label: 'Багет без повреждений', required: true },
  { code: 'CORNERS', label: 'Углы соединены ровно', required: true },
  { code: 'ARTWORK_ALIGNED', label: 'Изображение установлено ровно', required: true },
  { code: 'BACKING', label: 'Задник установлен', required: true },
  { code: 'HARDWARE', label: 'Фурнитура установлена', required: true },
  { code: 'HANGER', label: 'Подвес проверен', required: true },
  { code: 'PHOTO', label: 'Изделие сфотографировано', required: true },
  { code: 'PACKED', label: 'Упаковка выполнена', required: false },
];
