import { roubles } from '@/lib/money';
import type { PrismaClient } from '@/generated/prisma/client';
import { createRng, intBetween, pick } from './rng';

export interface CatalogSeedContext {
  organizationId: string;
  suppliers: Record<string, string>;
  priceRules: Record<string, string>;
  taxRateId: string | null;
  operations: Record<string, string>;
}

const MOULDING_COLLECTIONS = [
  'Классик',
  'Модерн',
  'Лофт',
  'Прованс',
  'Барокко',
  'Минимал',
  'Галерея',
  'Ампир',
  'Скандинавия',
  'Ретро',
];

const MOULDING_COLORS: Array<[string, string, string]> = [
  ['золото', '#c8a24a', 'дерево'],
  ['серебро', '#c0c4c9', 'дерево'],
  ['чёрный', '#1c1c1e', 'дерево'],
  ['белый', '#f4f2ee', 'дерево'],
  ['орех', '#6b4423', 'дерево'],
  ['венге', '#3b2a20', 'дерево'],
  ['дуб натуральный', '#b98d54', 'дерево'],
  ['махагон', '#7b2e21', 'дерево'],
  ['графит', '#4a4d52', 'алюминий'],
  ['бронза', '#9a6b3f', 'пластик'],
  ['слоновая кость', '#efe6d2', 'пластик'],
  ['серый камень', '#8b8d8f', 'пластик'],
];

const MOULDING_STYLES = ['классический', 'современный', 'винтажный', 'минималистичный', 'галерейный'];

const MAT_COLORS: Array<[string, string]> = [
  ['белоснежный', '#ffffff'],
  ['молочный', '#f7f3ea'],
  ['слоновая кость', '#efe6d2'],
  ['песочный', '#e2d3b4'],
  ['бежевый', '#ddcbb3'],
  ['светло-серый', '#d5d7d8'],
  ['серый', '#a9adb1'],
  ['графитовый', '#5c5f63'],
  ['чёрный', '#141414'],
  ['тёплый крем', '#f2e6cf'],
  ['лён', '#e6ddca'],
  ['оливковый', '#8d9166'],
  ['хаки', '#767b52'],
  ['бордовый', '#6d2230'],
  ['терракотовый', '#a8563c'],
  ['горчичный', '#c69a2c'],
  ['синий индиго', '#2f3f66'],
  ['голубой туман', '#9fb3c8'],
  ['изумрудный', '#1f5b4b'],
  ['мятный', '#a9cfc0'],
  ['пудровый', '#e5c5c0'],
  ['лавандовый', '#b2a5c4'],
  ['шоколадный', '#4c3226'],
  ['кофейный', '#6f5644'],
  ['золотой металлик', '#c8a24a'],
  ['серебряный металлик', '#c4c8cc'],
  ['антрацит', '#33363a'],
  ['экрю', '#efe4d0'],
];

export async function seedCatalog(prisma: PrismaClient, context: CatalogSeedContext) {
  const { organizationId, suppliers, priceRules, taxRateId } = context;
  const rng = createRng(20260815);

  const categories = await seedCategories(prisma, organizationId);

  // --- moulding ----------------------------------------------------------
  let mouldingIndex = 0;
  const mouldingIds: string[] = [];

  for (const collection of MOULDING_COLLECTIONS) {
    for (const [color, hex, material] of MOULDING_COLORS) {
      // 10 collections × 12 colours would be 120 articles; keep ~110 by
      // skipping a couple of implausible combinations.
      if (collection === 'Лофт' && material === 'дерево' && color === 'золото') continue;
      if (collection === 'Скандинавия' && color === 'барокко') continue;
      if (collection === 'Минимал' && color === 'бронза') continue;

      mouldingIndex += 1;
      const widthMm = pick(rng, [15, 20, 25, 30, 35, 40, 50, 60, 80]);
      const heightMm = Math.round(widthMm * 0.7 + intBetween(rng, 4, 12));
      const supplierKey = pick(rng, Object.keys(suppliers));
      const costPerMetre = roubles(
        Math.round((120 + widthMm * 11 + intBetween(rng, 0, 260)) / 10) * 10,
      );

      const item = await prisma.catalogItem.create({
        data: {
          organizationId,
          group: 'MOULDING',
          categoryId: categories.moulding,
          supplierId: suppliers[supplierKey],
          internalSku: `БГ-${String(mouldingIndex).padStart(4, '0')}`,
          supplierSku: `${collection.slice(0, 3).toUpperCase()}-${widthMm}-${mouldingIndex}`,
          barcode: `460${String(1000000 + mouldingIndex).padStart(10, '0')}`,
          name: `Багет ${collection} ${widthMm} мм, ${color}`,
          manufacturer: supplierKey,
          collection,
          color,
          colorHex: hex,
          material,
          style: pick(rng, MOULDING_STYLES),
          unit: 'M',
          supplierPrice: costPerMetre,
          supplierDiscountPercent: 0,
          costPrice: costPerMetre,
          priceRuleId: priceRules[widthMm >= 50 ? 'moulding_wide' : 'moulding_standard'],
          taxRateId,
          wasteFactor: 0.1,
          trackInventory: true,
          moulding: {
            create: {
              widthMm,
              heightMm,
              rabbetMm: Math.max(8, Math.round(heightMm * 0.45)),
              rabbetOverlapMm: 3,
              stickLengthMm: pick(rng, [2400, 2900, 3000, 3050]),
              kerfMm: 3,
              allowanceMm: 0,
              chopPrice: roubles(pick(rng, [40, 50, 60])),
              joinPrice: roubles(pick(rng, [60, 75, 90])),
            },
          },
        },
      });
      mouldingIds.push(item.id);
    }
  }

  // --- matboard ----------------------------------------------------------
  const matIds: string[] = [];
  let matIndex = 0;
  for (const [color, hex] of MAT_COLORS) {
    matIndex += 1;
    const conservation = matIndex % 7 === 0;
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'MATBOARD',
        categoryId: categories.matboard,
        supplierId: suppliers['Артмат'],
        internalSku: `ПС-${String(matIndex).padStart(3, '0')}`,
        barcode: `461${String(2000000 + matIndex).padStart(10, '0')}`,
        name: `Паспарту ${color}${conservation ? ', музейное' : ''} 1,4 мм`,
        manufacturer: 'Артмат',
        color,
        colorHex: hex,
        material: conservation ? 'хлопковый картон' : 'целлюлозный картон',
        unit: 'SHEET',
        supplierPrice: roubles(conservation ? 1450 : 620),
        costPrice: roubles(conservation ? 1450 : 620),
        priceRuleId: priceRules.matboard,
        taxRateId,
        wasteFactor: 0.15,
        trackInventory: true,
        sheet: {
          create: {
            sheetWidthMm: 810,
            sheetHeightMm: 1220,
            thicknessMm: 1.4,
            core: conservation ? 'белый хлопковый' : 'белый целлюлозный',
            allowOffcuts: true,
          },
        },
      },
    });
    matIds.push(item.id);
  }

  // --- glazing -----------------------------------------------------------
  const glazingSeeds: Array<{
    sku: string;
    name: string;
    price: number;
    thickness: number;
    uv?: number;
    width: number;
    height: number;
  }> = [
    { sku: 'СТ-001', name: 'Стекло обычное 2 мм', price: 520, thickness: 2, width: 1600, height: 2200 },
    { sku: 'СТ-002', name: 'Стекло обычное 3 мм', price: 690, thickness: 3, width: 1600, height: 2200 },
    { sku: 'СТ-003', name: 'Стекло матовое 2 мм', price: 980, thickness: 2, width: 1300, height: 2000 },
    { sku: 'СТ-004', name: 'Стекло антибликовое', price: 2400, thickness: 2, uv: 45, width: 1220, height: 1830 },
    { sku: 'СТ-005', name: 'Стекло музейное антибликовое', price: 7800, thickness: 2, uv: 99, width: 1220, height: 1830 },
    { sku: 'СТ-006', name: 'Стекло с УФ-защитой', price: 3900, thickness: 2, uv: 92, width: 1220, height: 1830 },
    { sku: 'СТ-007', name: 'Акрил прозрачный 2 мм', price: 2100, thickness: 2, uv: 60, width: 1000, height: 2000 },
    { sku: 'СТ-008', name: 'Акрил антибликовый 2 мм', price: 4600, thickness: 2, uv: 70, width: 1000, height: 2000 },
    { sku: 'СТ-009', name: 'Зеркало 4 мм', price: 1850, thickness: 4, width: 1600, height: 2200 },
  ];

  const glazingIds: string[] = [];
  for (const glazing of glazingSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'GLAZING',
        categoryId: categories.glazing,
        supplierId: suppliers['СтеклоТорг'],
        internalSku: glazing.sku,
        name: glazing.name,
        unit: 'M2',
        supplierPrice: roubles(glazing.price),
        costPrice: roubles(glazing.price),
        priceRuleId: priceRules.glazing,
        taxRateId,
        wasteFactor: 0.12,
        minCharge: roubles(350),
        trackInventory: true,
        sheet: {
          create: {
            sheetWidthMm: glazing.width,
            sheetHeightMm: glazing.height,
            thicknessMm: glazing.thickness,
            uvPercent: glazing.uv ?? null,
            allowOffcuts: true,
          },
        },
      },
    });
    glazingIds.push(item.id);
  }

  // --- backing, mounting boards, subframe ---------------------------------
  const backingSeeds = [
    { sku: 'ЗД-001', name: 'Задник ДВП 3 мм', price: 340, thickness: 3, w: 1220, h: 2440 },
    { sku: 'ЗД-002', name: 'Задник переплётный картон 2 мм', price: 260, thickness: 2, w: 700, h: 1000 },
    { sku: 'ЗД-003', name: 'Задник пенокартон 3 мм', price: 480, thickness: 3, w: 1000, h: 1400 },
    { sku: 'ЗД-004', name: 'Задник МДФ 4 мм', price: 610, thickness: 4, w: 1220, h: 2440 },
    { sku: 'ЗД-005', name: 'Задник музейный бескислотный', price: 1750, thickness: 2, w: 810, h: 1220 },
  ];
  const backingIds: string[] = [];
  for (const backing of backingSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'BACKING',
        categoryId: categories.backing,
        supplierId: suppliers['Артмат'],
        internalSku: backing.sku,
        name: backing.name,
        unit: 'SHEET',
        supplierPrice: roubles(backing.price),
        costPrice: roubles(backing.price),
        priceRuleId: priceRules.sheet_standard,
        taxRateId,
        wasteFactor: 0.08,
        sheet: {
          create: {
            sheetWidthMm: backing.w,
            sheetHeightMm: backing.h,
            thicknessMm: backing.thickness,
            allowOffcuts: true,
          },
        },
      },
    });
    backingIds.push(item.id);
  }

  const mountingBoardSeeds = [
    { sku: 'ОС-001', name: 'Пенокартон 5 мм', price: 620, thickness: 5, w: 1000, h: 1400 },
    { sku: 'ОС-002', name: 'Пенокартон 10 мм', price: 980, thickness: 10, w: 1000, h: 1400 },
    { sku: 'ОС-003', name: 'ДВП 3 мм', price: 340, thickness: 3, w: 1220, h: 2440 },
    { sku: 'ОС-004', name: 'МДФ 6 мм', price: 890, thickness: 6, w: 1220, h: 2440 },
    { sku: 'ОС-005', name: 'Фанера 4 мм', price: 1150, thickness: 4, w: 1525, h: 1525 },
    { sku: 'ОС-006', name: 'Пластик ПВХ 3 мм', price: 1320, thickness: 3, w: 1000, h: 2000 },
  ];
  const mountingBoardIds: string[] = [];
  for (const board of mountingBoardSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'MOUNTING',
        categoryId: categories.mounting,
        supplierId: suppliers['Артмат'],
        internalSku: board.sku,
        name: board.name,
        unit: 'SHEET',
        supplierPrice: roubles(board.price),
        costPrice: roubles(board.price),
        priceRuleId: priceRules.sheet_standard,
        taxRateId,
        wasteFactor: 0.1,
        sheet: {
          create: {
            sheetWidthMm: board.w,
            sheetHeightMm: board.h,
            thicknessMm: board.thickness,
            allowOffcuts: true,
          },
        },
      },
    });
    mountingBoardIds.push(item.id);
  }

  const subframeSeeds = [
    { sku: 'ПР-001', name: 'Подрамник модульный 18×45 мм', price: 210, width: 45, height: 18 },
    { sku: 'ПР-002', name: 'Подрамник галерейный 40×45 мм', price: 340, width: 45, height: 40 },
    { sku: 'ПР-003', name: 'Подрамник глухой 20×35 мм', price: 175, width: 35, height: 20 },
    { sku: 'ПР-004', name: 'Подрамник музейный 25×50 мм', price: 420, width: 50, height: 25 },
  ];
  const subframeIds: string[] = [];
  for (const subframe of subframeSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'SUBFRAME',
        categoryId: categories.subframe,
        supplierId: suppliers['Багетный Дом'],
        internalSku: subframe.sku,
        name: subframe.name,
        unit: 'M',
        supplierPrice: roubles(subframe.price),
        costPrice: roubles(subframe.price),
        priceRuleId: priceRules.moulding_standard,
        taxRateId,
        wasteFactor: 0.12,
        moulding: {
          create: {
            widthMm: subframe.width,
            heightMm: subframe.height,
            rabbetMm: 0,
            rabbetOverlapMm: 0,
            stickLengthMm: 3000,
            kerfMm: 3,
            allowanceMm: 0,
          },
        },
      },
    });
    subframeIds.push(item.id);
  }

  // --- hardware -----------------------------------------------------------
  const hardwareSeeds = [
    { sku: 'ФР-001', name: 'Подвес D-ring малый', price: 12, perItem: 2, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-002', name: 'Подвес D-ring большой', price: 18, perItem: 2, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-003', name: 'Крючок настенный', price: 24, perItem: 1, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-004', name: 'Трос подвесной стальной', price: 65, perItem: 0, perPerimeter: 0.4, unit: 'M' as const },
    { sku: 'ФР-005', name: 'Леска капроновая', price: 22, perItem: 0, perPerimeter: 0.5, unit: 'M' as const },
    { sku: 'ФР-006', name: 'Скоба поворотная', price: 6, perItem: 8, perPerimeter: 2, unit: 'PIECE' as const },
    { sku: 'ФР-007', name: 'Уголок крепёжный', price: 9, perItem: 4, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-008', name: 'Замок рамный', price: 34, perItem: 4, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-009', name: 'Ножки защитные', price: 8, perItem: 2, perPerimeter: 0, unit: 'PIECE' as const },
    { sku: 'ФР-010', name: 'Гвоздь багетный', price: 2, perItem: 12, perPerimeter: 4, unit: 'PIECE' as const },
    { sku: 'ФР-011', name: 'Клей ПВА столярный', price: 480, perItem: 0.02, perPerimeter: 0, unit: 'LITRE' as const },
    { sku: 'ФР-012', name: 'Лента бумажная бескислотная', price: 890, perItem: 0, perPerimeter: 1.1, unit: 'M' as const },
  ];
  const hardwareIds: string[] = [];
  for (const hardware of hardwareSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: 'HARDWARE',
        categoryId: categories.hardware,
        supplierId: suppliers['Багетный Дом'],
        internalSku: hardware.sku,
        name: hardware.name,
        unit: hardware.unit,
        supplierPrice: roubles(hardware.price),
        costPrice: roubles(hardware.price),
        priceRuleId: priceRules.hardware,
        taxRateId,
        wasteFactor: 0.03,
        hardware: {
          create: {
            perItem: hardware.perItem,
            perPerimeterM: hardware.perPerimeter,
            packSize: 100,
          },
        },
      },
    });
    hardwareIds.push(item.id);
  }

  // --- mounting services, extras and labour --------------------------------
  const serviceSeeds: Array<{
    sku: string;
    name: string;
    group: 'MOUNTING' | 'SERVICE' | 'EXTRA' | 'FITTING';
    price: number;
    operation?: string;
    minutes: number;
    minutesPerM2?: number;
  }> = [
    { sku: 'НТ-001', name: 'Натяжка вручную', group: 'MOUNTING', price: 900, operation: 'MOUNT', minutes: 15, minutesPerM2: 10 },
    { sku: 'НТ-002', name: 'Натяжка на пенокартон', group: 'MOUNTING', price: 1200, operation: 'MOUNT', minutes: 18, minutesPerM2: 12 },
    { sku: 'НТ-003', name: 'Натяжка на подрамник', group: 'MOUNTING', price: 1800, operation: 'MOUNT', minutes: 30, minutesPerM2: 14 },
    { sku: 'НТ-004', name: 'Галерейная натяжка холста', group: 'MOUNTING', price: 2400, operation: 'MOUNT', minutes: 40, minutesPerM2: 16 },
    { sku: 'НК-001', name: 'Накатка на пенокартон', group: 'MOUNTING', price: 1400, operation: 'LAMINATE', minutes: 20, minutesPerM2: 14 },
    { sku: 'НК-002', name: 'Накатка на пластик', group: 'MOUNTING', price: 1900, operation: 'LAMINATE', minutes: 24, minutesPerM2: 16 },
    { sku: 'НК-003', name: 'Накатка на МДФ', group: 'MOUNTING', price: 2200, operation: 'LAMINATE', minutes: 28, minutesPerM2: 16 },
    { sku: 'ДП-001', name: 'V-groove (декоративная линия)', group: 'EXTRA', price: 650, operation: 'CUT_MAT', minutes: 10 },
    { sku: 'ДП-002', name: 'Фацет по краю паспарту', group: 'EXTRA', price: 850, operation: 'CUT_MAT', minutes: 12 },
    { sku: 'ДП-003', name: 'Фигурное окно паспарту', group: 'EXTRA', price: 1500, operation: 'CUT_MAT', minutes: 25 },
    { sku: 'ДП-004', name: 'Дополнительное окно паспарту', group: 'EXTRA', price: 450, operation: 'CUT_MAT', minutes: 8 },
    { sku: 'ДП-005', name: 'Дистанционная рамка (spacer)', group: 'EXTRA', price: 700, operation: 'FIT_ARTWORK', minutes: 10 },
    { sku: 'ДП-006', name: 'Shadowbox (объёмное оформление)', group: 'EXTRA', price: 3200, operation: 'FIT_ARTWORK', minutes: 45 },
    { sku: 'ДП-007', name: 'Float mounting (парящее крепление)', group: 'EXTRA', price: 1900, operation: 'FIT_ARTWORK', minutes: 30 },
    { sku: 'ДП-008', name: 'Очистка и обеспыливание работы', group: 'SERVICE', price: 600, operation: 'CLEAN', minutes: 15 },
    { sku: 'ДП-009', name: 'Реставрация рамы', group: 'SERVICE', price: 4500, operation: 'ASSEMBLE_FRAME', minutes: 90 },
    { sku: 'ДП-010', name: 'Срочное изготовление', group: 'SERVICE', price: 2500, minutes: 0 },
    { sku: 'ДП-011', name: 'Доставка по городу', group: 'SERVICE', price: 800, minutes: 0 },
    { sku: 'ДП-012', name: 'Монтаж на объекте', group: 'SERVICE', price: 2200, minutes: 0 },
    { sku: 'ДП-013', name: 'Усиленная упаковка', group: 'SERVICE', price: 550, operation: 'PACK', minutes: 12 },
    { sku: 'СБ-001', name: 'Сборка рамы под ключ', group: 'FITTING', price: 950, operation: 'ASSEMBLE_FRAME', minutes: 20 },
    { sku: 'СБ-002', name: 'Установка фурнитуры и подвеса', group: 'FITTING', price: 400, operation: 'FIT_HARDWARE', minutes: 6 },
  ];

  const serviceIds: Record<string, string> = {};
  for (const service of serviceSeeds) {
    const item = await prisma.catalogItem.create({
      data: {
        organizationId,
        group: service.group,
        categoryId: categories.service,
        internalSku: service.sku,
        name: service.name,
        unit: 'PIECE',
        supplierPrice: 0,
        costPrice: 0,
        retailPrice: roubles(service.price),
        taxRateId,
        trackInventory: false,
        service: {
          create: {
            operationId: service.operation ? context.operations[service.operation] : null,
            standardMinutes: service.minutes,
            minutesPerM2: service.minutesPerM2 ?? 0,
            complexityFactor: 1,
          },
        },
      },
    });
    serviceIds[service.sku] = item.id;
  }

  return {
    mouldingIds,
    matIds,
    glazingIds,
    backingIds,
    mountingBoardIds,
    subframeIds,
    hardwareIds,
    serviceIds,
  };
}

async function seedCategories(prisma: PrismaClient, organizationId: string) {
  const definitions: Array<{ key: string; code: string; name: string; group: 'MOULDING' | 'MATBOARD' | 'GLAZING' | 'BACKING' | 'MOUNTING' | 'SUBFRAME' | 'HARDWARE' | 'SERVICE' }> = [
    { key: 'moulding', code: 'CAT-MOULDING', name: 'Багет', group: 'MOULDING' },
    { key: 'matboard', code: 'CAT-MATBOARD', name: 'Паспарту', group: 'MATBOARD' },
    { key: 'glazing', code: 'CAT-GLAZING', name: 'Остекление', group: 'GLAZING' },
    { key: 'backing', code: 'CAT-BACKING', name: 'Задники', group: 'BACKING' },
    { key: 'mounting', code: 'CAT-MOUNTING', name: 'Основы и натяжка', group: 'MOUNTING' },
    { key: 'subframe', code: 'CAT-SUBFRAME', name: 'Подрамники', group: 'SUBFRAME' },
    { key: 'hardware', code: 'CAT-HARDWARE', name: 'Фурнитура', group: 'HARDWARE' },
    { key: 'service', code: 'CAT-SERVICE', name: 'Работы и услуги', group: 'SERVICE' },
  ];

  const result: Record<string, string> = {};
  for (const definition of definitions) {
    const category = await prisma.catalogCategory.create({
      data: {
        organizationId,
        code: definition.code,
        name: definition.name,
        group: definition.group,
      },
    });
    result[definition.key] = category.id;
  }
  return result;
}
