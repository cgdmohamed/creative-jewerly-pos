import { useState } from 'react';
import { Plus, ReceiptText, X } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { ItemSearchSelect } from '@/components/ItemSearchSelect';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useReservations, useItems, useCustomers, useActivePrices, useSettings } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, fmtMoney, STATUS_BADGE } from '@/lib/utils';
import { can } from '@/stores/auth';

export default function Reservations() {
  const navigate = useNavigate();
  const [statusFilter, setStatusFilter] = useState('active');
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ itemId: '', customerId: '', customerName: '', customerPhone: '', downPayment: '', totalValue: '', quantity: '1' });
  const qc = useQueryClient();
  const { data: reservations } = useReservations(statusFilter);
  const { data: availableItems } = useItems({ status: 'available' });
  const { data: customers } = useCustomers();
  const { data: prices } = useActivePrices();
  const { data: settings } = useSettings();

  const pag = usePagination(reservations, 10, statusFilter);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['reservations'] });
    qc.invalidateQueries({ queryKey: ['items'] });
  };

  const createRes = useMutation({
    mutationFn: (body: any) => api('/api/reservations', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم الحجز — القطعة محجوزة');
      setOpen(false);
      setForm({ itemId: '', customerId: '', customerName: '', customerPhone: '', downPayment: '', totalValue: '', quantity: '1' });
      invalidate();
    },
    onError: (e: any) => {
      if (!navigator.onLine) {
        toast.warning('إنشاء الحجز يحتاج اتصالاً بالخادم لتثبيت سعر القطعة في نفس اللحظة');
      } else {
        toast.error('خطأ: ' + e.message);
      }
    },
  });

  const cancelRes = useMutation({
    mutationFn: (id: number) => api(`/api/reservations/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('تم إلغاء الحجز');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const selectedItem = (availableItems ?? []).find((it) => String(it.id) === form.itemId);
  const selectedAvailable = selectedItem?.availableQty ?? 1;
  const selectedQuantity = Math.max(1, Number(form.quantity) || 1);
  const reservationTotal = (() => {
    if (!selectedItem) return null;
    let unitSubtotal = 0;
    if (selectedItem.productKind === 'general') {
      unitSubtotal = Number(selectedItem.salePrice);
    } else {
      const price = (prices ?? []).find((p) =>
        p.metalType === selectedItem.metalType && (p.carat || '') === (selectedItem.carat || ''));
      if (!price || !(Number(selectedItem.weightG) > 0)) return null;
      const metal = Number(selectedItem.weightG) * Number(price.pricePerGram);
      const craft = selectedItem.craftsmanshipType === 'percent'
        ? metal * Number(selectedItem.craftsmanshipValue) / 100
        : selectedItem.craftsmanshipType === 'per_gram'
          ? Number(selectedItem.weightG) * Number(selectedItem.craftsmanshipValue)
          : Number(selectedItem.craftsmanshipValue);
      unitSubtotal = metal + craft;
    }
    if (!(unitSubtotal > 0)) return null;
    const vat = Number(settings?.vat_percent ?? 0);
    return Math.round(unitSubtotal * selectedQuantity * (1 + vat / 100) * 100) / 100;
  })();

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الحجوزات والعربون"
        description="حجز قطعة بعربون مع تتبع المتبقي المستحق"
        actions={
          can('reservation.manage') ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> حجز جديد
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-5">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="w-44">
            <Label>الحالة</Label>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="active">نشطة</option>
              <option value="completed">مكتملة</option>
              <option value="cancelled">ملغاة</option>
              <option value="">الكل</option>
            </Select>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القطعة</TableHead>
                <TableHead>كمية</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>العربون</TableHead>
                <TableHead>القيمة الكاملة</TableHead>
                <TableHead>المتبقي</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="font-mono text-xs font-bold">{r.itemCode}</div>
                    {r.itemName && <div className="text-xs text-slate-400">{r.itemName}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{r.quantity ?? 1}</TableCell>
                  <TableCell>
                    <div className="text-sm">{r.customerName}</div>
                    {r.customerPhone && <div className="text-xs text-slate-400" dir="ltr">{r.customerPhone}</div>}
                  </TableCell>
                  <TableCell className="font-bold text-emerald-700">{fmtMoney(r.downPayment)}</TableCell>
                  <TableCell>{fmtMoney(r.totalValue)}</TableCell>
                  <TableCell>{fmtMoney(r.remainingDue)}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(r.reservedAt)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[r.status]}>
                      {r.status === 'active' ? 'نشط' : r.status === 'completed' ? 'مكتمل' : 'ملغي'}
                    </Badge>
                    {r.invoiceNo && <div className="mt-1 font-mono text-[10px] text-slate-400">{r.invoiceNo}</div>}
                  </TableCell>
                  <TableCell className="text-end">
                    {r.status === 'active' && can('reservation.manage') && (
                      <div className="flex justify-end gap-1">
                        {can('invoice.create') && (
                          <Button
                            variant="brand"
                            size="sm"
                            onClick={() => navigate(`/pos?reservation=${r.id}`)}
                          >
                            <ReceiptText className="h-3.5 w-3.5" /> إتمام البيع
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-rose-600"
                          onClick={async () => {
                            if (await confirmDialog('إلغاء الحجز؟ ستعود القطعة للمخزون متاحة.')) cancelRes.mutate(r.id);
                          }}
                        >
                          <X className="h-3.5 w-3.5" /> إلغاء
                        </Button>
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {(reservations ?? []).length === 0 && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">لا توجد حجوزات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="حجز جديد بعربون">
        <div className="space-y-4">
          <div>
            <Label>القطعة</Label>
            <ItemSearchSelect
              items={availableItems ?? []}
              value={form.itemId}
              onChange={(itemId) => setForm({ ...form, itemId })}
            />
          </div>
          <div>
            <Label>العميل (اختياري)</Label>
            <Select
              value={form.customerId}
              onChange={(e) => {
                const c = (customers ?? []).find((x) => String(x.id) === e.target.value);
                setForm({
                  ...form,
                  customerId: e.target.value,
                  customerName: c?.name ?? form.customerName,
                  customerPhone: c?.phone ?? form.customerPhone,
                });
              }}
            >
              <option value="">— عميل جديد بدون تسجيل —</option>
              {(customers ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}{c.phone ? ` — ${c.phone}` : ''}
                </option>
              ))}
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>الكمية</Label>
              <Input
                type="number"
                min={1}
                max={selectedAvailable}
                value={form.quantity}
                onChange={(e) =>
                  setForm({ ...form, quantity: String(Math.max(1, Math.min(Number(e.target.value) || 1, selectedAvailable))) })
                }
              />
            </div>
            <div>
              <Label>اسم العميل *</Label>
              <Input value={form.customerName} onChange={(e) => setForm({ ...form, customerName: e.target.value })} />
            </div>
            <div>
              <Label>رقم الموبايل</Label>
              <Input value={form.customerPhone} onChange={(e) => setForm({ ...form, customerPhone: e.target.value })} dir="ltr" />
            </div>
            <div>
              <Label>العربون *</Label>
              <Input type="number" value={form.downPayment} onChange={(e) => setForm({ ...form, downPayment: e.target.value })} />
            </div>
            <div>
              <Label>القيمة الكاملة وقت الحجز</Label>
              <Input type="number" value={reservationTotal ?? ''} readOnly className="bg-slate-50 font-bold" />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!form.itemId || !form.customerName || reservationTotal == null
              || !Number.isFinite(Number(form.downPayment)) || Number(form.downPayment) < 0
              || Number(form.downPayment) > reservationTotal}
            onClick={() =>
              createRes.mutate({
                itemId: Number(form.itemId),
                quantity: Number(form.quantity) || 1,
                customerId: form.customerId ? Number(form.customerId) : null,
                customerName: form.customerName,
                customerPhone: form.customerPhone || null,
                downPayment: Number(form.downPayment),
                totalValue: reservationTotal,
              })
            }
          >
            حفظ الحجز
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
