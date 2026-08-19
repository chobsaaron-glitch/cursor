/**
 * Demo data for a working Russian framing workshop.
 *
 * Orders are created through the real domain services, not by inserting rows:
 * if the seed runs, the whole order → calculation → reservation → production →
 * payment pipeline is proven to work end to end.
 */

import 'dotenv/config';
import { roubles } from '@/lib/money';
import { prisma } from '@/server/db';
import { hashPassword } from '@/server/auth/session';
import {
  ROLE_DEFINITIONS,
  permissionsForRole,
  maxDiscountForRole,
  type RoleCode,
} from '@/server/auth/permissions';
import type { AppContext } from '@/server/lib/context';
import { resetDatabase } from '@/server/lib/reset';
import { DEFAULT_OPERATIONS } from '@/server/modules/production/operations';
import { createCustomer } from '@/server/modules/customers/service';
import { addWorkItem, confirmOrder, createOrder, changeWorkItemStatus, issueOrder } from '@/server/modules/orders/service';
import { receiveStock } from '@/server/modules/inventory/service';
import { recordPayment, createInvoice } from '@/server/modules/payments/service';
import { finishTask, startTask, completeQualityCheck, moveStage } from '@/server/modules/production/service';
import { consumeForWorkItem } from '@/server/modules/inventory/service';
import type { FramingSpec } from '@/server/modules/framing/types';
import { seedCatalog } from './seed/catalog';
import { createRng, intBetween, pick } from './seed/rng';

const DEMO_PASSWORD = 'demo12345';

async function main() {
  console.info('Очистка демонстрационных данных…');
  await resetDatabase();

  console.info('Организация и филиалы…');
  const organization = await prisma.organization.create({
    data: {
      name: 'Багетная мастерская «Рама и Свет»',
      legalName: 'ООО «Рама и Свет»',
      inn: '7712345678',
      kpp: '771201001',
      address: 'г. Москва, ул. Мастеровая, д. 14, стр. 2',
      phone: '+7 (495) 120-45-67',
      email: 'info@ramaisvet.example',
    },
  });
  const organizationId = organization.id;

  const branch = await prisma.branch.create({
    data: { organizationId, name: 'Мастерская на Мастеровой', code: 'MAIN', isDefault: true },
  });
  await prisma.branch.create({
    data: { organizationId, name: 'Салон на Тверской', code: 'TVER' },
  });

  console.info('Роли и права…');
  const roles: Record<string, string> = {};
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.create({
      data: {
        organizationId,
        code: definition.code,
        name: definition.name,
        description: definition.description,
        isSystem: true,
        permissions: {
          create: permissionsForRole(definition.code).map((permission) => ({ permission })),
        },
      },
    });
    roles[definition.code] = role.id;
  }

  console.info('Пользователи и сотрудники…');
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const userSeeds: Array<{
    email: string;
    firstName: string;
    lastName: string;
    role: RoleCode;
    position: string;
  }> = [
    { email: 'admin@ramaisvet.ru', firstName: 'Анна', lastName: 'Соколова', role: 'ADMIN', position: 'Владелец' },
    { email: 'priem@ramaisvet.ru', firstName: 'Мария', lastName: 'Петрова', role: 'RECEPTIONIST', position: 'Приёмщик' },
    { email: 'master@ramaisvet.ru', firstName: 'Игорь', lastName: 'Кузнецов', role: 'MASTER', position: 'Мастер-багетчик' },
    { email: 'master2@ramaisvet.ru', firstName: 'Дмитрий', lastName: 'Орлов', role: 'MASTER', position: 'Мастер-багетчик' },
    { email: 'buh@ramaisvet.ru', firstName: 'Елена', lastName: 'Волкова', role: 'ACCOUNTANT', position: 'Бухгалтер' },
    { email: 'manager@ramaisvet.ru', firstName: 'Павел', lastName: 'Никитин', role: 'MANAGER', position: 'Менеджер' },
  ];

  const users: Record<string, { id: string; roleCode: RoleCode; permissions: string[] }> = {};
  for (const seed of userSeeds) {
    const user = await prisma.user.create({
      data: {
        organizationId,
        branchId: branch.id,
        roleId: roles[seed.role],
        email: seed.email,
        passwordHash,
        firstName: seed.firstName,
        lastName: seed.lastName,
        phone: '+7 (495) 120-45-67',
      },
    });
    await prisma.employee.create({
      data: {
        organizationId,
        userId: user.id,
        firstName: seed.firstName,
        lastName: seed.lastName,
        position: seed.position,
        payType: seed.role === 'MASTER' ? 'PIECE' : 'FIXED',
        baseRate: seed.role === 'MASTER' ? 0 : roubles(80000),
        dailyCapacityMinutes: seed.role === 'MASTER' ? 420 : 480,
        hiredAt: new Date('2024-03-01'),
      },
    });
    users[seed.email] = {
      id: user.id,
      roleCode: seed.role,
      permissions: permissionsForRole(seed.role),
    };
  }

  function contextFor(email: string): AppContext {
    const user = users[email];
    const seed = userSeeds.find((entry) => entry.email === email)!;
    return {
      user: {
        id: user.id,
        organizationId,
        branchId: branch.id,
        email,
        firstName: seed.firstName,
        lastName: seed.lastName,
        roleCode: user.roleCode,
        roleName: ROLE_DEFINITIONS.find((role) => role.code === user.roleCode)!.name,
        permissions: user.permissions,
        maxDiscountPercent: maxDiscountForRole(user.roleCode),
      },
    };
  }

  const admin = contextFor('admin@ramaisvet.ru');
  const receptionist = contextFor('priem@ramaisvet.ru');
  const masterOne = contextFor('master@ramaisvet.ru');

  console.info('Налоги, правила ценообразования и формулы…');
  const taxNone = await prisma.taxRate.create({
    data: { organizationId, name: 'Без НДС', percent: 0, isDefault: true },
  });
  for (const percent of [5, 7, 10, 20]) {
    await prisma.taxRate.create({
      data: { organizationId, name: `НДС ${percent} %`, percent },
    });
  }

  const tieredFormula = await prisma.priceFormula.create({
    data: {
      organizationId,
      name: 'Ступенчатая наценка по себестоимости',
      expression: 'IF(cost < 1000, cost * 4.5, IF(cost < 5000, cost * 3.8, cost * 3.2))',
      description: 'Чем дороже материал, тем ниже коэффициент наценки.',
    },
  });

  const sizeMatrix = await prisma.priceMatrix.create({
    data: {
      organizationId,
      name: 'Стандартные размеры — готовые рамы',
      axis: 'SIZE',
      roundUp: true,
      cells: {
        create: [
          { widthMm: 200, heightMm: 300, price: roubles(1500) },
          { widthMm: 300, heightMm: 400, price: roubles(2200) },
          { widthMm: 400, heightMm: 500, price: roubles(3200) },
          { widthMm: 500, heightMm: 700, price: roubles(4500) },
          { widthMm: 700, heightMm: 1000, price: roubles(7900) },
        ],
      },
    },
  });

  const priceRuleSeeds = [
    { key: 'moulding_standard', name: 'Багет — наценка ×2,6 + резка и сборка', method: 'JOIN' as const, factor: 2.6, chopPrice: roubles(50), joinPrice: roubles(75), minPrice: roubles(600) },
    { key: 'moulding_wide', name: 'Багет широкий — формула по себестоимости', method: 'FORMULA' as const, formulaId: tieredFormula.id, minPrice: roubles(900), minMarkup: 2.6 },
    { key: 'matboard', name: 'Паспарту — по площади', method: 'PER_AREA' as const, amount: roubles(2400), minPrice: roubles(650), minMarkup: 2.2 },
    { key: 'glazing', name: 'Остекление — по площади', method: 'PER_AREA' as const, amount: roubles(3200), minPrice: roubles(450), minMarkup: 2.2 },
    { key: 'sheet_standard', name: 'Листовые материалы — коэффициент 3', method: 'COST_MULTIPLIER' as const, factor: 3, minPrice: roubles(250) },
    { key: 'hardware', name: 'Фурнитура — наценка 180 %', method: 'MARKUP' as const, factor: 180, minPrice: roubles(30) },
    { key: 'ready_frame', name: 'Готовая рама — ценовая матрица', method: 'MATRIX' as const, matrixId: sizeMatrix.id, minMarkup: 2.5 },
    { key: 'united_inch', name: 'Оформление по united inch', method: 'UNITED_INCH' as const, amount: roubles(120) },
  ];

  const priceRules: Record<string, string> = {};
  for (const seed of priceRuleSeeds) {
    const rule = await prisma.priceRule.create({
      data: {
        organizationId,
        name: seed.name,
        method: seed.method,
        factor: 'factor' in seed ? (seed.factor ?? null) : null,
        amount: 'amount' in seed ? (seed.amount ?? null) : null,
        chopPrice: 'chopPrice' in seed ? seed.chopPrice : null,
        joinPrice: 'joinPrice' in seed ? seed.joinPrice : null,
        minPrice: 'minPrice' in seed ? (seed.minPrice ?? null) : null,
        minMarkup: 'minMarkup' in seed ? seed.minMarkup : null,
        roundTo: 100,
        formulaId: 'formulaId' in seed ? seed.formulaId : null,
        matrixId: 'matrixId' in seed ? seed.matrixId : null,
      },
    });
    priceRules[seed.key] = rule.id;
  }

  console.info('Нормы труда…');
  const operations: Record<string, string> = {};
  for (const operation of DEFAULT_OPERATIONS) {
    const created = await prisma.labourOperation.create({
      data: {
        organizationId,
        code: operation.code,
        name: operation.name,
        standardMinutes: operation.standardMinutes,
        minutesPerM2: operation.minutesPerM2,
        payRatePerMinute: operation.payRatePerMinute,
        stage: operation.stage,
        sortOrder: operation.sortOrder,
      },
    });
    operations[operation.code] = created.id;
  }

  console.info('Поставщики…');
  const supplierSeeds = [
    { name: 'Неоарт', adapter: 'neoart', phone: '+7 (495) 777-10-10', lead: 5 },
    { name: 'Багетный Дом', adapter: 'generic-csv', phone: '+7 (812) 640-22-11', lead: 7 },
    { name: 'АртПрофиль', adapter: 'generic-json', phone: '+7 (343) 300-11-22', lead: 10 },
    { name: 'Артмат', adapter: null, phone: '+7 (495) 989-33-44', lead: 4 },
    { name: 'СтеклоТорг', adapter: null, phone: '+7 (495) 512-77-88', lead: 3 },
  ];
  const suppliers: Record<string, string> = {};
  for (const seed of supplierSeeds) {
    const supplier = await prisma.supplier.create({
      data: {
        organizationId,
        name: seed.name,
        contactName: 'Отдел продаж',
        phone: seed.phone,
        email: `sales@${seed.adapter ?? 'supplier'}.example`,
        apiAdapter: seed.adapter,
        leadTimeDays: seed.lead,
        paymentTerms: 'Оплата по счёту, 5 рабочих дней',
        discountPercent: 5,
      },
    });
    suppliers[seed.name] = supplier.id;
  }

  console.info('Каталог материалов…');
  const catalog = await seedCatalog(prisma, {
    organizationId,
    suppliers,
    priceRules,
    taxRateId: taxNone.id,
    operations,
  });
  const catalogCount = await prisma.catalogItem.count({ where: { organizationId } });
  console.info(`  создано позиций каталога: ${catalogCount}`);

  console.info('Складские остатки…');
  const rng = createRng(424242);
  const stockable = [
    ...catalog.mouldingIds.map((id) => ({ id, quantity: intBetween(rng, 24, 140) })),
    ...catalog.matIds.map((id) => ({ id, quantity: intBetween(rng, 8, 45) })),
    ...catalog.glazingIds.map((id) => ({ id, quantity: intBetween(rng, 6, 30) })),
    ...catalog.backingIds.map((id) => ({ id, quantity: intBetween(rng, 8, 40) })),
    ...catalog.mountingBoardIds.map((id) => ({ id, quantity: intBetween(rng, 8, 35) })),
    ...catalog.subframeIds.map((id) => ({ id, quantity: intBetween(rng, 30, 120) })),
    ...catalog.hardwareIds.map((id) => ({ id, quantity: intBetween(rng, 120, 900) })),
  ];

  for (const entry of stockable) {
    if (entry.quantity <= 0) continue;
    await receiveStock(prisma, admin, {
      catalogItemId: entry.id,
      quantity: entry.quantity,
      branchId: branch.id,
      note: 'Начальный остаток',
      refType: 'Seed',
    });
  }

  await prisma.inventoryItem.updateMany({
    where: { organizationId },
    data: { minQuantity: 3, reorderPoint: 5, reorderQuantity: 20 },
  });

  // A handful of articles are deliberately left near zero so the shortage
  // detection and the purchase order suggestion have something to show.
  await prisma.inventoryItem.updateMany({
    where: { organizationId, catalogItemId: { in: catalog.mouldingIds.slice(-6) } },
    data: { quantityOnHand: 1.2, reorderPoint: 8, reorderQuantity: 30 },
  });

  console.info('Источники клиентов и клиенты…');
  const sourceNames = ['Рекомендация', 'Яндекс', 'Instagram', 'Вывеска', 'Постоянный клиент', 'Партнёр-галерея'];
  const sources: string[] = [];
  for (const name of sourceNames) {
    const source = await prisma.customerSource.create({ data: { organizationId, name } });
    sources.push(source.id);
  }

  const customerSeeds: Array<{ last: string; first: string; middle: string; phone: string; company?: string }> = [
    { last: 'Иванов', first: 'Иван', middle: 'Петрович', phone: '+7 (916) 100-10-01' },
    { last: 'Смирнова', first: 'Ольга', middle: 'Сергеевна', phone: '+7 (916) 100-10-02' },
    { last: 'Кузнецов', first: 'Алексей', middle: 'Владимирович', phone: '+7 (916) 100-10-03' },
    { last: 'Попова', first: 'Наталья', middle: 'Игоревна', phone: '+7 (916) 100-10-04' },
    { last: 'Васильев', first: 'Сергей', middle: 'Андреевич', phone: '+7 (916) 100-10-05' },
    { last: 'Новикова', first: 'Екатерина', middle: 'Дмитриевна', phone: '+7 (916) 100-10-06' },
    { last: 'Морозов', first: 'Артём', middle: 'Николаевич', phone: '+7 (916) 100-10-07' },
    { last: 'Волкова', first: 'Ирина', middle: 'Алексеевна', phone: '+7 (916) 100-10-08' },
    { last: 'Соловьёв', first: 'Максим', middle: 'Юрьевич', phone: '+7 (916) 100-10-09' },
    { last: 'Зайцева', first: 'Анна', middle: 'Викторовна', phone: '+7 (916) 100-10-10' },
    { last: 'Павлов', first: 'Денис', middle: 'Олегович', phone: '+7 (916) 100-10-11' },
    { last: 'Семёнова', first: 'Марина', middle: 'Павловна', phone: '+7 (916) 100-10-12' },
    { last: 'Голубев', first: 'Роман', middle: 'Ильич', phone: '+7 (916) 100-10-13' },
    { last: 'Виноградова', first: 'Светлана', middle: 'Борисовна', phone: '+7 (916) 100-10-14' },
    { last: 'Богданов', first: 'Кирилл', middle: 'Романович', phone: '+7 (916) 100-10-15', company: 'Галерея «Белый куб»' },
    { last: 'Тарасова', first: 'Юлия', middle: 'Львовна', phone: '+7 (916) 100-10-16', company: 'ООО «Интерьер Плюс»' },
  ];

  const customers = [];
  for (const seed of customerSeeds) {
    customers.push(
      await createCustomer(receptionist, {
        type: seed.company ? 'COMPANY' : 'PERSON',
        lastName: seed.last,
        firstName: seed.first,
        middleName: seed.middle,
        companyName: seed.company ?? null,
        phone: seed.phone,
        email: `${seed.last.toLowerCase()}@example.ru`,
        city: 'Москва',
        sourceId: pick(rng, sources),
        marketingConsent: true,
        discountPercent: seed.company ? 5 : 0,
      }),
    );
  }

  console.info('Шаблоны оформления…');
  const templates: Array<{ name: string; description: string; workType: string; payload: Partial<FramingSpec> }> = [
    {
      name: 'Постер под стекло',
      description: 'Узкий багет, антибликовое стекло, без паспарту.',
      workType: 'Постер',
      payload: {
        mouldings: [{ role: 'INNER', catalogItemId: catalog.mouldingIds[3] }],
        glazing: { catalogItemId: catalog.glazingIds[3] },
        backing: { catalogItemId: catalog.backingIds[0] },
        hardware: [{ catalogItemId: catalog.hardwareIds[0] }],
      },
    },
    {
      name: 'Вышивка с паспарту',
      description: 'Натяжка на пенокартон, двойное паспарту, обычное стекло.',
      workType: 'Вышивка',
      payload: {
        mats: [
          { layer: 1, catalogItemId: catalog.matIds[1], margins: { leftMm: 70, rightMm: 70, topMm: 70, bottomMm: 85 } },
          { layer: 2, catalogItemId: catalog.matIds[9], revealMm: 5, overlapMm: 5 },
        ],
        mouldings: [{ role: 'INNER', catalogItemId: catalog.mouldingIds[12] }],
        glazing: { catalogItemId: catalog.glazingIds[0] },
        backing: { catalogItemId: catalog.backingIds[0] },
        mounting: {
          method: 'FOAM_MOUNT',
          catalogItemId: catalog.serviceIds['НТ-002'],
          boardCatalogItemId: catalog.mountingBoardIds[0],
        },
        hardware: [{ catalogItemId: catalog.hardwareIds[0] }, { catalogItemId: catalog.hardwareIds[4] }],
      },
    },
    {
      name: 'Диплом / грамота',
      description: 'Компактное оформление документа с одинарным паспарту.',
      workType: 'Документ',
      payload: {
        mats: [{ layer: 1, catalogItemId: catalog.matIds[0], margins: { leftMm: 50, rightMm: 50, topMm: 50, bottomMm: 50 } }],
        mouldings: [{ role: 'INNER', catalogItemId: catalog.mouldingIds[5] }],
        glazing: { catalogItemId: catalog.glazingIds[0] },
        backing: { catalogItemId: catalog.backingIds[1] },
        hardware: [{ catalogItemId: catalog.hardwareIds[0] }],
      },
    },
    {
      name: 'Холст на подрамнике',
      description: 'Галерейная натяжка, широкий багет, без стекла.',
      workType: 'Холст',
      payload: {
        mouldings: [{ role: 'INNER', catalogItemId: catalog.mouldingIds[40] }],
        subframe: { catalogItemId: catalog.subframeIds[1] },
        mounting: { method: 'STRETCH_GALLERY', catalogItemId: catalog.serviceIds['НТ-004'] },
        hardware: [{ catalogItemId: catalog.hardwareIds[1] }],
      },
    },
    {
      name: 'Вышивка премиум',
      description: 'Тройное паспарту, музейное стекло, двойной багет.',
      workType: 'Вышивка',
      payload: {
        mats: [
          { layer: 1, catalogItemId: catalog.matIds[4], margins: { leftMm: 80, rightMm: 80, topMm: 80, bottomMm: 95 }, vGroove: true },
          { layer: 2, catalogItemId: catalog.matIds[13], revealMm: 6 },
          { layer: 3, catalogItemId: catalog.matIds[24], revealMm: 4, overlapMm: 5 },
        ],
        mouldings: [
          { role: 'INNER', catalogItemId: catalog.mouldingIds[7] },
          { role: 'OUTER', catalogItemId: catalog.mouldingIds[60] },
        ],
        glazing: { catalogItemId: catalog.glazingIds[4], position: 'BETWEEN' },
        backing: { catalogItemId: catalog.backingIds[4] },
        mounting: {
          method: 'FOAM_MOUNT',
          catalogItemId: catalog.serviceIds['НТ-002'],
          boardCatalogItemId: catalog.mountingBoardIds[1],
        },
        hardware: [{ catalogItemId: catalog.hardwareIds[1] }, { catalogItemId: catalog.hardwareIds[3] }],
        extras: [{ catalogItemId: catalog.serviceIds['ДП-001'] }],
      },
    },
    {
      name: 'Медаль / объёмный предмет',
      description: 'Shadowbox с дистанционной рамкой.',
      workType: 'Объёмный предмет',
      payload: {
        mats: [{ layer: 1, catalogItemId: catalog.matIds[8], margins: { leftMm: 60, rightMm: 60, topMm: 60, bottomMm: 60 } }],
        mouldings: [{ role: 'INNER', catalogItemId: catalog.mouldingIds[22] }],
        glazing: { catalogItemId: catalog.glazingIds[5], spacerMm: 12 },
        backing: { catalogItemId: catalog.backingIds[2] },
        extras: [{ catalogItemId: catalog.serviceIds['ДП-006'] }, { catalogItemId: catalog.serviceIds['ДП-005'] }],
        hardware: [{ catalogItemId: catalog.hardwareIds[0] }],
      },
    },
  ];

  for (const template of templates) {
    await prisma.frameTemplate.create({
      data: {
        organizationId,
        name: template.name,
        description: template.description,
        workType: template.workType,
        payload: template.payload as never,
      },
    });
  }

  console.info('Настройки…');
  await prisma.setting.createMany({
    data: [
      { organizationId, key: 'defaults.mat_margin_mm', value: 70 as never },
      { organizationId, key: 'defaults.clearance_mm', value: 2 as never },
      { organizationId, key: 'defaults.mat_overlap_mm', value: 5 as never },
      { organizationId, key: 'defaults.glazing_catalog_item_id', value: catalog.glazingIds[0] as never },
      { organizationId, key: 'defaults.backing_catalog_item_id', value: catalog.backingIds[0] as never },
      { organizationId, key: 'defaults.hardware_catalog_item_id', value: catalog.hardwareIds[0] as never },
      { organizationId, key: 'ui.default_mode', value: 'simple' as never },
      { organizationId, key: 'production.reusable_offcut_from_mm', value: 150 as never },
    ],
  });

  console.info('Демонстрационные заказы…');
  const workTypes = ['Картина', 'Вышивка', 'Постер', 'Фотография', 'Диплом', 'Холст', 'Зеркало'];

  const orderPlans: Array<{
    customerIndex: number;
    dueInDays: number;
    items: number;
    stage: 'calculation' | 'confirmed' | 'in_production' | 'ready' | 'issued';
    prepaymentPercent: number;
  }> = [
    { customerIndex: 0, dueInDays: 10, items: 2, stage: 'issued', prepaymentPercent: 100 },
    { customerIndex: 1, dueInDays: 7, items: 1, stage: 'ready', prepaymentPercent: 50 },
    { customerIndex: 2, dueInDays: 5, items: 3, stage: 'in_production', prepaymentPercent: 50 },
    { customerIndex: 3, dueInDays: 12, items: 1, stage: 'in_production', prepaymentPercent: 30 },
    { customerIndex: 4, dueInDays: 3, items: 2, stage: 'confirmed', prepaymentPercent: 50 },
    { customerIndex: 5, dueInDays: 14, items: 1, stage: 'confirmed', prepaymentPercent: 0 },
    { customerIndex: 6, dueInDays: -2, items: 1, stage: 'in_production', prepaymentPercent: 50 },
    { customerIndex: 7, dueInDays: 20, items: 2, stage: 'calculation', prepaymentPercent: 0 },
    { customerIndex: 8, dueInDays: 9, items: 1, stage: 'calculation', prepaymentPercent: 0 },
    { customerIndex: 14, dueInDays: 15, items: 3, stage: 'confirmed', prepaymentPercent: 50 },
    { customerIndex: 15, dueInDays: 18, items: 2, stage: 'confirmed', prepaymentPercent: 30 },
  ];

  const specTemplates = templates.map((template) => template.payload);

  for (const plan of orderPlans) {
    const customer = customers[plan.customerIndex];
    const dueDate = new Date(Date.now() + plan.dueInDays * 86_400_000);

    const order = await createOrder(receptionist, {
      customerId: customer.id,
      dueDate,
      priority: plan.dueInDays < 4 ? 'HIGH' : 'NORMAL',
      branchId: branch.id,
    });

    for (let index = 0; index < plan.items; index += 1) {
      const template = pick(rng, specTemplates);
      const width = intBetween(rng, 200, 900);
      const height = intBetween(rng, 250, 1100);
      const spec: FramingSpec = {
        ...(template as FramingSpec),
        artworkWidthMm: width,
        artworkHeightMm: height,
      };

      await addWorkItem(receptionist, {
        orderId: order.id,
        title: `${pick(rng, workTypes)} ${width}×${height}`,
        workType: pick(rng, workTypes),
        spec,
        dueDate,
      });
    }

    if (plan.stage === 'calculation') continue;

    await confirmOrder(admin, order.id);
    await createInvoice(contextFor('buh@ramaisvet.ru'), { orderId: order.id, dueAt: dueDate });

    const refreshed = await prisma.customerOrder.findUniqueOrThrow({
      where: { id: order.id },
      include: { workItems: { include: { productionOrder: { include: { tasks: true } }, qualityChecks: true } } },
    });

    if (plan.prepaymentPercent > 0) {
      await recordPayment(receptionist, {
        orderId: order.id,
        amount: Math.round((refreshed.total * plan.prepaymentPercent) / 100),
        method: pick(rng, ['CASH', 'CARD', 'SBP'] as const),
        note: plan.prepaymentPercent === 100 ? 'Полная оплата' : 'Предоплата',
      });
    }

    if (plan.stage === 'confirmed') continue;

    for (const workItem of refreshed.workItems) {
      const production = workItem.productionOrder;
      if (!production) continue;

      await moveStage(masterOne, production.id, 'CUTTING');

      const tasks = production.tasks.sort((a, b) => a.seq - b.seq);
      const completeAll = plan.stage === 'ready' || plan.stage === 'issued';
      const upTo = completeAll ? tasks.length : Math.ceil(tasks.length / 2);

      for (const task of tasks.slice(0, upTo)) {
        await prisma.productionTask.update({
          where: { id: task.id },
          data: { assigneeId: masterOne.user.id },
        });
        await startTask(masterOne, task.id);
        await finishTask(masterOne, task.id);
      }

      if (!completeAll) continue;

      await consumeForWorkItem(prisma, admin, workItem.id);

      const check = await prisma.qualityCheck.findFirstOrThrow({ where: { workItemId: workItem.id } });
      await prisma.qualityCheckItem.updateMany({
        where: { qualityCheckId: check.id },
        data: { checked: true },
      });
      await completeQualityCheck(masterOne, check.id, 'PASSED', 'Проверено, дефектов нет');
      await changeWorkItemStatus(masterOne, workItem.id, 'READY');
      await moveStage(masterOne, production.id, 'DONE');
    }

    if (plan.stage === 'issued') {
      const balance = await prisma.customerOrder.findUniqueOrThrow({ where: { id: order.id } });
      if (balance.balance > 0) {
        await recordPayment(receptionist, {
          orderId: order.id,
          amount: balance.balance,
          method: 'CARD',
          note: 'Окончательный расчёт',
        });
      }
      await issueOrder(receptionist, order.id);
    }
  }

  console.info('Расходы для отчётности…');
  await prisma.expense.createMany({
    data: [
      { organizationId, category: 'Аренда', description: 'Аренда мастерской', amount: roubles(120000) },
      { organizationId, category: 'Коммунальные услуги', amount: roubles(18500) },
      { organizationId, category: 'Реклама', description: 'Контекстная реклама', amount: roubles(35000) },
      { organizationId, category: 'Инструмент', description: 'Замена ножей резака', amount: roubles(9800) },
    ],
  });

  const stats = await Promise.all([
    prisma.customer.count({ where: { organizationId } }),
    prisma.catalogItem.count({ where: { organizationId } }),
    prisma.customerOrder.count({ where: { organizationId } }),
    prisma.workItem.count({ where: { organizationId } }),
    prisma.inventoryTransaction.count({ where: { organizationId } }),
    prisma.payment.count({ where: { organizationId } }),
  ]);

  console.info('\nГотово. Демонстрационная база заполнена:');
  console.info(`  клиентов:            ${stats[0]}`);
  console.info(`  позиций каталога:    ${stats[1]}`);
  console.info(`  заказов:             ${stats[2]}`);
  console.info(`  изделий:             ${stats[3]}`);
  console.info(`  складских операций:  ${stats[4]}`);
  console.info(`  платежей:            ${stats[5]}`);
  console.info(`\nВход: admin@ramaisvet.ru / ${DEMO_PASSWORD}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
