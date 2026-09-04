import { useState } from 'react';
import { Plus, ClipboardList, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useStockCounts, useStockCount, useStockCountReport, useLocations } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, fmtMoney, fmtNum, STATUS_BADGE } from '@/lib/utils';
import { can } from '@/stores/auth';

export default function StockCounts() {
  const { data: counts } = useStockCounts();
  const { data: locations } = useLocations();
  const qc = useQueryClient();
  const pag = usePagination(counts, 10);
  const [startOpen, setStartOpen] = useState(false);
  const [form, setForm] = useState({ locationId: '', notes: '' });
  const [activeCount, setActiveCount] = useState<number | null>(null);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['stock-counts'] });
  };

  const startMutation = useMutation({
    mutationFn: (body: any) => api('/api/stock-counts', { method: 'POST', body }),
    onSuccess: (res: any) => {
      toast.success('تم بدء الجرد');
      setStartOpen(false);
      setForm({ locationId: '', notes: '' });
      invalidate();
      setActiveCount(res.id);
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const completeMutation = useMutation({
    mutationFn: () => api(`/api/stock-counts/${activeCount}/complete`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('تم إنهاء الجرد — يمكنك الآن عرض تقرير الفروقات');
      invalidate();
      qc.invalidateQueries({ queryKey: ['report-discrepancies'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الجرد الدوري"
        description="جرد لمكان محدد في تاريخ محدد مع تقرير فروقات"
        actions={
          can('stockcount.manage') ? (
            <Button variant="brand" onClick={() => setStartOpen(true)}>
              <Plus className="h-4 w-4" /> بدء جرد جديد
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>#</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>البداية</TableHead>
                <TableHead>بواسطة</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-mono text-xs">{c.id}</TableCell>
                  <TableCell>{c.locationName}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(c.startedAt)}</TableCell>
                  <TableCell className="text-xs">{c.startedByName}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[c.status]}>{c.status === 'in_progress' ? 'جاري' : 'مكتمل'}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <Button variant="outline" size="sm" onClick={() => setActiveCount(c.id)}>
                      <ClipboardList className="h-3.5 w-3.5" /> {c.status === 'completed' ? 'التقرير' : 'استكمال'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(counts ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">لا توجد جردات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog open={startOpen} onClose={() => setStartOpen(false)} title="بدء جرد جديد">
        <div className="space-y-4">
          <div>
            <Label>الفرع *</Label>
            <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">اختر الفرع…</option>
              {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
            </Select>
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStartOpen(false)}>إلغاء</Button>
          <Button variant="brand" disabled={!form.locationId} onClick={() => startMutation.mutate(form)}>
            بدء الجرد
          </Button>
        </div>
      </Dialog>

      {activeCount != null && <CountWorkbench id={activeCount} onClose={() => setActiveCount(null)} onComplete={() => completeMutation.mutate()} completing={completeMutation.isPending} />}
    </div>
  );
}

function CountWorkbench({
  id, onClose, onComplete, completing,
}: { id: number; onClose: () => void; onComplete: () => void; completing: boolean }) {
  const { data: count, isLoading } = useStockCount(id);
  const { data: report } = useStockCountReport(id);
  const qc = useQueryClient();

  const markMutation = useMutation({
    mutationFn: (body: any) => api(`/api/stock-counts/${id}/items`, { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock-count', id] });
      qc.invalidateQueries({ queryKey: ['stock-count-report', id] });
    },
  });

  const [countedMap, setCountedMap] = useState<Record<number, number>>({});

  const mark = (itemId: number, countedQty: number) => markMutation.mutate({ itemId, countedQty });

  const done = count?.status === 'completed';

  const pagExpected = usePagination(count?.expected, 10, count?.id);

  return (
    <Dialog
      open
      onClose={onClose}
      title={done ? 'تقرير الفروقات' : `جرد ${count?.locationName ?? ''}`}
      description={done ? 'القطع الناقصة/الزائدة وقيمتها بسعر اليوم' : 'أشّر على كل قطعة: موجودة / مفقودة'}
      className="max-w-4xl"
      footer={
        !done ? (
          <Button
            variant="brand"
            loading={completing}
            onClick={async () => {
              if (await confirmDialog('إنهاء الجرد وإصدار تقرير الفروقات؟')) onComplete();
            }}
          >
            <CheckCircle2 className="h-4 w-4" /> إنهاء وإصدار التقرير
          </Button>
        ) : (
          <Button variant="brand" onClick={onClose}>إغلاق</Button>
        )
      }
    >
      {isLoading && <div className="py-10 text-center text-slate-400">جارٍ التحميل…</div>}

      {!done && count && (
        <div className="space-y-4">
          <div>
            <h4 className="mb-2 text-sm font-bold text-slate-700">القائمة المتوقعة ({count.expected?.length ?? 0})</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>القطعة</TableHead>
                  <TableHead>الوزن</TableHead>
                  <TableHead>المتوقع</TableHead>
                  <TableHead>المعدود</TableHead>
                  <TableHead>الحالة</TableHead>
                  <TableHead>الإجراء</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {pagExpected.slice.map((it) => {
                  const val = countedMap[it.id] ?? it.countedQty ?? it.expectedQty ?? 0;
                  const derived = val < (it.expectedQty ?? 0) ? 'missing' : val > (it.expectedQty ?? 0) ? 'unexpected' : 'found';
                  return (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="font-mono text-xs font-bold">{it.code}</div>
                        {it.name && <div className="text-xs text-slate-400">{it.name}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{it.weightG != null ? `${fmtNum(it.weightG)} جم` : '—'}</TableCell>
                      <TableCell className="text-xs">{it.expectedQty}</TableCell>
                      <TableCell className="text-xs">
                        <Input
                          type="number"
                          min={0}
                          className="w-16"
                          value={val}
                          onChange={(e) => setCountedMap((m) => ({ ...m, [it.id]: Math.max(0, Number(e.target.value) || 0) }))}
                        />
                      </TableCell>
                      <TableCell>
                        <Badge tone={STATUS_BADGE[derived]}>
                          {derived === 'found' ? 'موجودة' : derived === 'missing' ? 'مفقودة' : 'زيادة'}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="brand" onClick={() => mark(it.id, val)}>
                          {it.countedQty == null && val === (it.expectedQty ?? 0) ? 'تأكيد' : 'حفظ'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
                {(count.expected ?? []).length === 0 && (
                  <TableRow><TableCell colSpan={6} className="text-center text-slate-400">لا توجد قطع متوقعة</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
            <Pagination {...pagExpected} pageSize={pagExpected.pageSize} onPageSizeChange={pagExpected.setPageSize} />
          </div>

          {(count.extra ?? []).length > 0 && (
            <div>
              <h4 className="mb-2 text-sm font-bold text-amber-700">قطع غير متوقعة في المكان ({count.extra.length})</h4>
              <Table>
                <TableHeader>
                  <TableRow><TableHead>القطعة</TableHead><TableHead>الوزن</TableHead><TableHead>الكمية</TableHead><TableHead>الإجراء</TableHead></TableRow>
                </TableHeader>
                <TableBody>
                  {(count.extra ?? []).map((it) => (
                    <TableRow key={it.id}>
                      <TableCell>
                        <div className="font-mono text-xs font-bold">{it.code}</div>
                        {it.name && <div className="text-xs text-slate-400">{it.name}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{it.weightG != null ? `${fmtNum(it.weightG)} جم` : '—'}</TableCell>
                      <TableCell className="text-xs">
                        <Input
                          type="number"
                          min={1}
                          className="w-16"
                          value={countedMap[it.id] ?? 1}
                          onChange={(e) => setCountedMap((m) => ({ ...m, [it.id]: Math.max(1, Number(e.target.value) || 1) }))}
                        />
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="outline" onClick={() => mark(it.id, countedMap[it.id] ?? 1)}>تأكيد زيادة</Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {done && report && (
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <div className="text-xs text-slate-500">مفقودة</div>
              <div className="text-lg font-extrabold text-rose-600">{report.totals?.find((t: any) => t.countedStatus === 'missing')?.count ?? 0}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <div className="text-xs text-slate-500">زيادة</div>
              <div className="text-lg font-extrabold text-violet-600">{report.totals?.find((t: any) => t.countedStatus === 'unexpected')?.count ?? 0}</div>
            </div>
            <div className="rounded-lg bg-slate-50 p-3 text-center">
              <div className="text-xs text-slate-500">صافي القيمة</div>
              <div className="text-lg font-extrabold text-slate-900">{fmtMoney(report.totals?.reduce((s: number, t: any) => s + Number(t.totalValue || 0), 0) || 0)}</div>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>المعدن/العيار</TableHead>
                <TableHead>الوزن</TableHead>
                <TableHead>المتوقع</TableHead>
                <TableHead>المعدود</TableHead>
                <TableHead>الفرق</TableHead>
                <TableHead>سعر اليوم</TableHead>
                <TableHead>القيمة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...(report.missing ?? []), ...(report.extra ?? [])].map((r: any, i: number) => (
                <TableRow key={i}>
                  <TableCell className="font-mono text-xs font-bold">{r.code}</TableCell>
                  <TableCell className="text-xs">{r.metalType} {r.carat && `— ${r.carat}`}</TableCell>
                  <TableCell className="text-xs">{fmtNum(r.weightG)} جم</TableCell>
                  <TableCell className="text-xs">{r.expectedQty}</TableCell>
                  <TableCell className="text-xs">{r.countedQty}</TableCell>
                  <TableCell className="text-xs">{fmtNum(r.diffQty)}</TableCell>
                  <TableCell className="text-xs">{fmtMoney(r.pricePerGram)}</TableCell>
                  <TableCell>{fmtMoney(r.metalValue)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[r.countedStatus]}>
                      {r.countedStatus === 'missing' ? 'ناقصة' : 'زائدة'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {report.missing?.length === 0 && report.extra?.length === 0 && (
                <TableRow><TableCell colSpan={9} className="text-center text-emerald-600">لا توجد فروقات — الجرد مطابق</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      )}
    </Dialog>
  );
}
