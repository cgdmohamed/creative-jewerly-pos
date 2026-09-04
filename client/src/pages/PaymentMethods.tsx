import { useState } from 'react';
import { Plus, Wallet, Pencil, Power, CircleOff } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePaymentMethods } from '@/hooks/useData';
import { fmtMoney } from '@/lib/utils';

const COLORS = ['#10b981', '#0ea5e9', '#8b5cf6', '#f59e0b', '#f43f5e', '#64748b', '#06b6d4', '#84cc16'];

const blank = { nameAr: '', nameEn: '', code: '', color: COLORS[0] };

export default function PaymentMethods() {
  const { data: methods } = usePaymentMethods();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(blank);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['payment-methods'] });
    qc.invalidateQueries({ queryKey: ['payment-methods-active'] });
    qc.invalidateQueries({ queryKey: ['dashboard-data'] });
    qc.invalidateQueries({ queryKey: ['report-payments'] });
  };

  const save = useMutation({
    mutationFn: (body: any) =>
      editing
        ? api(`/api/payment-methods/${editing.id}`, { method: 'PATCH', body })
        : api('/api/payment-methods', { method: 'POST', body }),
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث طريقة الدفع' : 'تمت إضافة طريقة الدفع');
      setOpen(false);
      setEditing(null);
      setForm(blank);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const toggle = useMutation({
    mutationFn: (m: any) =>
      api(`/api/payment-methods/${m.id}`, { method: 'PATCH', body: { isActive: !m.isActive } }),
    onSuccess: () => {
      toast.success('تم تحديث الحالة');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="طرق الدفع"
        description="أضف طرق دفع مخصصة (محفظة إلكترونية، إيصال آجل…) — تظهر في نقطة البيع والتقارير"
        actions={
          <Button variant="brand" onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}>
            <Plus className="h-4 w-4" /> إضافة طريقة
          </Button>
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الطريقة</TableHead>
                <TableHead>اللون</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>فواتير (30 يومًا)</TableHead>
                <TableHead>الإجمالي (30 يومًا)</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(methods ?? []).map((m) => (
                <TableRow key={m.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-lg" style={{ background: m.color + '20', color: m.color }}>
                        <Wallet className="h-4 w-4" />
                      </span>
                      <div>
                        <div className="font-bold text-slate-900">{m.nameAr}</div>
                        {m.nameEn && <div className="text-xs text-slate-400" dir="ltr">{m.nameEn}</div>}
                        <div className="font-mono text-[10px] text-slate-400" dir="ltr">{m.code}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span className="h-4 w-4 rounded-full border border-slate-200" style={{ background: m.color }} />
                      <span className="font-mono text-xs text-slate-500" dir="ltr">{m.color}</span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {m.isActive ? (
                      <Badge tone="bg-emerald-100 text-emerald-800">مفعّلة</Badge>
                    ) : (
                      <Badge tone="bg-slate-200 text-slate-600">موقوفة</Badge>
                    )}
                  </TableCell>
                  <TableCell>{m.invoices30d}</TableCell>
                  <TableCell className="font-bold">{fmtMoney(m.total30d)}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditing(m);
                          setForm({ nameAr: m.nameAr, nameEn: m.nameEn ?? '', code: m.code, color: m.color });
                          setOpen(true);
                        }}
                      >
                        <Pencil className="h-3.5 w-3.5" /> تعديل
                      </Button>
                      <Button variant="ghost" size="sm" className={m.isActive ? 'text-slate-400 hover:text-amber-700' : 'text-emerald-600'} onClick={() => toggle.mutate(m)}>
                        {m.isActive ? <CircleOff className="h-3.5 w-3.5" /> : <Power className="h-3.5 w-3.5" />}
                        {m.isActive ? 'إيقاف' : 'تفعيل'}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(methods ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">لا توجد طرق دفع بعد</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل طريقة دفع' : 'إضافة طريقة دفع'}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>الاسم بالعربية *</Label>
              <Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} placeholder="مثال: محفظة فودافون" />
            </div>
            <div>
              <Label>الاسم بالإنجليزية</Label>
              <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" placeholder="Vodafone Cash" />
            </div>
          </div>
          {!editing && (
            <div>
              <Label>الكود (اختياري)</Label>
              <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" placeholder="vodafone — يُولَّد تلقائيًا إن تُرك فارغًا" />
            </div>
          )}
          <div>
            <Label>اللون</Label>
            <div className="mt-2 flex flex-wrap gap-2">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`h-8 w-8 rounded-full border-2 transition-transform ${form.color === c ? 'scale-110 border-slate-900' : 'border-transparent'}`}
                  style={{ background: c }}
                />
              ))}
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button variant="brand" disabled={!form.nameAr} onClick={() => save.mutate(form)}>
            حفظ
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
