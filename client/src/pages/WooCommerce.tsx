import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ShoppingBag, Download, Upload, ClipboardList, RefreshCw, Cable, CheckCircle2, XCircle, Database,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { can } from '@/stores/auth';
import { fmtDateTime } from '@/lib/utils';
import type { WcConfig, WcSyncResult, WcLogRow } from '@/lib/types';
import { usePagination } from '@/hooks/usePagination';

const TABS = [
  { key: 'products', label: 'المنتجات' },
  { key: 'customers', label: 'العملاء' },
  { key: 'orders', label: 'الطلبات' },
  { key: 'logs', label: 'سجل المزامنة' },
];

const OP_LABELS: Record<string, string> = {
  'products.in': 'استيراد المنتجات',
  'stock.push': 'دفع الكميات والأسعار',
  'customers.in': 'استيراد العملاء',
  'customers.out': 'تصدير العملاء',
  'orders.in': 'استيراد الطلبات',
};

export default function WooCommerce() {
  const qc = useQueryClient();
  const [tab, setTab] = useState('products');
  const [url, setUrl] = useState('');
  const [key, setKey] = useState('');
  const [secret, setSecret] = useState('');
  const [testInfo, setTestInfo] = useState<string | null>(null);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [result, setResult] = useState<WcSyncResult | null>(null);
  const [preview, setPreview] = useState<WcSyncResult | null>(null);
  const [orderDays, setOrderDays] = useState('30');

  const { data: config, isLoading } = useQuery({
    queryKey: ['wc-config'],
    queryFn: () => api<WcConfig>('/api/woocommerce/config'),
  });

  if (!can('woocommerce.manage')) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-lg bg-slate-100 p-8 text-center text-slate-500">
          ليس لديك صلاحية لإدارة المتجر الإلكتروني
        </div>
      </div>
    );
  }

  const saveConfig = useMutation({
    mutationFn: (body: any) => api('/api/woocommerce/config', { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('تم حفظ إعدادات المتجر');
      setKey('');
      setSecret('');
      qc.invalidateQueries({ queryKey: ['wc-config'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const testConn = useMutation({
    mutationFn: () => api<any>('/api/woocommerce/test', { method: 'POST' }),
    onSuccess: (d) => {
      setTestOk(true);
      setTestInfo(`تم الاتصال بنجاح — ${d.info?.name ?? ''} (${d.info?.url ?? ''})`);
    },
    onError: (e: any) => {
      setTestOk(false);
      setTestInfo(e.message + (e.message === 'woocommerce.connection_failed' && (e as any).detail ? ` — ${(e as any).detail}` : ''));
    },
  });

  const runSync = useMutation({
    mutationFn: ({ path, body }: { path: string; body?: any }) => api<WcSyncResult>(path, { method: 'POST', body }),
    onSuccess: (d, vars) => {
      setResult(d);
      setPreview(vars.body?.dryRun ? d : preview);
      if (!vars.body?.dryRun) {
        toast.success(`${OP_LABELS[d.op] ?? d.op}: مستورد ${d.imported}، محدث ${d.updated}، فشل ${d.failed}`);
        qc.invalidateQueries({ queryKey: ['items'] });
        qc.invalidateQueries({ queryKey: ['customers'] });
        qc.invalidateQueries({ queryKey: ['wc-logs'] });
      }
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const { data: logs } = useQuery({
    queryKey: ['wc-logs'],
    queryFn: () => api<WcLogRow[]>('/api/woocommerce/logs?limit=50'),
    enabled: tab === 'logs',
  });

  const pagLogs = usePagination(logs, 10);

  const connected = !!config?.configured;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="المتجر الإلكتروني"
        description="ربط ثنائي الاتجاه مع متجر WooCommerce — المنتجات والكميات والعملاء والطلبات"
      />

      {/* Connection card */}
      <Card className="mb-5">
        <CardContent className="space-y-4 p-6">
          <div className="flex items-center gap-2">
            <Cable className="h-5 w-5 text-brand-600" />
            <div className="font-bold text-slate-900">إعدادات الاتصال</div>
            {connected && (
              <Badge tone="bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-3 w-3" /> متصل
              </Badge>
            )}
            {!isLoading && !connected && (
              <Badge tone="bg-rose-100 text-rose-700">
                <XCircle className="h-3 w-3" /> غير مكتمل
              </Badge>
            )}
          </div>

          {isLoading && <div className="py-4 text-center text-sm text-slate-400">جارٍ التحميل…</div>}
          {!isLoading && (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label>رابط المتجر</Label>
                  <Input
                    dir="ltr"
                    placeholder="https://store.example.com"
                    value={url || config?.url || ''}
                    onChange={(e) => setUrl(e.target.value)}
                  />
                  <div className="mt-1 text-xs text-slate-400">من إعدادات WooCommerce → Advanced → REST API</div>
                </div>
                <div>
                  <Label>وزن المنتجات بالكيلوجرام؟</Label>
                  <select
                    value={config?.weightKg ? 'kg' : 'g'}
                    onChange={(e) =>
                      saveConfig.mutate({ weightKg: e.target.value === 'kg' })}
                    className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm focus:border-brand-500 focus:outline-none"
                  >
                    <option value="kg">نعم — الوزن مُدخل بالكيلوجرام (حوّل إلى جرام)</option>
                    <option value="g">لا — الوزن بالجرام مباشرة</option>
                  </select>
                </div>
                <div>
                  <Label>Consumer Key {config?.hasKey && <span className="text-emerald-600">(محفوظ ✓)</span>}</Label>
                  <Input dir="ltr" type="password" placeholder={config?.hasKey ? '••••••••' : 'ck_...'}
                    value={key} onChange={(e) => setKey(e.target.value)} />
                </div>
                <div>
                  <Label>Consumer Secret {config?.hasSecret && <span className="text-emerald-600">(محفوظ ✓)</span>}</Label>
                  <Input dir="ltr" type="password" placeholder={config?.hasSecret ? '••••••••' : 'cs_...'}
                    value={secret} onChange={(e) => setSecret(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="brand" loading={saveConfig.isPending} onClick={() =>
                  saveConfig.mutate({
                    ...(url !== config?.url ? { url } : {}),
                    ...(key ? { consumerKey: key } : {}),
                    ...(secret ? { consumerSecret: secret } : {}),
                  })}>
                  <Database className="h-4 w-4" /> حفظ
                </Button>
                <Button variant="outline" loading={testConn.isPending} onClick={() => testConn.mutate()}>
                  <RefreshCw className="h-4 w-4" /> اختبار الاتصال
                </Button>
              </div>
              {testInfo && (
                <div className={cn('rounded-lg px-4 py-3 text-sm', testOk ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-700')}>
                  {testInfo}
                </div>
              )}
              {config?.autoSync.enabled && (
                <div className="rounded-lg bg-slate-50 px-4 py-3 text-xs text-slate-500">
                  المزامنة التلقائية مفعّلة — كل {config.autoSync.intervalMin} دقيقة
                  ({config.autoSync.ops.map((o) => OP_LABELS[o] ?? o).join('، ')}) — يمكن ضبطها من صفحة الإعدادات.
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              'rounded-lg px-4 py-2 text-sm font-medium transition-colors',
              tab === t.key ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {!connected && tab !== 'logs' && (
        <Card>
          <CardContent className="p-8 text-center text-sm text-slate-500">
            أكمل بيانات الاتصال (الرابط + المفاتيح) ثم اختبر الاتصال قبل المزامنة.
          </CardContent>
        </Card>
      )}

      {/* Products */}
      {tab === 'products' && (
        <div className="space-y-4">
          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-brand-600" />
                <div>
                  <div className="font-bold text-slate-900">استيراد المنتجات</div>
                  <div className="text-sm text-slate-500">
                    يسحب كل منتجات المتجر (الاسم، الوصف، الوزن، المعدن، العيار، الكمية، الصورة، الباركود) ويربطها بالأصناف المحلية عبر SKU/الكود.
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="brand" loading={runSync.isPending} disabled={preview !== null}
                  onClick={() => runSync.mutate({ path: '/api/woocommerce/products/import', body: { dryRun: true } })}>
                  <Download className="h-4 w-4" /> معاينة الاستيراد
                </Button>
                {preview && (
                  <Button variant="default" loading={runSync.isPending}
                    onClick={() => runSync.mutate({ path: '/api/woocommerce/products/import', body: {} })}>
                    <CheckCircle2 className="h-4 w-4" /> تأكيد الاستيراد ({preview.imported + preview.updated} عنصر)
                  </Button>
                )}
              </div>
              {preview && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                  المعاينة: {preview.imported} جديد، {preview.updated} محدث، {preview.skipped} متخطى، {preview.failed} فشل — لم يتم حفظ أي شيء بعد.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-4 p-6">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-brand-600" />
                <div>
                  <div className="font-bold text-slate-900">دفع الكميات والأسعار للمتجر</div>
                  <div className="text-sm text-slate-500">
                    يحدّث الكميات المتاحة (الكمية − المحجوز − العابر) والسعر المحسوب (معدن + مصنعية + ضريبة) لكل صنف مرتبط.
                  </div>
                </div>
              </div>
              <Button variant="outline" loading={runSync.isPending}
                onClick={() => runSync.mutate({ path: '/api/woocommerce/products/export' })}>
                <Upload className="h-4 w-4" /> دفع الكميات والأسعار
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Customers */}
      {tab === 'customers' && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2">
                <Download className="h-5 w-5 text-brand-600" />
                <div className="font-bold text-slate-900">استيراد العملاء</div>
              </div>
              <div className="text-sm text-slate-500">يسحب عملاء المتجر إلى دفتر العملاء المحلي (ربط بالبريد الإلكتروني).</div>
              <Button variant="outline" loading={runSync.isPending}
                onClick={() => runSync.mutate({ path: '/api/woocommerce/customers/import' })}>
                <Download className="h-4 w-4" /> استيراد العملاء
              </Button>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="space-y-3 p-6">
              <div className="flex items-center gap-2">
                <Upload className="h-5 w-5 text-brand-600" />
                <div className="font-bold text-slate-900">تصدير العملاء</div>
              </div>
              <div className="text-sm text-slate-500">يرسل العملاء المحليين إلى المتجر (إنشاء أو تحديث حسب البريد الإلكتروني).</div>
              <Button variant="outline" loading={runSync.isPending}
                onClick={() => runSync.mutate({ path: '/api/woocommerce/customers/export' })}>
                <Upload className="h-4 w-4" /> تصدير العملاء
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Orders */}
      {tab === 'orders' && (
        <Card>
          <CardContent className="space-y-4 p-6">
            <div className="flex items-center gap-2">
              <ShoppingBag className="h-5 w-5 text-brand-600" />
              <div>
                <div className="font-bold text-slate-900">استيراد الطلبات</div>
                <div className="text-sm text-slate-500">
                  يحوّل طلبات المتجر إلى فواتير محلية (مكتمل/قيد المعالجة/معلق) مع ربط العميل وطريقة الدفع. لا يتكرر استيراد نفس الطلب.
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Input type="number" min="1" max="365" value={orderDays}
                onChange={(e) => setOrderDays(e.target.value)} className="w-32" />
              <span className="text-sm text-slate-500">آخر (أيام)</span>
            </div>
            <Button variant="brand" loading={runSync.isPending}
              onClick={() => runSync.mutate({ path: '/api/woocommerce/orders/import', body: { days: Number(orderDays) } })}>
              <ShoppingBag className="h-4 w-4" /> استيراد الطلبات
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      {tab === 'logs' && (
        <Card>
          <CardContent className="p-4">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>الوقت</TableHead>
                  <TableHead>العملية</TableHead>
                  <TableHead>جديد</TableHead>
                  <TableHead>محدث</TableHead>
                  <TableHead>متخطى</TableHead>
                  <TableHead>فشل</TableHead>
                  <TableHead>بواسطة</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {logs?.length === 0 && (
                  <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">لا توجد عمليات مزامنة بعد</TableCell></TableRow>
                )}
                {pagLogs.slice.map((l) => (
                  <TableRow key={l.id}>
                    <TableCell className="text-xs text-slate-500">{fmtDateTime(l.createdAt)}</TableCell>
                    <TableCell className="whitespace-normal">
                      <div className="flex items-center gap-2">
                        {OP_LABELS[l.op] ?? l.op}
                        <Badge tone={l.direction === 'in' ? 'bg-sky-100 text-sky-800' : 'bg-violet-100 text-violet-800'}>
                          {l.direction === 'in' ? 'استيراد' : 'تصدير'}
                        </Badge>
                      </div>
                      {l.errors.length > 0 && (
                        <div className="mt-1 max-h-24 overflow-y-auto text-xs text-rose-600">
                          {l.errors.map((e, i) => (
                            <div key={i}>• #{e.ref}: {e.reason}</div>
                          ))}
                        </div>
                      )}
                    </TableCell>
                    <TableCell>{l.imported}</TableCell>
                    <TableCell>{l.updated}</TableCell>
                    <TableCell>{l.skipped}</TableCell>
                    <TableCell className={l.failed > 0 ? 'font-bold text-rose-600' : ''}>{l.failed}</TableCell>
                    <TableCell className="text-xs text-slate-500">{l.ranByName ?? 'تلقائي'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
            <Pagination {...pagLogs} pageSize={pagLogs.pageSize} onPageSizeChange={pagLogs.setPageSize} />
          </CardContent>
        </Card>
      )}

      {/* Result summary */}
      {result && tab !== 'logs' && (
        <Card className="mt-5">
          <CardContent className="p-5">
            <div className="mb-3 flex items-center gap-2 font-bold text-slate-900">
              <ClipboardList className="h-4 w-4 text-brand-600" />
              نتيجة آخر عملية ({OP_LABELS[result.op] ?? result.op})
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
              <Stat label="جديد" value={result.imported} tone="text-emerald-700" />
              <Stat label="محدث" value={result.updated} tone="text-sky-700" />
              <Stat label="متخطى" value={result.skipped} tone="text-slate-500" />
              <Stat label="فشل" value={result.failed} tone={result.failed > 0 ? 'text-rose-600' : 'text-slate-500'} />
            </div>
            {result.errors.length > 0 && (
              <div className="mt-4 max-h-40 overflow-y-auto rounded-lg bg-rose-50 px-4 py-3 text-xs text-rose-700">
                {result.errors.slice(0, 50).map((e, i) => (
                  <div key={i} className="mb-1">• #{e.ref}: {e.reason}</div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: string }) {
  return (
    <div className="rounded-lg bg-slate-50 p-3 text-center">
      <div className={cn('text-2xl font-extrabold', tone)}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
