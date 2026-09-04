import { useState } from 'react';
import { Save, RefreshCw } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { toast } from '@/components/ui/toast';
import { useSettings } from '@/hooks/useData';
import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { can } from '@/stores/auth';
import type { WcConfig, WcSyncResult } from '@/lib/types';

const OP_OPTIONS = [
  { key: 'products.in', label: 'استيراد المنتجات' },
  { key: 'stock.push', label: 'دفع الكميات والأسعار' },
  { key: 'customers.in', label: 'استيراد العملاء' },
  { key: 'customers.out', label: 'تصدير العملاء' },
  { key: 'orders.in', label: 'استيراد الطلبات' },
];

const FEATURES = [
  {
    key: 'cashier_discount_enabled' as const,
    title: 'السماح للكاشير بمنح الخصم',
    description: 'عند إيقافها لا يمكن للكاشير تطبيق أي خصم (نسبة أو قيمة) — المدير وحده يستطيع الخصم.',
  },
  {
    key: 'cashier_cap_override_enabled' as const,
    title: 'السماح بتجاوز سقف الخصم بموافقة المدير',
    description: 'عند إيقافها لا يمكن للكاشير تجاوز سقف الخصم حتى بموافقة المدير — تُرفض الفاتورة تلقائيًا.',
  },
];

export default function Settings() {
  const { data: settings, isLoading } = useSettings();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Record<string, boolean>>({});
  const [vatDraft, setVatDraft] = useState<string>('');
  const isEditing = Object.keys(draft).length > 0 || vatDraft !== '';

  const { data: wcConfig } = useQuery({
    queryKey: ['wc-config'],
    queryFn: () => api<WcConfig>('/api/woocommerce/config'),
    enabled: can('woocommerce.manage'),
  });
  const [autoDraft, setAutoDraft] = useState<{ enabled: boolean; intervalMin: number; ops: string[] } | null>(null);
  const auto = autoDraft ?? (wcConfig ? {
    enabled: wcConfig.autoSync.enabled,
    intervalMin: wcConfig.autoSync.intervalMin,
    ops: wcConfig.autoSync.ops,
  } : null);
  const autoEditing = !!autoDraft;

  const saveAuto = useMutation({
    mutationFn: (body: any) => api('/api/woocommerce/config', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('تم حفظ جدول المزامنة التلقائية');
      setAutoDraft(null);
      qc.invalidateQueries({ queryKey: ['wc-config'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const runNow = useMutation({
    mutationFn: () => api<{ busy: boolean; results: WcSyncResult[] }>('/api/woocommerce/run-auto', { method: 'POST' }),
    onSuccess: (d) => {
      if (d.busy) { toast.warning('عملية مزامنة أخرى جارية حالياً'); return; }
      if (d.results.length === 0) { toast.info('لا توجد عمليات مفعّلة للمزامنة'); return; }
      const total = d.results.reduce((a, r) => a + r.imported + r.updated + r.failed, 0);
      const failed = d.results.reduce((a, r) => a + r.failed, 0);
      toast.success(failed > 0 ? `تمت المزامنة — فشل ${failed} عملية` : `تمت المزامنة (${total} عنصر)`);
      qc.invalidateQueries({ queryKey: ['wc-config'] });
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const save = useMutation({
    mutationFn: (body: Record<string, boolean | string>) => api('/api/settings', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('تم حفظ الإعدادات');
      setDraft({});
      setVatDraft('');
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  if (!can('settings.manage')) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-lg bg-slate-100 p-8 text-center text-slate-500">
          ليس لديك صلاحية لإدارة الإعدادات
        </div>
      </div>
    );
  }

  const value = (key: 'cashier_discount_enabled' | 'cashier_cap_override_enabled') =>
    draft[key] ?? (settings?.[key] ?? 'true') === 'true';

  const vatValue = vatDraft !== '' ? vatDraft : (settings?.vat_percent ?? '0');
  const onSave = () =>
    save.mutate({ ...draft, ...(vatDraft !== '' ? { vat_percent: vatValue } : {}) });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الإعدادات"
        description="تحكم في ميزات خصم الكاشير"
        actions={
          isEditing ? (
            <Button variant="brand" loading={save.isPending} onClick={onSave}>
              <Save className="h-4 w-4" /> حفظ التغييرات
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="space-y-6 p-6">
          {isLoading && <div className="py-8 text-center text-slate-400">جارٍ التحميل…</div>}

          {!isLoading && (
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="font-bold text-slate-900">ضريبة القيمة المضافة</div>
              <div className="mt-1 text-sm text-slate-500">
                تُطبق على إجمالي الفاتورة (قيمة المعدن + المصنعية − الخصم) بعد موافقة المدير على الخصم.
              </div>
              <div className="mt-3 flex items-center gap-3">
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={vatValue}
                  onChange={(e) => setVatDraft(e.target.value)}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-end font-bold focus:border-brand-500 focus:outline-none"
                />
                <span className="text-sm text-slate-500">%</span>
              </div>
            </div>
          )}

          {!isLoading &&
            FEATURES.map((f) => (
              <div key={f.key} className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
                <div>
                  <div className="font-bold text-slate-900">{f.title}</div>
                  <div className="mt-1 text-sm text-slate-500">{f.description}</div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={value(f.key)}
                  onClick={() => setDraft((d) => ({ ...d, [f.key]: !value(f.key) }))}
                  className={cn(
                    'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                    value(f.key) ? 'bg-emerald-500' : 'bg-slate-300',
                  )}
                >
                  <span
                    className={cn(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                      value(f.key) ? 'right-0.5' : 'right-[22px]',
                    )}
                  />
                </button>
              </div>
            ))}

          {!isLoading && (
            <div className="rounded-lg bg-slate-50 p-4 text-xs text-slate-500">
              ملاحظة: سقف خصم الكاشير بالنسبة المئوية يُضبط من صفحة «الموظفين» لكل كاشير على حدة.
            </div>
          )}
        </CardContent>
      </Card>

      {can('woocommerce.manage') && (
        <Card className="mt-5">
          <CardContent className="space-y-5 p-6">
            <div>
              <div className="font-bold text-slate-900">المزامنة التلقائية مع المتجر الإلكتروني</div>
              <div className="mt-1 text-sm text-slate-500">
                تشغيل العمليات تلقائياً كل فترة. تُنفذ عملية واحدة في كل مرة (لا تتداخل)، والحد الأدنى للفاصل 15 دقيقة.
              </div>
            </div>

            {!auto && <div className="py-2 text-sm text-slate-400">جارٍ التحميل…</div>}
            {auto && (
              <>
                <div className="flex items-start justify-between gap-4 rounded-xl border border-slate-200 p-4">
                  <div>
                    <div className="font-bold text-slate-900">تفعيل المزامنة التلقائية</div>
                    <div className="mt-1 text-sm text-slate-500">عند الإيقاف لا تعمل أي مزامنة تلقائية (المزامنة اليدوية من صفحة المتجر تبقى متاحة).</div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={auto.enabled}
                    onClick={() => setAutoDraft((d) => ({ ...(d ?? auto), enabled: !(d ?? auto).enabled }))}
                    className={cn(
                      'relative h-6 w-11 shrink-0 rounded-full transition-colors',
                      auto.enabled ? 'bg-emerald-500' : 'bg-slate-300',
                    )}
                  >
                    <span className={cn(
                      'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
                      auto.enabled ? 'right-0.5' : 'right-[22px]',
                    )} />
                  </button>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="font-bold text-slate-900">الفاصل الزمني</div>
                  <div className="mt-3 flex items-center gap-3">
                    <select
                      value={auto.intervalMin}
                      onChange={(e) => setAutoDraft((d) => ({ ...(d ?? auto), intervalMin: Number(e.target.value) }))}
                      className="h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none"
                    >
                      {[15, 30, 60, 120, 360, 720, 1440].map((m) => (
                        <option key={m} value={m}>
                          {m >= 1440 ? 'يومياً' : m >= 60 ? `كل ${Math.floor(m / 60)} ساعة` : `كل ${m} دقيقة`}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="rounded-xl border border-slate-200 p-4">
                  <div className="mb-2 font-bold text-slate-900">العمليات المضمّنة</div>
                  <div className="grid gap-2 md:grid-cols-2">
                    {OP_OPTIONS.map((o) => {
                      const checked = auto.ops.includes(o.key);
                      return (
                        <label key={o.key} className="flex items-center gap-3 rounded-lg border border-slate-200 px-3 py-2.5">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => setAutoDraft((d) => {
                              const cur = d ?? auto;
                              return { ...cur, ops: checked ? cur.ops.filter((x) => x !== o.key) : [...cur.ops, o.key] };
                            })}
                            className="h-4 w-4 accent-brand-600"
                          />
                          <span className="text-sm text-slate-700">{o.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="brand"
                    loading={saveAuto.isPending}
                    disabled={!autoEditing}
                    onClick={() => saveAuto.mutate({
                      autoSyncEnabled: auto.enabled,
                      autoSyncIntervalMin: auto.intervalMin,
                      autoSyncOps: auto.ops,
                    })}
                  >
                    <Save className="h-4 w-4" /> حفظ الجدول
                  </Button>
                  <Button variant="outline" loading={runNow.isPending} onClick={() => runNow.mutate()}>
                    <RefreshCw className="h-4 w-4" /> تشغيل الآن
                  </Button>
                </div>
                {autoEditing && (
                  <div className="text-xs text-amber-600">توجد تغييرات غير محفوظة على الجدول.</div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
