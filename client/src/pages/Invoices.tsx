import { useState } from 'react';
import { Undo2, FileText, Send } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useInvoices, useInvoice, usePaymentMethods } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useOfflineStore } from '@/stores/offline';
import { fmtDateTime, fmtMoney, methodColor, methodName, STATUS_BADGE } from '@/lib/utils';
import { can } from '@/stores/auth';
import { copyInvoiceText, shareInvoiceWhatsApp } from '@/lib/invoiceShare';

export default function Invoices() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [method, setMethod] = useState('');
  const [detailId, setDetailId] = useState<number | null>(null);
  const [returnReason, setReturnReason] = useState('');
  const [returningId, setReturningId] = useState<number | null>(null);
  const qc = useQueryClient();
  const { data: payMethods } = usePaymentMethods();

  const params: Record<string, string> = {};
  if (search) params.search = search;
  if (status) params.status = status;
  if (method) params.method = method;
  const { data: invoices, isLoading } = useInvoices(params);

  const pag = usePagination(invoices, 10, JSON.stringify(params));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['invoices'] });
    qc.invalidateQueries({ queryKey: ['items'] });
  };

  const returnMutation = useMutation({
    mutationFn: (body: any) => api(`/api/invoices/${returningId}/return`, { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم إرجاع الفاتورة — عادت القطع للمخزون');
      setReturningId(null);
      setReturnReason('');
      invalidate();
    },
    onError: (e: any) => {
      if (!navigator.onLine) {
        useOfflineStore.getState().pushPending('invoice.return', { invoiceId: returningId, reason: returnReason });
        toast.info('تم حفظ الإرجاع محليًا — سيُطبق عند عودة الاتصال');
        setReturningId(null);
        setReturnReason('');
      } else {
        toast.error('خطأ: ' + e.message);
      }
    },
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="الفواتير" description="سجل المبيعات والإرجاعات" />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-48 flex-1">
            <Label>رقم الفاتورة</Label>
            <Input value={search} onChange={(e) => setSearch(e.target.value)} dir="ltr" placeholder="INV-…" />
          </div>
          <div className="w-40">
            <Label>الحالة</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">الكل</option>
              <option value="active">نشطة</option>
              <option value="returned">مُرجعة</option>
            </Select>
          </div>
          <div className="w-48">
            <Label>طريقة الدفع</Label>
            <Select value={method} onChange={(e) => setMethod(e.target.value)}>
              <option value="">الكل</option>
              {(payMethods ?? []).map((m) => (
                <option key={m.code} value={m.code}>{m.nameAr}</option>
              ))}
            </Select>
          </div>
          <div className="flex gap-1">
          </div>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الفاتورة</TableHead>
                <TableHead>التاريخ</TableHead>
                <TableHead>الكاشير</TableHead>
                <TableHead>العميل</TableHead>
                <TableHead>الطريقة</TableHead>
                <TableHead>الإجمالي</TableHead>
                <TableHead>الخصم</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">جارٍ التحميل…</TableCell></TableRow>}
              {pag.slice.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono text-xs font-bold">{inv.invoiceNo}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(inv.createdAt)}</TableCell>
                  <TableCell className="text-xs">{inv.cashierName}</TableCell>
                  <TableCell className="text-xs">
                    {inv.customerName ? (
                      <div>
                        <div className="font-medium">{inv.customerName}</div>
                        {inv.customerPhone && <div className="text-slate-400" dir="ltr">{inv.customerPhone}</div>}
                      </div>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: inv.paymentMethodColor ?? methodColor(inv.paymentMethod, payMethods) }} />
                      {inv.paymentMethodName ?? methodName(inv.paymentMethod, payMethods)}
                    </span>
                  </TableCell>
                  <TableCell className="font-bold">{fmtMoney(inv.total)}</TableCell>
                  <TableCell className="text-xs text-rose-600">{inv.discountAmount > 0 ? fmtMoney(inv.discountAmount) : '—'}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[inv.status]}>{inv.status === 'active' ? 'نشطة' : 'مُرجعة'}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setDetailId(inv.id)}>
                        <FileText className="h-3.5 w-3.5" /> تفاصيل
                      </Button>
                      {inv.status === 'active' && can('invoice.return') && (
                        <Button variant="ghost" size="sm" className="text-rose-600" onClick={() => setReturningId(inv.id)}>
                          <Undo2 className="h-3.5 w-3.5" /> إرجاع
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(invoices ?? []).length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">لا توجد فواتير</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      {detailId != null && <InvoiceDetail id={detailId} onClose={() => setDetailId(null)} />}

      <Dialog
        open={returningId != null}
        onClose={() => setReturningId(null)}
        title="إرجاع الفاتورة"
        description="ستعود القطع للمخزون كمتاحة مع تسجيل السبب والموظف"
      >
        <div>
          <Label>سبب الإرجاع *</Label>
          <Input value={returnReason} onChange={(e) => setReturnReason(e.target.value)} placeholder="مثال: العميل تراجع عن الشراء" />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setReturningId(null)}>إلغاء</Button>
          <Button
            variant="destructive"
            disabled={!returnReason}
            onClick={async () => {
              if (await confirmDialog('تأكيد إرجاع الفاتورة بالكامل؟')) returnMutation.mutate({ reason: returnReason });
            }}
          >
            تأكيد الإرجاع
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function InvoiceDetail({ id, onClose }: { id: number; onClose: () => void }) {
  const { data: inv } = useInvoice(id);
  const { data: payMethods } = usePaymentMethods();

  const sendInvoice = () => {
    if (!inv) return;
    if (!shareInvoiceWhatsApp(inv, inv.customerPhone)) {
      const ok = copyInvoiceText(inv);
      toast[ok ? 'info' : 'error'](ok ? 'نسخنا نص الفاتورة — ألصقه للعميل' : 'لا يوجد رقم موبايل للعميل');
    }
  };

  return (
    <Dialog open onClose={onClose} title={`تفاصيل الفاتورة ${inv?.invoiceNo ?? ''}`} className="max-w-2xl">
      {inv && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><span className="text-slate-500">التاريخ: </span>{fmtDateTime(inv.createdAt)}</div>
            <div><span className="text-slate-500">الكاشير: </span>{inv.cashierName}</div>
            <div><span className="text-slate-500">الفرع: </span>{inv.locationName}</div>
            <div>
              <span className="text-slate-500">طريقة الدفع: </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: methodColor(inv.paymentMethod, payMethods) }} />
                {methodName(inv.paymentMethod, payMethods)}
              </span>
            </div>
            {inv.customerName && (
              <div className="col-span-2">
                <span className="text-slate-500">العميل: </span>
                {inv.customerName}
                {inv.customerPhone && <span className="ms-2" dir="ltr">{inv.customerPhone}</span>}
                <Button variant="outline" size="sm" className="ms-3" onClick={sendInvoice} title="إرسال الفاتورة للعميل">
                  <Send className="h-3.5 w-3.5" /> إرسال
                </Button>
              </div>
            )}
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>القطعة</TableHead>
                <TableHead>الوزن</TableHead>
                <TableHead>سعر المعدن</TableHead>
                <TableHead>المصنعية</TableHead>
                <TableHead>الإجمالي</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(inv.items ?? []).map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <div className="font-mono text-xs font-bold">{it.itemCodeSnapshot}</div>
                    {it.itemNameSnapshot && <div className="text-xs text-slate-400">{it.itemNameSnapshot}</div>}
                  </TableCell>
                  <TableCell className="text-xs">{it.weightGSnapshot} جم</TableCell>
                  <TableCell className="text-xs">{fmtMoney(it.metalPriceSnapshot)}</TableCell>
                  <TableCell className="text-xs">{fmtMoney(it.craftsmanshipSnapshot)}</TableCell>
                  <TableCell>{fmtMoney(it.lineTotal)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-slate-500">قيمة المعدن</span><span>{fmtMoney(inv.metalSubtotal)}</span></div>
            <div className="flex justify-between"><span className="text-slate-500">المصنعية</span><span>{fmtMoney(inv.craftsmanshipTotal)}</span></div>
            {Number(inv.discountAmount) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>الخصم {inv.discountReason ? `(${inv.discountReason})` : ''}</span>
                <span>-{fmtMoney(inv.discountAmount)}</span>
              </div>
            )}
            {Number(inv.vatAmount) > 0 && (
              <div className="flex justify-between">
                <span>ضريبة القيمة المضافة ({Number(inv.vatPercent)}%)</span>
                <span>{fmtMoney(inv.vatAmount)}</span>
              </div>
            )}
            <div className="flex justify-between border-t border-slate-200 pt-2 font-bold">
              <span>الإجمالي</span><span>{fmtMoney(inv.total)} ج.م</span>
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
}
