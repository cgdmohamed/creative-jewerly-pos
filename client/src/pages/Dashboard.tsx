import { Link } from 'react-router-dom';
import { Coins, Package, ShoppingCart, TrendingUp, CalendarRange, Wallet, AlertTriangle, Clock, ClipboardCheck, Scale } from 'lucide-react';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useActivePrices, useCurrentShift, useLocations, usePaymentMethods } from '@/hooks/useData';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { fmtMoney, metalColor, metalLabel, methodColor, methodName } from '@/lib/utils';

const METAL_COLORS: Record<string, string> = { gold: '#f59e0b', silver: '#94a3b8' };

const fmtCompact = (n: number | string) => {
  const v = Number(n);
  if (v >= 1000) return `${(v / 1000).toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 1 })} ألف`;
  return v.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 0 });
};

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
      {label && <div className="mb-1 font-bold text-slate-900">{label}</div>}
      <div className="font-semibold text-brand-700">{fmtMoney(payload[0].value)} ج.م</div>
    </div>
  );
}

function SalesTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = new Date(label + 'T00:00:00');
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
      <div className="font-bold text-slate-900">
        {d.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long' })}
      </div>
      <div className="text-brand-700">{fmtMoney(payload[0].value)} ج.م</div>
      <div className="text-slate-500">القطع: {payload[0].payload.count}</div>
    </div>
  );
}

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  gradient,
}: {
  icon: any;
  label: string;
  value: string;
  sub: string;
  gradient: string;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-4 p-5">
        <div className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-white ${gradient}`}>
          <Icon className="h-6 w-6" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="truncate text-xl font-extrabold text-slate-900">{value}</div>
          <div className="truncate text-xs text-slate-400">{sub}</div>
        </div>
      </CardContent>
    </Card>
  );
}

function DonutCard({
  title,
  data,
  colors,
  nameOf,
  center,
}: {
  title: string;
  data: any[];
  colors: Record<string, string>;
  nameOf: (k: string) => string;
  center?: React.ReactNode;
}) {
  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
            <Wallet className="h-4 w-4" />
          </span>
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="relative mx-auto h-40 w-40">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="total"
                nameKey="key"
                innerRadius={54}
                outerRadius={72}
                paddingAngle={data.length > 1 ? 3 : 0}
                stroke="none"
              >
                {data.map((d) => (
                  <Cell key={d.key} fill={colors[d.key] ?? '#64748b'} />
                ))}
              </Pie>
              <Tooltip content={<MoneyTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
            {center}
          </div>
        </div>
        <div className="mt-4 space-y-1.5">
          {data.map((d) => (
            <div key={d.key} className="flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: colors[d.key] ?? '#64748b' }} />
                {nameOf(d.key)}
              </span>
              <span className="font-bold text-slate-900">{fmtMoney(d.total)} ج.م</span>
            </div>
          ))}
          {data.length === 0 && <div className="py-6 text-center text-sm text-slate-400">لا توجد مبيعات في آخر 30 يومًا</div>}
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { data: prices } = useActivePrices();
  const { data: shift } = useCurrentShift();
  const { data: locations } = useLocations();
  const { data: payMethods } = usePaymentMethods();
  const { data: inventory } = useQuery({
    queryKey: ['dashboard-data'],
    queryFn: () => api<any>('/api/dashboard'),
    staleTime: 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api<any>('/api/alerts'),
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const alerts = (alertsData?.alerts ?? []) as any[];
  const ALERT_META: Record<string, { label: string; icon: any; tone: string }> = {
    open_shifts: { label: 'شيفت مفتوح لم يُقفل بعد', icon: Clock, tone: 'bg-amber-100 text-amber-700' },
    open_stock_counts: { label: 'جرد مخزون غير مكتمل', icon: ClipboardCheck, tone: 'bg-amber-100 text-amber-700' },
    placeholder_weight: { label: 'قطعة بوزن افتراضي — تحتاج مراجعة الوزن', icon: Scale, tone: 'bg-rose-100 text-rose-700' },
    no_price_today: { label: 'قطعة متاحة بلا سعر اليوم — لا يمكن بيعها', icon: Coins, tone: 'bg-rose-100 text-rose-700' },
  };

  const s = inventory?.summary;
  const byLocation = (inventory?.inventory?.byLocation ?? []) as any[];
  const invTotal = byLocation.reduce((acc, l) => acc + Number(l.totalValue), 0);
  const pieces = byLocation.reduce((acc, l) => acc + Number(l.pieceCount), 0);

  const gold21 = (prices ?? []).find((p) => p.metalType === 'gold' && p.carat === '21');
  const goldPrice = gold21 ?? (prices ?? []).find((p) => p.metalType === 'gold');

  const metalData = ((inventory?.byMetal ?? []) as any[]).map((m) => ({ ...m, key: m.metalType }));
  const methodData = ((inventory?.byMethod ?? []) as any[])
    .map((m) => ({
      ...m,
      key: m.method,
      color: methodColor(m.method, payMethods),
      label: methodName(m.method, payMethods),
    }));
  const payColors: Record<string, string> = {};
  for (const m of methodData) payColors[m.key] = m.color;
  const locChart = [...byLocation].sort((a, b) => Number(b.totalValue) - Number(a.totalValue));

  const weekTotal = (inventory?.daily ?? []).reduce((acc: number, d: any) => acc + Number(d.total), 0);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="لوحة التحكم"
        description="نظرة فورية على المبيعات والمخزون وأسعار اليوم"
        actions={
          <div className="flex items-center gap-3">
            <Badge tone="bg-white text-slate-600 border border-slate-200">
              <CalendarRange className="h-3.5 w-3.5" />
              {new Date().toLocaleDateString('ar-EG-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            </Badge>
            <Link to="/pos">
              <Button variant="brand">
                <ShoppingCart className="h-4 w-4" /> فتح نقطة البيع
              </Button>
            </Link>
          </div>
        }
      />

      {/* System alerts */}
      {alerts.length > 0 && (
        <Card className="mb-6 border-amber-200 bg-amber-50/40">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-100 text-amber-700">
                <AlertTriangle className="h-4 w-4" />
              </span>
              تنبيهات تحتاج مراجعة
            </CardTitle>
            <span className="text-xs text-slate-500">{alerts.length} فئات تحتاج اهتمامًا</span>
          </CardHeader>
          <CardContent className="grid gap-2 lg:grid-cols-2">
            {alerts.map((a) => {
              const meta = ALERT_META[a.key] ?? { label: a.key, icon: AlertTriangle, tone: 'bg-slate-100 text-slate-600' };
              const Icon = meta.icon;
              return (
                <Link
                  key={a.key}
                  to={a.link}
                  className="flex min-w-0 items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3 transition-colors hover:border-brand-400 hover:bg-brand-50"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${meta.tone}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-slate-900">{meta.label}</div>
                      {a.detail?.[0] && (
                        <div className="truncate text-xs text-slate-500">
                          {a.detail
                            .slice(0, 2)
                            .map((d: any) => d.employeeName || d.locationName || d.startedByName || d.name || d.code)
                            .filter(Boolean)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                  <Badge tone={a.severity === 'high' ? 'bg-rose-100 text-rose-800' : 'bg-amber-100 text-amber-800'}>
                    {a.count}
                  </Badge>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* KPIs */}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <KpiCard
          icon={TrendingUp}
          label="مبيعات اليوم"
          value={`${fmtMoney(s?.todaySales)} ج.م`}
          sub={`${s?.todayInvoices ?? 0} فاتورة`}
          gradient="bg-gradient-to-br from-brand-500 to-brand-700"
        />
        <KpiCard
          icon={CalendarRange}
          label="مبيعات آخر 14 يومًا"
          value={`${fmtMoney(weekTotal)} ج.م`}
          sub={`${s?.weekSales ? `هذا الأسبوع: ${fmtMoney(s.weekSales)}` : '—'} ج.م`}
          gradient="bg-gradient-to-br from-sky-500 to-indigo-600"
        />
        <KpiCard
          icon={Package}
          label="قيمة المخزون المتاح"
          value={`${fmtMoney(invTotal)} ج.م`}
          sub={`${pieces} قطعة متاحة`}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-700"
        />
        <KpiCard
          icon={Coins}
          label="سعر الذهب اليوم"
          value={goldPrice ? `${fmtMoney(goldPrice.pricePerGram)} ج.م` : '—'}
          sub={goldPrice ? `جرام عيار ${goldPrice.carat || '—'}` : 'لم يُحدَّد بعد'}
          gradient="bg-gradient-to-br from-amber-400 to-amber-600"
        />
      </div>

      {/* Sales trend + metal mix */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 transition-shadow hover:shadow-md">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <TrendingUp className="h-4 w-4" />
              </span>
              حركة المبيعات (آخر 14 يومًا)
            </CardTitle>
            <Link to="/reports" className="text-sm font-medium text-brand-600 hover:underline">
              التقارير الكاملة
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={inventory?.daily ?? []} margin={{ top: 6, right: 6, left: -10, bottom: 0 }}>
                  <defs>
                    <linearGradient id="salesFill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#bd5510" stopOpacity={0.28} />
                      <stop offset="100%" stopColor="#bd5510" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(d) => new Date(d + 'T00:00:00').toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'numeric' })}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={{ stroke: '#e2e8f0' }}
                  />
                  <YAxis
                    tickFormatter={fmtCompact}
                    tick={{ fontSize: 11, fill: '#94a3b8' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip content={<SalesTooltip />} />
                  <Area type="monotone" dataKey="total" stroke="#bd5510" strokeWidth={2.5} fill="url(#salesFill)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <DonutCard
          title="توزيع المبيعات حسب المعدن"
          data={metalData}
          colors={METAL_COLORS}
          nameOf={metalLabel}
          center={
            <>
              <div className="text-[11px] text-slate-400">الإجمالي</div>
              <div className="text-sm font-extrabold text-slate-900">
                {fmtMoney(metalData.reduce((a: number, d: any) => a + Number(d.total), 0))}
              </div>
            </>
          }
        />
      </div>

      {/* Inventory by location + payment methods */}
      <div className="mb-6 grid gap-6 lg:grid-cols-3">
        <DonutCard
          title="طرق الدفع (آخر 30 يومًا)"
          data={methodData}
          colors={payColors}
          nameOf={(k) => methodData.find((d: any) => d.key === k)?.label ?? k}
          center={
            <>
              <div className="text-[11px] text-slate-400">فواتير</div>
              <div className="text-sm font-extrabold text-slate-900">
                {methodData.reduce((a: number, d: any) => a + Number(d.count), 0)}
              </div>
            </>
          }
        />

        <Card className="lg:col-span-2 transition-shadow hover:shadow-md">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Package className="h-4 w-4" />
              </span>
              قيمة المخزون حسب الفرع
            </CardTitle>
            <Link to="/locations" className="text-sm font-medium text-brand-600 hover:underline">
              إدارة الفروع
            </Link>
          </CardHeader>
          <CardContent>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={locChart} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                  <XAxis type="number" tickFormatter={fmtCompact} tick={{ fontSize: 11, fill: '#94a3b8' }} tickLine={false} axisLine={false} />
                  <YAxis
                    type="category"
                    dataKey="locationName"
                    width={100}
                    tick={{ fontSize: 12, fill: '#334155' }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    cursor={{ fill: '#fff8f1' }}
                    content={({ active, payload }: any) =>
                      active && payload?.length ? (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-xl">
                          <div className="font-bold text-slate-900">{payload[0].payload.locationName}</div>
                          <div className="text-brand-700">{fmtMoney(payload[0].value)} ج.م</div>
                          <div className="text-slate-500">{payload[0].payload.pieceCount} قطعة متاحة</div>
                        </div>
                      ) : null
                    }
                  />
                  <Bar dataKey="totalValue" fill="#ea6205" radius={[0, 6, 6, 0]} barSize={20} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Today prices + shift */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2 transition-shadow hover:shadow-md">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <Coins className="h-4 w-4" />
              </span>
              أسعار اليوم
            </CardTitle>
            <Link to="/pricing" className="text-sm font-medium text-brand-600 hover:underline">
              تعديل الأسعار
            </Link>
          </CardHeader>
          <CardContent>
            {(prices ?? []).length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                لم يُحدَّد سعر اليوم بعد — لا يمكن البيع حتى يتم تحديد الأسعار.
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(prices ?? []).map((p) => (
                <div
                  key={p.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 transition-colors hover:border-brand-200 hover:bg-brand-50/50"
                >
                  <div>
                    <div className="text-sm font-bold text-slate-900">
                      {metalLabel(p.metalType)} {p.carat ? `— عيار ${p.carat}` : ''}
                    </div>
                    <div className="text-xs text-slate-500">{fmtMoney(p.pricePerGram)} ج.م / جم</div>
                  </div>
                  <Badge tone={metalColor(p.metalType)}>{metalLabel(p.metalType)}</Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="transition-shadow hover:shadow-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <TrendingUp className="h-4 w-4" />
              </span>
              حالة الشيفت
            </CardTitle>
          </CardHeader>
          <CardContent>
            {shift?.status === 'open' ? (
              <div className="space-y-3">
                <Badge tone="bg-emerald-100 text-emerald-800">شيفت مفتوح الآن</Badge>
                <div className="text-sm text-slate-600">
                  فُتح في{' '}
                  {new Date(shift.openedAt).toLocaleString('ar-EG-u-nu-latn', {
                    day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit',
                  })}
                </div>
                <Link to="/shifts" className="block">
                  <Button variant="outline" size="sm" className="w-full">
                    إقفال الشيفت والتسوية
                  </Button>
                </Link>
              </div>
            ) : (
              <div className="space-y-3">
                <Badge tone="bg-slate-200 text-slate-700">لا يوجد شيفت مفتوح</Badge>
                <p className="text-sm text-slate-500">
                  افتح شيفت لتسجيل المبيعات وتصفية الخزينة في نهاية الوردية.
                </p>
                <Link to="/shifts" className="block">
                  <Button variant="brand" size="sm" className="w-full">
                    فتح شيفت
                  </Button>
                </Link>
              </div>
            )}
            {(locations ?? []).length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <div className="mb-2 text-xs font-medium text-slate-400">الفروع النشطة</div>
                <div className="space-y-1">
                  {(locations ?? []).map((l) => (
                    <div key={l.id} className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-600">{l.nameAr}</span>
                      <span className="text-slate-400">{l.code}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
