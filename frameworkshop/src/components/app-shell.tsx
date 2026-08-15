'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  Factory,
  LayoutDashboard,
  Menu,
  Package,
  ShoppingCart,
  Users,
  X,
} from 'lucide-react';
import { Badge, Button, cn } from '@/components/ui';
import { api } from '@/lib/api-client';
import type { SessionUser } from '@/server/auth/session';

interface NavItem {
  href: string;
  label: string;
  icon: typeof LayoutDashboard;
  permission: string;
}

const NAV: NavItem[] = [
  { href: '/', label: 'Дашборд', icon: LayoutDashboard, permission: 'dashboard.view' },
  { href: '/orders', label: 'Заказы', icon: ClipboardList, permission: 'orders.view' },
  { href: '/customers', label: 'Клиенты', icon: Users, permission: 'customers.view' },
  { href: '/catalog', label: 'Каталог', icon: Package, permission: 'catalog.view' },
  { href: '/inventory', label: 'Склад', icon: Boxes, permission: 'inventory.view' },
  { href: '/procurement', label: 'Закупки', icon: ShoppingCart, permission: 'procurement.view' },
  { href: '/production', label: 'Производство', icon: Factory, permission: 'production.view' },
  { href: '/payments', label: 'Оплаты', icon: CreditCard, permission: 'payments.view' },
  { href: '/reports', label: 'Отчёты', icon: BarChart3, permission: 'reports.sales' },
];

function allowed(user: SessionUser, permission: string): boolean {
  return user.permissions.includes('*') || user.permissions.includes(permission);
}

export function AppShell({ user, children }: { user: SessionUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  const items = NAV.filter((item) => allowed(user, item.permission));

  async function signOut() {
    await api.post('/api/auth/logout');
    router.replace('/login');
    router.refresh();
  }

  return (
    <div className="flex min-h-screen">
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-60 flex-col border-r border-line bg-surface',
          'transition-transform lg:translate-x-0',
          menuOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 items-center justify-between border-b border-line px-5">
          <Link href="/" className="font-semibold">
            FrameWorkshop
          </Link>
          <button
            className="lg:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Закрыть меню"
          >
            <X className="size-5 text-ink-muted" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {items.map((item) => {
            const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className={cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  active
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-ink-muted hover:bg-surface-muted hover:text-ink',
                )}
              >
                <item.icon className="size-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-line p-4">
          <p className="text-sm font-medium">
            {user.firstName} {user.lastName}
          </p>
          <Badge tone="accent" className="mt-1">
            {user.roleName}
          </Badge>
          <Button variant="ghost" size="sm" className="mt-3 w-full" onClick={signOut}>
            Выйти
          </Button>
        </div>
      </aside>

      {menuOpen ? (
        <div
          className="fixed inset-0 z-30 bg-ink/20 lg:hidden"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col lg:pl-60">
        <header className="flex h-16 items-center gap-3 border-b border-line bg-surface px-5 lg:hidden">
          <button onClick={() => setMenuOpen(true)} aria-label="Открыть меню">
            <Menu className="size-5" />
          </button>
          <span className="font-semibold">FrameWorkshop</span>
        </header>

        <main className="flex-1 p-5 lg:p-8">{children}</main>
      </div>
    </div>
  );
}
