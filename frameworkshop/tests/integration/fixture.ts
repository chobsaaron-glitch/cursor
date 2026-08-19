/**
 * Builds a small but completely real workshop in the database: organization,
 * roles, users, price rules, labour norms and a handful of catalog items.
 *
 * Integration tests run against this instead of the demo seed so they stay fast
 * and so their assertions do not depend on the randomised demo data.
 */

import { roubles } from '@/lib/money';
import { prisma } from '@/server/db';
import { hashPassword } from '@/server/auth/session';
import {
  ROLE_DEFINITIONS,
  maxDiscountForRole,
  permissionsForRole,
  type RoleCode,
} from '@/server/auth/permissions';
import type { AppContext } from '@/server/lib/context';
import { resetDatabase } from '@/server/lib/reset';
import { createCatalogItem } from '@/server/modules/catalog/service';
import { receiveStock } from '@/server/modules/inventory/service';
import { DEFAULT_OPERATIONS } from '@/server/modules/production/operations';

export interface Workshop {
  organizationId: string;
  branchId: string;
  supplierId: string;
  admin: AppContext;
  receptionist: AppContext;
  master: AppContext;
  accountant: AppContext;
  /** Catalog item ids by role in the framing sandwich. */
  items: {
    moulding: string;
    mat: string;
    glazing: string;
    backing: string;
    hardware: string;
    mountingService: string;
  };
}

const PASSWORD = 'test12345';

export async function buildWorkshop(): Promise<Workshop> {
  await resetDatabase();

  const organization = await prisma.organization.create({
    data: { name: 'Тестовая мастерская', email: 'test@example.ru' },
  });
  const organizationId = organization.id;

  const branch = await prisma.branch.create({
    data: { organizationId, name: 'Основная', code: 'MAIN', isDefault: true },
  });

  const roles: Record<string, string> = {};
  for (const definition of ROLE_DEFINITIONS) {
    const role = await prisma.role.create({
      data: {
        organizationId,
        code: definition.code,
        name: definition.name,
        isSystem: true,
        permissions: {
          create: permissionsForRole(definition.code).map((permission) => ({ permission })),
        },
      },
    });
    roles[definition.code] = role.id;
  }

  const passwordHash = await hashPassword(PASSWORD);
  const people: Array<{ email: string; first: string; last: string; role: RoleCode }> = [
    { email: 'admin@test.ru', first: 'Анна', last: 'Соколова', role: 'ADMIN' },
    { email: 'priem@test.ru', first: 'Мария', last: 'Петрова', role: 'RECEPTIONIST' },
    { email: 'master@test.ru', first: 'Игорь', last: 'Кузнецов', role: 'MASTER' },
    { email: 'buh@test.ru', first: 'Елена', last: 'Волкова', role: 'ACCOUNTANT' },
  ];

  const contexts: Record<string, AppContext> = {};
  for (const person of people) {
    const user = await prisma.user.create({
      data: {
        organizationId,
        branchId: branch.id,
        roleId: roles[person.role],
        email: person.email,
        passwordHash,
        firstName: person.first,
        lastName: person.last,
      },
    });
    await prisma.employee.create({
      data: {
        organizationId,
        userId: user.id,
        firstName: person.first,
        lastName: person.last,
        position: person.role,
        payType: person.role === 'MASTER' ? 'PIECE' : 'FIXED',
        baseRate: person.role === 'MASTER' ? 0 : roubles(80000),
        dailyCapacityMinutes: 420,
        hiredAt: new Date('2024-01-01'),
      },
    });
    contexts[person.role] = {
      user: {
        id: user.id,
        organizationId,
        branchId: branch.id,
        email: person.email,
        firstName: person.first,
        lastName: person.last,
        roleCode: person.role,
        roleName: ROLE_DEFINITIONS.find((role) => role.code === person.role)!.name,
        permissions: permissionsForRole(person.role),
        maxDiscountPercent: maxDiscountForRole(person.role),
      },
    };
  }

  const admin = contexts.ADMIN;

  const taxRate = await prisma.taxRate.create({
    data: { organizationId, name: 'Без НДС', percent: 0, isDefault: true },
  });

  for (const operation of DEFAULT_OPERATIONS) {
    await prisma.labourOperation.create({
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
  }
  const operations = await prisma.labourOperation.findMany({ where: { organizationId } });
  const operationByCode = new Map(operations.map((operation) => [operation.code, operation.id]));

  const supplier = await prisma.supplier.create({
    data: { organizationId, name: 'Тестовый поставщик', leadTimeDays: 5 },
  });

  const mouldingRule = await prisma.priceRule.create({
    data: {
      organizationId,
      name: 'Багет',
      method: 'JOIN',
      factor: 2.5,
      chopPrice: roubles(50),
      joinPrice: roubles(75),
      minPrice: roubles(600),
      roundTo: 100,
    },
  });
  const areaRule = await prisma.priceRule.create({
    data: {
      organizationId,
      name: 'По площади',
      method: 'PER_AREA',
      amount: roubles(2400),
      minPrice: roubles(500),
      minMarkup: 2.2,
      roundTo: 100,
    },
  });
  const multiplierRule = await prisma.priceRule.create({
    data: {
      organizationId,
      name: 'Коэффициент 3',
      method: 'COST_MULTIPLIER',
      factor: 3,
      minPrice: roubles(200),
      roundTo: 100,
    },
  });

  const common = { supplierId: supplier.id, taxRateId: taxRate.id };

  const moulding = await createCatalogItem(admin, {
    ...common,
    group: 'MOULDING',
    internalSku: 'BG-001',
    name: 'Багет тестовый 30 мм',
    unit: 'M',
    costPrice: roubles(400),
    priceRuleId: mouldingRule.id,
    wasteFactor: 0.1,
    moulding: { widthMm: 30, heightMm: 25, rabbetMm: 10, stickLengthMm: 3000 },
  });

  const mat = await createCatalogItem(admin, {
    ...common,
    group: 'MATBOARD',
    internalSku: 'PP-001',
    name: 'Паспарту тестовое',
    unit: 'SHEET',
    costPrice: roubles(700),
    priceRuleId: areaRule.id,
    sheet: { sheetWidthMm: 810, sheetHeightMm: 1220, thicknessMm: 1.4 },
  });

  const glazing = await createCatalogItem(admin, {
    ...common,
    group: 'GLAZING',
    internalSku: 'ST-001',
    name: 'Стекло тестовое',
    unit: 'SHEET',
    costPrice: roubles(900),
    priceRuleId: areaRule.id,
    sheet: { sheetWidthMm: 1000, sheetHeightMm: 1200, thicknessMm: 2 },
  });

  const backing = await createCatalogItem(admin, {
    ...common,
    group: 'BACKING',
    internalSku: 'ZD-001',
    name: 'Задник тестовый',
    unit: 'SHEET',
    costPrice: roubles(300),
    priceRuleId: multiplierRule.id,
    sheet: { sheetWidthMm: 1000, sheetHeightMm: 1400, thicknessMm: 3 },
  });

  const hardware = await createCatalogItem(admin, {
    ...common,
    group: 'HARDWARE',
    internalSku: 'FR-001',
    name: 'Подвес тестовый',
    unit: 'PIECE',
    costPrice: roubles(18),
    priceRuleId: multiplierRule.id,
    hardware: { perItem: 2 },
  });

  const mountingService = await createCatalogItem(admin, {
    ...common,
    group: 'SERVICE',
    internalSku: 'NT-001',
    name: 'Натяжка на пенокартон',
    unit: 'PIECE',
    costPrice: 0,
    retailPrice: roubles(1200),
    trackInventory: false,
    service: {
      operationId: operationByCode.get('STRETCH') ?? null,
      standardMinutes: 15,
      minutesPerM2: 10,
    },
  });

  for (const [id, quantity] of [
    [moulding.id, 60],
    [mat.id, 20],
    [glazing.id, 20],
    [backing.id, 20],
    [hardware.id, 200],
  ] as Array<[string, number]>) {
    await receiveStock(prisma, admin, {
      catalogItemId: id,
      quantity,
      branchId: branch.id,
      note: 'Начальный остаток',
      refType: 'Fixture',
    });
  }

  return {
    organizationId,
    branchId: branch.id,
    supplierId: supplier.id,
    admin,
    receptionist: contexts.RECEPTIONIST,
    master: contexts.MASTER,
    accountant: contexts.ACCOUNTANT,
    items: {
      moulding: moulding.id,
      mat: mat.id,
      glazing: glazing.id,
      backing: backing.id,
      hardware: hardware.id,
      mountingService: mountingService.id,
    },
  };
}
