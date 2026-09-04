import { useState } from 'react';
import { Play, Square } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useShifts, useCurrentShift, usePaymentMethodsActive } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, fmtMoney, STATUS_BADGE } from '@/lib/utils';
import { useAuth } from '@/stores/auth';

export default function Shifts() {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const { data: shifts } = useShifts();
  const { data: currentShift } = useCurrentShift();
  const { data: activeMethods } = usePaymentMethodsActive();
  const pag = usePagination(shifts, 10);
  const [closeOpen, setCloseOpen] = useState(false);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState('');

  const methodTotals = currentShift?.methodTotals ?? [];
  const expectedByCode: Record<string, number> = {};
  for (const m of methodTotals) expectedByCode[m.code] = m.expected;

  const methods = (activeMethods && activeMethods.length > 0 ? activeMethods : methodTotals) as {
    code: string;
    nameAr?: string;
    name?: string;
    color?: string;
  }[];

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['shifts'] });
    qc.invalidateQueries({ queryKey: ['shift-current'] });
  };

  const openShift = useMutation({
    mutationFn: () => api('/api/shifts/open', { method: 'POST', body: { locationId: employee?.locationId ?? 1 } }),
    onSuccess: () => {
      toast.success('تم فتح الشيفت');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const closeShift = useMutation({
    mutationFn: () => {
      const countedBody: Record<string, number> = {};
      for (const m of methods) {
        const v = counted[m.code];
        if (v != null && v !== '') countedBody[m.code] = Number(v);
      }
      return api(`/api/shifts/${currentShift!.id}/close`, {
        method: 'POST',
        body: { counted: countedBody, notes },
      });
    },
    onSuccess: (res: any) => {
      toast.success(`تم إقفال الشيفت — صافي الفرق: ${fmtMoney(res.totalDifference)}`);
      setCloseOpen(false);
      setCounted({});
      setNotes('');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const openCloseDialog = () => {
    const init: Record<string, string> = {};
    for (const m of methodTotals) init[m.code] = String(m.expected);
    setCounted(init);
    setNotes('');
    setCloseOpen(true);
  };

  const countedTotal = methods.reduce((s, m) => s + (Number(counted[m.code]) || 0), 0);
  const expectedTotal = methods.reduce((s, m) => s + (expectedByCode[m.code] ?? 0), 0);
  const netDiff = Math.round((countedTotal - expectedTotal) * 100) / 100;

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الشيفتات وتسوية الخزينة"
        description="إقفال الشيفت إجباري — يُقارن المتحصلات الفعلية بكل طرق الدفع مع المسجَّل في النظام"
        actions={
          currentShift?.status === 'open' ? (
            <Button variant="destructive" onClick={openCloseDialog}>
              <Square className="h-4 w-4" /> إقفال الشيفت الحالي
            </Button>
          ) : (
            <Button variant="brand" onClick={() => openShift.mutate()} loading={openShift.isPending}>
              <Play className="h-4 w-4" /> فتح شيفت جديد
            </Button>
          )
        }
      />

      {currentShift?.status === 'open' && (
        <Card className="mb-6 border-emerald-200 bg-emerald-50">
          <CardContent className="flex items-center justify-between p-4">
            <div>
              <Badge tone="bg-emerald-100 text-emerald-800">شيفت مفتوح</Badge>
              <div className="mt-1 text-sm text-slate-600">
                فُتح في {fmtDateTime(currentShift.openedAt)} — {currentShift.locationName}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>الفتح</TableHead>
                <TableHead>الإغلاق</TableHead>
                <TableHead>المتوقع</TableHead>
                <TableHead>الفعلي</TableHead>
                <TableHead>الفرق</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="text-sm">{s.employeeName}</TableCell>
                  <TableCell className="text-xs">{s.locationName}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(s.openedAt)}</TableCell>
                  <TableCell className="text-xs">{s.closedAt ? fmtDateTime(s.closedAt) : '—'}</TableCell>
                  <TableCell className="text-xs">{s.expectedTotal != null ? fmtMoney(s.expectedTotal) : '—'}</TableCell>
                  <TableCell className="text-xs">{s.countedTotal != null ? fmtMoney(s.countedTotal) : '—'}</TableCell>
                  <TableCell className={Number(s.differenceTotal) < 0 ? 'text-rose-600' : 'text-emerald-700'}>
                    {s.differenceTotal != null ? fmtMoney(s.differenceTotal) : '—'}
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[s.status]}>{s.status === 'open' ? 'مفتوح' : 'مقفول'}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(shifts ?? []).length === 0 && (
                <TableRow><TableCell colSpan={8} className="py-8 text-center text-slate-400">لا توجد شيفتات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog
        open={closeOpen}
        onClose={() => setCloseOpen(false)}
        title="إقفال الشيفت — تسوية طرق الدفع"
        description="عدّ المتحصلات الفعلية لكل طريقة دفع وقارنها بالمسجَّل في النظام"
        className="max-w-2xl"
      >
        <div className="space-y-4">
          <div className="space-y-3">
            {methods.map((m) => {
              const expected = expectedByCode[m.code] ?? 0;
              const actual = Number(counted[m.code]) || 0;
              const diff = Math.round((actual - expected) * 100) / 100;
              return (
                <div key={m.code} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                  <span
                    className="flex h-3.5 w-3.5 shrink-0 rounded-full"
                    style={{ backgroundColor: m.color ?? '#64748b' }}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold text-slate-800">{m.nameAr ?? m.name ?? m.code}</div>
                    <div className="text-xs text-slate-500">المتوقع: {fmtMoney(expected)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="relative">
                      <Input
                        type="number"
                        dir="ltr"
                        className="w-36 text-end"
                        value={counted[m.code] ?? ''}
                        onChange={(e) => setCounted({ ...counted, [m.code]: e.target.value })}
                      />
                    </div>
                    <span className={`w-20 text-end text-sm font-bold ${diff < 0 ? 'text-rose-600' : diff > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                      {fmtMoney(diff)}
                    </span>
                  </div>
                </div>
              );
            })}
            {methods.length === 0 && (
              <div className="rounded-lg bg-slate-50 p-4 text-center text-sm text-slate-500">
                لا توجد طرق دفع مفعلة
              </div>
            )}
          </div>

          <div className="flex items-center justify-between rounded-lg bg-slate-50 px-4 py-3">
            <div className="text-sm text-slate-600">
              الصافي: <span className="font-bold text-slate-900">{fmtMoney(countedTotal)}</span> فعلي مقابل{' '}
              <span className="font-bold text-slate-900">{fmtMoney(expectedTotal)}</span> متوقع
            </div>
            <div className={`text-sm font-extrabold ${netDiff < 0 ? 'text-rose-600' : netDiff > 0 ? 'text-emerald-700' : 'text-slate-600'}`}>
              الفرق: {fmtMoney(netDiff)}
            </div>
          </div>

          <div>
            <Label>ملاحظات (اختياري)</Label>
            <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setCloseOpen(false)}>إلغاء</Button>
          <Button
            variant="destructive"
            onClick={async () => {
              if (await confirmDialog('تأكيد إقفال الشيفت؟ لا يمكن التراجع بعد الإقفال.')) closeShift.mutate();
            }}
          >
            إقفال وتسجيل الفروقات
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
