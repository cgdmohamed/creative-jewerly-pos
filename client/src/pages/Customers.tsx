import { useState } from 'react';
import { Plus, Send, User, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useCustomers, useCustomer, useCustomerInvoices, useCustomerReservations } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, fmtMoney, STATUS_BADGE } from '@/lib/utils';
import { can } from '@/stores/auth';
import { copyInvoiceText, shareInvoiceWhatsApp } from '@/lib/invoiceShare';

const EMPTY = { name: '', phone: '', email: '', address: '', notes: '' };

export default function Customers() {
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState(EMPTY);
  const [detailId, setDetailId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { data: customers } = useCustomers(search);

  const pag = usePagination(customers, 10, search);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['customers'] });

  const save = useMutation({
    mutationFn: (body: any) =>
      editing ? api(`/api/customers/${editing.id}`, { method: 'PUT', body }) : api('/api/customers', { method: 'POST', body }),
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث بيانات العميل' : 'تم تسجيل العميل');
      setOpen(false);
      setEditing(null);
      setForm(EMPTY);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY);
    setOpen(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({ name: c.name, phone: c.phone ?? '', email: c.email ?? '', address: c.address ?? '', notes: c.notes ?? '' });
    setOpen(true);
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="العملاء"
        description="بيانات العملاء وسجل مشترياتهم وحجوزاتهم"
        actions={
          can('customers.manage') ? (
            <Button variant="brand" onClick={openCreate}>
              <Plus className="h-4 w-4" /> عميل جديد
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-5">
        <CardContent className="p-4">
          <Label>بحث</Label>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="اسم العميل أو رقم الموبايل أو البريد…"
            dir="auto"
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>العميل</TableHead>
                <TableHead>التواصل</TableHead>
                <TableHead>مشتريات</TableHead>
                <TableHead>إجمالي المشتريات</TableHead>
                <TableHead>آخر شراء</TableHead>
                <TableHead>حجوزات نشطة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                        <User className="h-4 w-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-slate-900">{c.name}</div>
                        {c.email && <div className="text-xs text-slate-400" dir="ltr">{c.email}</div>}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-xs" dir="ltr">{c.phone || '—'}</TableCell>
                  <TableCell className="text-xs">{c.totalInvoices ?? 0} فاتورة</TableCell>
                  <TableCell className="font-bold text-brand-700">{fmtMoney(c.totalSpent ?? 0)}</TableCell>
                  <TableCell className="text-xs">{c.lastPurchaseAt ? fmtDateTime(c.lastPurchaseAt) : '—'}</TableCell>
                  <TableCell>
                    {(c.activeReservations ?? 0) > 0 ? (
                      <Badge tone="bg-amber-100 text-amber-800">{c.activeReservations} نشطة</Badge>
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(c.id)}>
                        <User className="h-3.5 w-3.5" /> ملف
                      </Button>
                      {can('customers.manage') && (
                        <Button variant="ghost" size="sm" onClick={() => openEdit(c)}>
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(customers ?? []).length === 0 && (
                <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">لا يوجد عملاء</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل بيانات العميل' : 'عميل جديد'}>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>الاسم *</Label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <Label>رقم الموبايل</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>البريد الإلكتروني</Label>
            <Input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>العنوان</Label>
            <Input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
          </div>
        </div>
        <div className="mt-3">
          <Label>ملاحظات</Label>
          <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!form.name.trim() && !form.phone.trim()}
            onClick={() => save.mutate({ name: form.name, phone: form.phone || null, email: form.email || null, address: form.address || null, notes: form.notes || null })}
          >
            حفظ
          </Button>
        </div>
      </Dialog>

      {detailId != null && <CustomerDetail id={detailId} onClose={() => setDetailId(null)} />}
    </div>
  );
}

function CustomerDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: customer } = useCustomer(id);
  const { data: invoices } = useCustomerInvoices(id);
  const { data: reservations } = useCustomerReservations(id);
  const qc = useQueryClient();

  const sendInvoice = (inv: any) => {
    if (!shareInvoiceWhatsApp(inv, customer?.phone)) {
      const ok = copyInvoiceText(inv);
      toast[ok ? 'info' : 'error'](ok ? 'نسخنا نص الفاتورة — ألصقه للعميل' : 'لا يوجد رقم موبايل للعميل');
    }
    qc.invalidateQueries({ queryKey: ['customers'] });
  };

  return (
    <Dialog open onClose={onClose} title={customer?.name ?? 'ملف العميل'} className="max-w-2xl">
      {customer && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div><span className="text-slate-500">الموبايل: </span><span dir="ltr">{customer.phone || '—'}</span></div>
            <div><span className="text-slate-500">البريد: </span><span dir="ltr">{customer.email || '—'}</span></div>
            <div><span className="text-slate-500">العنوان: </span>{customer.address || '—'}</div>
            <div><span className="text-slate-500">إجمالي المشتريات: </span><b>{fmtMoney(customer.totalSpent ?? 0)}</b></div>
            <div><span className="text-slate-500">عدد الفواتير: </span>{customer.totalInvoices ?? 0}</div>
            <div><span className="text-slate-500">حجوزات نشطة: </span>{customer.activeReservations ?? 0}</div>
          </div>
          {customer.notes && (
            <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-600">{customer.notes}</div>
          )}

          <div>
            <div className="mb-2 text-sm font-bold text-slate-700">فواتير العميل ({invoices?.length ?? 0})</div>
            <div className="max-h-56 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>الفاتورة</TableHead>
                    <TableHead>التاريخ</TableHead>
                    <TableHead>الإجمالي</TableHead>
                    <TableHead>الحالة</TableHead>
                    <TableHead className="text-end">إرسال</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(invoices ?? []).map((inv) => (
                    <TableRow key={inv.id}>
                      <TableCell className="font-mono text-xs font-bold">{inv.invoiceNo}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(inv.createdAt)}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(inv.total)}</TableCell>
                      <TableCell>
                        <Badge tone={STATUS_BADGE[inv.status]}>{inv.status === 'active' ? 'نشطة' : 'مُرجعة'}</Badge>
                      </TableCell>
                      <TableCell className="text-end">
                        <Button variant="ghost" size="sm" onClick={() => sendInvoice(inv)} title="إرسال الفاتورة">
                          <Send className="h-3.5 w-3.5" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(invoices ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-6 text-center text-slate-400">لا توجد فواتير لهذا العميل</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </div>

          {(reservations ?? []).length > 0 && (
            <div>
              <div className="mb-2 text-sm font-bold text-slate-700">الحجوزات ({reservations!.length})</div>
              <div className="space-y-1.5">
                {(reservations ?? []).map((r) => (
                  <div key={r.id} className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2 text-sm">
                    <span className="font-mono text-xs font-bold">{r.itemCode}</span>
                    <span className="text-xs text-slate-500">{fmtDateTime(r.reservedAt)}</span>
                    <Badge tone={STATUS_BADGE[r.status]}>
                      {r.status === 'active' ? 'نشط' : r.status === 'completed' ? 'مكتمل' : 'ملغي'}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}
