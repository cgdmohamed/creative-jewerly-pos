import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, ShoppingCart, Package, Coins, MapPin, ArrowLeftRight,
  ClipboardList, FileText, HandCoins, Clock3, BarChart3, Users, LogOut, Gem, Wallet, Settings, Menu, X, BookUser, ShoppingBag,
} from 'lucide-react';
import { useAuth } from '@/stores/auth';
import { useOfflineStore } from '@/stores/offline';
import { refreshOfflineCache } from '@/lib/offlineCache';
import { cn } from '@/lib/utils';
import { Toaster, toast } from '@/components/ui/toast';
import { Badge } from '@/components/ui/badge';
import { useCurrentShift } from '@/hooks/useData';
import { useIdle } from '@/hooks/useIdle';
import { isScreenLocked, setScreenLocked } from '@/lib/lock';
import LockScreen from '@/components/LockScreen';
import ConnectionStatus from '@/components/ConnectionStatus';

const IDLE_LOCK_MS = 5 * 60 * 1000; // lock after 5 minutes without activity

const ICONS = {
  dashboard: LayoutDashboard,
  pos: ShoppingCart,
  items: Package,
  pricing: Coins,
  locations: MapPin,
  transfers: ArrowLeftRight,
  stockCounts: ClipboardList,
  invoices: FileText,
  reservations: HandCoins,
  shifts: Clock3,
  reports: BarChart3,
  employees: Users,
  customers: BookUser,
  paymentMethods: Wallet,
  settings: Settings,
  woocommerce: ShoppingBag,
} as const;

const PATHS: Record<string, string> = {
  dashboard: '/',
  pos: '/pos',
  items: '/items',
  pricing: '/pricing',
  locations: '/locations',
  transfers: '/transfers',
  stockCounts: '/stock-counts',
  invoices: '/invoices',
  reservations: '/reservations',
  shifts: '/shifts',
  reports: '/reports',
  employees: '/employees',
  customers: '/customers',
  paymentMethods: '/payment-methods',
  settings: '/settings',
  woocommerce: '/woocommerce',
};

const MENU: { group: string; items: { key: keyof typeof ICONS; permission?: string }[] }[] = [
  {
    group: 'الرئيسية',
    items: [
      { key: 'dashboard' },
      { key: 'pos', permission: 'invoice.create' },
      { key: 'items' },
      { key: 'pricing', permission: 'pricing.set' },
    ],
  },
  {
    group: 'العمليات',
    items: [
      { key: 'locations', permission: 'locations.manage' },
      { key: 'transfers', permission: 'movement.create' },
      { key: 'stockCounts', permission: 'stockcount.manage' },
      { key: 'invoices' },
      { key: 'reservations', permission: 'reservation.manage' },
      { key: 'shifts' },
    ],
  },
  {
    group: 'الإدارة',
    items: [
      { key: 'customers', permission: 'customers.manage' },
      { key: 'employees', permission: 'employees.manage' },
      { key: 'reports', permission: 'reports.view' },
      { key: 'paymentMethods', permission: 'settings.manage' },
      { key: 'woocommerce', permission: 'woocommerce.manage' },
      { key: 'settings', permission: 'settings.manage' },
    ],
  },
];

export default function AppShell() {
  const { employee, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data: shift } = useCurrentShift();
  const [locked, setLocked] = useState(isScreenLocked);
  const [menuOpen, setMenuOpen] = useState(false);
  const idle = useIdle(IDLE_LOCK_MS, !locked);

  const applyLock = (v: boolean) => {
    setScreenLocked(v);
    setLocked(v);
  };

  // On load and whenever the connection returns: flush queued offline ops,
  // refresh the offline cache, then refetch all queries.
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      try {
        const report = await useOfflineStore.getState().syncNow();
        if (!cancelled && report) {
          if (report.failed > 0) {
            toast.warning(`تمت المزامنة: نجحت ${report.applied}، فشلت ${report.failed} — راجع القائمة المعلقة`);
          } else if (report.applied > 0) {
            toast.success(`تمت مزامنة ${report.applied} عملية محلية`);
          }
        }
      } catch {
        /* still offline or request failed — will retry on next 'online' event */
      }
      await refreshOfflineCache();
      if (!cancelled) qc.invalidateQueries();
    };
    void run();
    window.addEventListener('online', run);
    return () => {
      cancelled = true;
      window.removeEventListener('online', run);
    };
  }, [qc]);

  useEffect(() => {
    if (idle) applyLock(true);
  }, [idle]);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  const menu = MENU.map((g) => ({
    ...g,
    items: g.items.filter((m) => {
      if (!m.permission) return true;
      return employee?.permissions.includes(m.permission);
    }),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="flex min-h-screen">
      {locked && <LockScreen onUnlock={() => applyLock(false)} />}

      {/* mobile top bar */}
      <div className="fixed inset-x-0 top-0 z-20 flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-3 md:hidden">
        <button
          onClick={() => setMenuOpen((o) => !o)}
          className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
          aria-label="القائمة"
        >
          {menuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
        </button>
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-brand-500 to-brand-700 text-white">
            <Gem className="h-4 w-4" />
          </div>
          <span className="text-sm font-extrabold text-slate-900">سبائك ومشغولات</span>
        </div>
        <div className="mr-auto flex items-center gap-2">
          <div className="h-7 w-7 rounded-full bg-brand-100 text-center text-sm font-bold leading-7 text-brand-700">
            {employee?.fullName?.charAt(0) ?? '؟'}
          </div>
          <button
            onClick={() => {
              logout();
              navigate('/login');
            }}
            className="text-slate-400 hover:text-rose-600"
            title="تسجيل خروج"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 right-0 z-30 flex w-64 flex-col border-l border-slate-200 bg-white transition-transform duration-200 md:translate-x-0',
          'max-md:bottom-0 max-md:top-14',
          menuOpen ? 'max-md:translate-x-0' : 'max-md:translate-x-full',
        )}
      >
        <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-md shadow-brand-600/25">
            <Gem className="h-5 w-5" />
          </div>
          <div>
            <div className="text-sm font-extrabold text-slate-900">سبائك ومشغولات</div>
            <div className="text-xs text-slate-500">نظام الإدارة الداخلية</div>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3">
          {menu.map((group) => (
            <div key={group.group} className="mb-1">
              <div className="mb-1 mt-4 px-3 text-[11px] font-bold uppercase tracking-wide text-slate-400 first:mt-0">
                {group.group}
              </div>
              <ul className="space-y-1">
                {group.items.map((m) => {
                  const Icon = ICONS[m.key];
                  return (
                    <li key={m.key}>
                      <NavLink
                        to={PATHS[m.key]}
                        className={({ isActive }) =>
                          cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors',
                            isActive
                              ? 'bg-brand-50 text-brand-700'
                              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
                          )
                        }
                      >
                        <Icon className="h-4.5 w-4.5" />
                        <span>
                          {m.key === 'dashboard' ? 'لوحة التحكم' : label(m.key)}
                        </span>
                      </NavLink>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className="border-t border-slate-100 p-3">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 p-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 font-bold text-brand-700">
              {employee?.fullName?.charAt(0) ?? '؟'}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold text-slate-900">{employee?.fullName}</div>
              <div className="truncate text-xs text-slate-500">{employee?.role}</div>
            </div>
            <button
              onClick={() => {
                logout();
                navigate('/login');
              }}
              className="text-slate-400 hover:text-rose-600"
              title="تسجيل خروج"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
          {shift?.status === 'open' && (
            <Badge tone="bg-emerald-100 text-emerald-800" className="mt-2 w-full justify-center">
              شيفت مفتوح
            </Badge>
          )}
        </div>
      </aside>

      <main className="mr-0 min-w-0 flex-1 pt-14 md:mr-64 md:pt-0">
        <ConnectionStatus />
        <div key={location.pathname} className="animate-page">
          <Outlet />
        </div>
      </main>      <Toaster />
    </div>
  );
}

const LABELS: Record<string, string> = {
  pos: 'نقطة البيع',
  items: 'المخزون',
  pricing: 'التسعير اليومي',
  locations: 'الفروع والمواقع',
  transfers: 'النقل بين الفروع',
  stockCounts: 'الجرد',
  invoices: 'الفواتير',
  reservations: 'الحجوزات والعربون',
  shifts: 'الشيفتات',
  reports: 'التقارير',
  employees: 'الموظفين',
  customers: 'العملاء',
  paymentMethods: 'طرق الدفع',
  settings: 'الإعدادات',
  woocommerce: 'المتجر الإلكتروني',
};

function label(k: string) {
  return LABELS[k] ?? k;
}
