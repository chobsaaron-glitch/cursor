import { z } from 'zod';
import { route } from '@/server/api/handler';
import { hasPermission, type Permission } from '@/server/auth/permissions';
import { ForbiddenError } from '@/server/auth/session';
import {
  consumptionReport,
  dashboardSummary,
  financeSummary,
  inventoryReport,
  lastDays,
  mouldingAbc,
  orderProfitability,
  productionSummary,
  revenueSeries,
  salesByEmployee,
  salesByGroup,
} from '@/server/modules/reports/service';

const querySchema = z.object({
  report: z.enum([
    'dashboard',
    'revenue',
    'sales-by-employee',
    'sales-by-group',
    'moulding-abc',
    'finance',
    'production',
    'inventory',
    'consumption',
    'profitability',
  ]),
  days: z.coerce.number().int().min(1).max(730).optional(),
});

/** Each report is gated by the permission for the area it exposes. */
const REPORT_PERMISSIONS: Record<z.infer<typeof querySchema>['report'], Permission> = {
  dashboard: 'dashboard.view',
  revenue: 'reports.sales',
  'sales-by-employee': 'reports.sales',
  'sales-by-group': 'reports.sales',
  'moulding-abc': 'reports.sales',
  finance: 'reports.finance',
  production: 'reports.production',
  inventory: 'reports.inventory',
  consumption: 'reports.inventory',
  profitability: 'reports.finance',
};

export const GET = route(
  { permission: 'dashboard.view', query: querySchema },
  async ({ context, query }) => {
    if (!hasPermission(context.user.permissions, REPORT_PERMISSIONS[query.report])) {
      throw new ForbiddenError();
    }

    const organizationId = context.user.organizationId;
    const days = query.days ?? 30;
    const period = lastDays(days);

    switch (query.report) {
      case 'dashboard':
        return dashboardSummary(organizationId);
      case 'revenue':
        return revenueSeries(organizationId, days);
      case 'sales-by-employee':
        return salesByEmployee(organizationId, period);
      case 'sales-by-group':
        return salesByGroup(organizationId, period);
      case 'moulding-abc':
        return mouldingAbc(organizationId, period);
      case 'finance':
        return financeSummary(organizationId, period);
      case 'production':
        return productionSummary(organizationId, period);
      case 'inventory':
        return inventoryReport(organizationId);
      case 'consumption':
        return consumptionReport(organizationId, period);
      case 'profitability':
        return orderProfitability(organizationId, period);
    }
  },
);
