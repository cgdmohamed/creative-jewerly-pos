import { useState } from 'react';
import { Plus, Coins } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useActivePrices, usePriceHistory } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, fmtMoney, metalColor, metalLabel } from '@/lib/utils';
import { can } from '@/stores/auth';

export default function Pricing() {
  const { data: prices } = useActivePrices();
  const { data: history } = usePriceHistory();
  const qc = useQueryClient();
  const pag = usePagination(history, 10);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ metalType: 'gold', carat: '21', pricePerGram: '' });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prices'] });
    qc.invalidateQueries({ queryKey: ['report-inventory-value'] });
  };

  const setPrice = useMutation({
    mutationFn: (body: any) => api('/api/prices', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم تحديد سعر اليوم');
      setOpen(false);
      setForm({ metalType: 'gold', carat: '21', pricePerGram: '' });
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="التسعير اليومي"
        description="يُسجَّل سعر جديد كل يوم دون تعديل الأسعار القديمة — الفواتير تحتفظ بنسخة وقت البيع"
        actions={
          can('pricing.set') ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> تحديد سعر اليوم
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(prices ?? []).map((p) => (
          <Card key={p.id}>
            <CardContent className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                  <Coins className="h-5 w-5 text-brand-600" />
                </div>
                <div>
                  <div className="font-bold text-slate-900">
                    {metalLabel(p.metalType)} {p.carat && `— عيار ${p.carat}`}
                  </div>
                  <div className="text-xs text-slate-500">سعر فعال لليوم</div>
                </div>
              </div>
              <div className="text-left">
                <Badge tone={metalColor(p.metalType)}>{fmtMoney(p.pricePerGram)} / جم</Badge>
              </div>
            </CardContent>
          </Card>
        ))}
        {(prices ?? []).length === 0 && (
          <Card className="sm:col-span-2 lg:col-span-3">
            <CardContent className="p-5 text-sm text-amber-700">
              لم يُحدَّد أي سعر لليوم. لن يتمكن الكاشير من البيع حتى يتم تحديد الأسعار.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">سجل الأسعار</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>المعدن</TableHead>
                <TableHead>العيار</TableHead>
                <TableHead>سعر الجرام</TableHead>
                <TableHead>تاريخ السريان</TableHead>
                <TableHead>أُدخل بواسطة</TableHead>
                <TableHead>الحالة</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((h) => (
                <TableRow key={h.id}>
                  <TableCell><Badge tone={metalColor(h.metalType)}>{metalLabel(h.metalType)}</Badge></TableCell>
                  <TableCell>{h.carat || '—'}</TableCell>
                  <TableCell className="font-bold">{fmtMoney(h.pricePerGram)} ج.م</TableCell>
                  <TableCell>{fmtDateTime(h.effectiveDate)}</TableCell>
                  <TableCell className="text-xs">{h.enteredByName}</TableCell>
                  <TableCell>
                    <Badge tone={h.endDate ? 'bg-slate-200 text-slate-600' : 'bg-emerald-100 text-emerald-800'}>
                      {h.endDate ? `مغلق ${fmtDateTime(h.endDate)}` : 'فعال'}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
              {(history ?? []).length === 0 && (
                <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">لا يوجد سجل</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="تحديد سعر اليوم"
        description="سيُغلق السعر السابق إن وُجد ويُفتح سطر جديد"
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>المعدن</Label>
            <Select value={form.metalType} onChange={(e) => setForm({ ...form, metalType: e.target.value })}>
              <option value="gold">ذهب</option>
              <option value="silver">فضة</option>
            </Select>
          </div>
          <div>
            <Label>العيار</Label>
            <Input value={form.carat} onChange={(e) => setForm({ ...form, carat: e.target.value })} dir="ltr" placeholder="21 / 24 / 925" />
          </div>
          <div>
            <Label>سعر الجرام</Label>
            <Input type="number" value={form.pricePerGram} onChange={(e) => setForm({ ...form, pricePerGram: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            loading={setPrice.isPending}
            disabled={!form.pricePerGram}
            onClick={() => setPrice.mutate(form)}
          >
            حفظ السعر
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
