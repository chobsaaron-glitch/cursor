/**
 * Granular permission catalog.
 *
 * Permissions are plain strings so a role can be assembled from any subset and
 * new ones can be introduced without a migration. `*` grants everything and is
 * reserved for the ADMIN role.
 */

export const PERMISSIONS = {
  'dashboard.view': 'Просмотр дашборда',

  'customers.view': 'Просмотр клиентов',
  'customers.create': 'Создание клиентов',
  'customers.edit': 'Редактирование клиентов',
  'customers.delete': 'Удаление клиентов',
  'customers.export': 'Выгрузка базы клиентов',

  'orders.view': 'Просмотр заказов',
  'orders.create': 'Создание заказов',
  'orders.edit': 'Редактирование заказов',
  'orders.delete': 'Удаление заказов',
  'orders.discount': 'Предоставление скидок',
  'orders.change_price': 'Ручное изменение цены',
  'orders.view_cost': 'Просмотр себестоимости и прибыли',
  'orders.confirm': 'Подтверждение заказа',
  'orders.cancel': 'Отмена заказа',
  'orders.issue': 'Выдача заказа клиенту',

  'catalog.view': 'Просмотр каталога',
  'catalog.create': 'Добавление позиций каталога',
  'catalog.edit': 'Редактирование каталога',
  'catalog.delete': 'Удаление позиций каталога',
  'catalog.import': 'Импорт каталога',

  'pricing.view': 'Просмотр правил ценообразования',
  'pricing.edit': 'Редактирование правил ценообразования',
  'pricing.formulas': 'Редактирование формул',

  'inventory.view': 'Просмотр склада',
  'inventory.adjust': 'Корректировка остатков',
  'inventory.receive': 'Приёмка материалов',
  'inventory.writeoff': 'Списание материалов',

  'procurement.view': 'Просмотр закупок',
  'procurement.create': 'Создание заказов поставщикам',
  'procurement.edit': 'Редактирование заказов поставщикам',
  'procurement.receive': 'Приёмка заказов поставщикам',

  'production.view': 'Просмотр производства',
  'production.manage': 'Управление производственными заданиями',
  'production.execute': 'Выполнение операций',
  'production.quality': 'Контроль качества',

  'payments.view': 'Просмотр платежей',
  'payments.create': 'Приём платежей',
  'payments.refund': 'Возвраты',
  'payments.void': 'Аннулирование платежей',

  'invoices.view': 'Просмотр счетов',
  'invoices.create': 'Выставление счетов',
  'invoices.void': 'Аннулирование счетов',

  'documents.view': 'Просмотр документов',
  'documents.generate': 'Формирование документов',

  'reports.sales': 'Отчёты по продажам',
  'reports.finance': 'Финансовые отчёты',
  'reports.production': 'Производственные отчёты',
  'reports.inventory': 'Складские отчёты',
  'reports.payroll': 'Отчёты по зарплате',

  'employees.view': 'Просмотр сотрудников',
  'employees.edit': 'Редактирование сотрудников',
  'payroll.view': 'Просмотр зарплаты',
  'payroll.manage': 'Начисление зарплаты',

  'suppliers.view': 'Просмотр поставщиков',
  'suppliers.edit': 'Редактирование поставщиков',

  'settings.view': 'Просмотр настроек',
  'settings.edit': 'Изменение настроек',
  'settings.users': 'Управление пользователями',
  'settings.backup': 'Резервное копирование',

  'audit.view': 'Просмотр журнала действий',
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export const WILDCARD = '*';

export type RoleCode = 'ADMIN' | 'RECEPTIONIST' | 'MASTER' | 'ACCOUNTANT' | 'MANAGER';

interface RoleDefinition {
  code: RoleCode;
  name: string;
  description: string;
  permissions: Permission[] | typeof WILDCARD;
  /** Maximum discount this role may grant without an override. */
  maxDiscountPercent: number;
}

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    code: 'ADMIN',
    name: 'Администратор',
    description: 'Полный доступ ко всем разделам, ценам, себестоимости и аудиту.',
    permissions: WILDCARD,
    maxDiscountPercent: 100,
  },
  {
    code: 'RECEPTIONIST',
    name: 'Приёмщик',
    description: 'Приём заказов, расчёт, оплаты, фотографии, печать документов.',
    permissions: [
      'dashboard.view',
      'customers.view',
      'customers.create',
      'customers.edit',
      'orders.view',
      'orders.create',
      'orders.edit',
      'orders.discount',
      'orders.issue',
      'catalog.view',
      'pricing.view',
      'inventory.view',
      'production.view',
      'payments.view',
      'payments.create',
      'invoices.view',
      'invoices.create',
      'documents.view',
      'documents.generate',
      'reports.sales',
    ],
    maxDiscountPercent: 5,
  },
  {
    code: 'MASTER',
    name: 'Мастер',
    description: 'Производственные задания, технологические карты, контроль качества.',
    permissions: [
      'dashboard.view',
      'orders.view',
      'catalog.view',
      'inventory.view',
      'production.view',
      'production.execute',
      'production.quality',
      'documents.view',
    ],
    maxDiscountPercent: 0,
  },
  {
    code: 'ACCOUNTANT',
    name: 'Бухгалтер',
    description: 'Счета, платежи, расходы, задолженность, прибыль и отчётность.',
    permissions: [
      'dashboard.view',
      'customers.view',
      'orders.view',
      'orders.view_cost',
      'payments.view',
      'payments.create',
      'payments.refund',
      'payments.void',
      'invoices.view',
      'invoices.create',
      'invoices.void',
      'documents.view',
      'documents.generate',
      'reports.sales',
      'reports.finance',
      'reports.inventory',
      'reports.payroll',
      'payroll.view',
      'payroll.manage',
      'inventory.view',
      'procurement.view',
      'audit.view',
    ],
    maxDiscountPercent: 10,
  },
  {
    code: 'MANAGER',
    name: 'Менеджер',
    description: 'Клиенты, продажи, заказы, закупки и аналитика.',
    permissions: [
      'dashboard.view',
      'customers.view',
      'customers.create',
      'customers.edit',
      'customers.export',
      'orders.view',
      'orders.create',
      'orders.edit',
      'orders.discount',
      'orders.confirm',
      'orders.cancel',
      'orders.view_cost',
      'catalog.view',
      'catalog.create',
      'catalog.edit',
      'pricing.view',
      'inventory.view',
      'procurement.view',
      'procurement.create',
      'procurement.edit',
      'production.view',
      'production.manage',
      'payments.view',
      'payments.create',
      'invoices.view',
      'invoices.create',
      'documents.view',
      'documents.generate',
      'reports.sales',
      'reports.production',
      'reports.inventory',
      'suppliers.view',
      'suppliers.edit',
      'employees.view',
    ],
    maxDiscountPercent: 10,
  },
];

export function permissionsForRole(code: RoleCode): string[] {
  const definition = ROLE_DEFINITIONS.find((role) => role.code === code);
  if (!definition) return [];
  return definition.permissions === WILDCARD ? [WILDCARD] : [...definition.permissions];
}

export function maxDiscountForRole(code: string): number {
  return ROLE_DEFINITIONS.find((role) => role.code === code)?.maxDiscountPercent ?? 0;
}

export function hasPermission(granted: readonly string[], required: Permission | Permission[]): boolean {
  if (granted.includes(WILDCARD)) return true;
  const list = Array.isArray(required) ? required : [required];
  return list.every((permission) => granted.includes(permission));
}

export function hasAnyPermission(granted: readonly string[], required: Permission[]): boolean {
  if (granted.includes(WILDCARD)) return true;
  return required.some((permission) => granted.includes(permission));
}

/** Permission groups used to render the settings screen. */
export const PERMISSION_GROUPS: Array<{ title: string; prefix: string }> = [
  { title: 'Клиенты', prefix: 'customers.' },
  { title: 'Заказы', prefix: 'orders.' },
  { title: 'Каталог', prefix: 'catalog.' },
  { title: 'Ценообразование', prefix: 'pricing.' },
  { title: 'Склад', prefix: 'inventory.' },
  { title: 'Закупки', prefix: 'procurement.' },
  { title: 'Производство', prefix: 'production.' },
  { title: 'Платежи', prefix: 'payments.' },
  { title: 'Счета', prefix: 'invoices.' },
  { title: 'Документы', prefix: 'documents.' },
  { title: 'Отчёты', prefix: 'reports.' },
  { title: 'Сотрудники и зарплата', prefix: 'employees.' },
  { title: 'Поставщики', prefix: 'suppliers.' },
  { title: 'Настройки', prefix: 'settings.' },
  { title: 'Аудит', prefix: 'audit.' },
];
