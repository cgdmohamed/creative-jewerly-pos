import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Banknote, BookOpen, Boxes, Camera, Check, ClipboardList, PackageCheck,
  Plus, RotateCcw, Save, ScanBarcode, Trash2, Undo2, Users,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/components/ui/toast';
import { CameraScannerDialog } from '@/components/scanner/CameraScannerDialog';
import { useCategories, useCustomers, useItems, usePaymentMethodsActive } from '@/hooks/useData';
import { api } from '@/lib/api';
import { labelCodeForItem } from '@/lib/labels';
import type { Item } from '@/lib/types';
import { fmtDateTime, fmtMoney, fmtNum, metalLabel } from '@/lib/utils';

interface Trader {
  id: number; customerId: number; name: string; phone?: string; businessName?: string;
  defaultDiscountPct: number; cashBalance: number; metalBalanceG: number; openOrders: number;
  metalBalances?: { metalType:string; carat:string; weightG:number }[];
}

interface WholesaleOrder {
  id: number; orderNo: string; traderId: number; traderName: string; traderPhone?: string;
  metalType: 'gold' | 'silver'; carat: string; categoryId?: number; categoryName?: string;
  targetWeightG: number; toleranceG: number; makingPerG: number; discountPercent: number;
  allocatedWeightG: number; deliveredWeightG: number; returnedWeightG: number; pieceCount: number;
  status: string; channel: string; dueDate?: string; notes?: string; createdAt: string;
}

interface OrderItem {
  id: number; itemId: number; quantity: number; deliveredQty: number; returnedQty: number;
  itemCodeSnapshot: string; itemNameSnapshot?: string; weightGSnapshot: number; barcode?: string;
}

interface OrderDetails extends WholesaleOrder { items: OrderItem[]; ledger: LedgerEntry[] }
interface LedgerEntry {
  id: number; entryType: string; metalDeltaG: number; cashDelta: number; paymentMethod?: string;
  reference?: string; orderNo?: string; notes?: string; createdAt: string; runningCashBalance?: number;
  runningMetalBalanceG?: number; metalType?: string; carat?: string;
}

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: 'جديد', tone: 'bg-slate-100 text-slate-700' },
  preparing: { label: 'قيد التجهيز', tone: 'bg-sky-100 text-sky-800' },
  ready: { label: 'جاهز', tone: 'bg-emerald-100 text-emerald-800' },
  partial: { label: 'تسليم جزئي', tone: 'bg-amber-100 text-amber-800' },
  completed: { label: 'مكتمل', tone: 'bg-emerald-100 text-emerald-800' },
  cancelled: { label: 'ملغي', tone: 'bg-rose-100 text-rose-800' },
};

const ENTRY_LABELS: Record<string, string> = {
  deposit: 'عربون', payment: 'دفعة', metal_out: 'تسليم وزن', metal_return: 'مرتجع وزن',
  making_charge: 'مصنعية', making_refund: 'رد مصنعية', adjustment: 'تسوية',
};

const emptyOrder = {
  traderId: '', metalType: 'silver', carat: '925', categoryId: '', targetWeightG: '', toleranceG: '10',
  makingPerG: '', discountPercent: '', deposit: '', paymentMethod: 'cash', channel: 'store', dueDate: '', notes: '',
};

export default function Wholesale() {
  const qc = useQueryClient();
  const [traderOpen, setTraderOpen] = useState(false);
  const [orderOpen, setOrderOpen] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [statementId, setStatementId] = useState<number | null>(null);
  const [paymentTrader, setPaymentTrader] = useState<Trader | null>(null);
  const [returnOrder, setReturnOrder] = useState<OrderDetails | null>(null);
  const [traderForm, setTraderForm] = useState({ customerId: '', businessName: '', taxNumber: '', creditLimit: '', paymentTermsDays: '0', defaultDiscountPct: '0' });
  const [orderForm, setOrderForm] = useState(emptyOrder);
  const [paymentForm, setPaymentForm] = useState({ amount: '', method: 'cash', notes: '' });
  const [returnQty, setReturnQty] = useState<Record<number, number>>({});
  const [refundPct, setRefundPct] = useState('0');
  const { data: customers } = useCustomers();
  const { data: categories } = useCategories();
  const { data: methods } = usePaymentMethodsActive();
  const { data: traders = [] } = useQuery({ queryKey: ['wholesale-traders'], queryFn: () => api<Trader[]>('/api/wholesale/traders') });
  const { data: orders = [] } = useQuery({ queryKey: ['wholesale-orders'], queryFn: () => api<WholesaleOrder[]>('/api/wholesale/orders') });
  const { data: dashboard } = useQuery({ queryKey: ['wholesale-dashboard'], queryFn: () => api<any>('/api/wholesale/dashboard') });
  const { data: details } = useQuery({
    queryKey: ['wholesale-order', selectedOrderId],
    queryFn: () => api<OrderDetails>(`/api/wholesale/orders/${selectedOrderId}`), enabled: !!selectedOrderId,
  });
  const { data: statement } = useQuery({
    queryKey: ['wholesale-statement', statementId],
    queryFn: () => api<{ trader: Trader; entries: LedgerEntry[] }>(`/api/wholesale/traders/${statementId}/statement`), enabled: !!statementId,
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['wholesale-orders'] });
    qc.invalidateQueries({ queryKey: ['wholesale-traders'] });
    qc.invalidateQueries({ queryKey: ['wholesale-dashboard'] });
    qc.invalidateQueries({ queryKey: ['wholesale-order'] });
    qc.invalidateQueries({ queryKey: ['wholesale-statement'] });
    qc.invalidateQueries({ queryKey: ['items'] });
  };

  const createTrader = useMutation({
    mutationFn: () => api('/api/wholesale/traders', { method: 'POST', body: {
      ...traderForm, customerId: Number(traderForm.customerId), creditLimit: Number(traderForm.creditLimit || 0),
      paymentTermsDays: Number(traderForm.paymentTermsDays || 0), defaultDiscountPct: Number(traderForm.defaultDiscountPct || 0),
    } }),
    onSuccess: () => { toast.success('تم إضافة تاجر الجملة'); setTraderOpen(false); invalidate(); },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  const createOrder = useMutation({
    mutationFn: () => api<WholesaleOrder>('/api/wholesale/orders', { method: 'POST', body: {
      ...orderForm, traderId: Number(orderForm.traderId), categoryId: orderForm.categoryId ? Number(orderForm.categoryId) : null,
      targetWeightG: Number(orderForm.targetWeightG), toleranceG: Number(orderForm.toleranceG || 0),
      makingPerG: Number(orderForm.makingPerG || 0), discountPercent: Number(orderForm.discountPercent || 0),
      deposit: Number(orderForm.deposit || 0), dueDate: orderForm.dueDate || null,
    } }),
    onSuccess: (order) => {
      toast.success(`تم إنشاء ${order.orderNo}`); setOrderOpen(false); setOrderForm(emptyOrder);
      setSelectedOrderId(order.id); invalidate();
    },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  const payment = useMutation({
    mutationFn: () => api(`/api/wholesale/traders/${paymentTrader!.id}/payments`, { method: 'POST', body: {
      amount: Number(paymentForm.amount), paymentMethod: paymentForm.method, notes: paymentForm.notes || null,
    } }),
    onSuccess: () => { toast.success('تم تسجيل الدفعة'); setPaymentTrader(null); setPaymentForm({ amount: '', method: 'cash', notes: '' }); invalidate(); },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  const deliver = useMutation({
    mutationFn: (order: OrderDetails) => api(`/api/wholesale/orders/${order.id}/deliver`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success('تم تسجيل التسليم وتحديث الوزن والمخزون'); invalidate(); },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  const doReturn = useMutation({
    mutationFn: () => api(`/api/wholesale/orders/${returnOrder!.id}/return`, { method: 'POST', body: {
      items: Object.entries(returnQty).filter(([, qty]) => qty > 0).map(([allocationId, quantity]) => ({ allocationId: Number(allocationId), quantity })),
      makingRefundPercent: Number(refundPct || 0),
    } }),
    onSuccess: () => { toast.success('تم تسجيل المرتجع وإعادة القطع للمخزون'); setReturnOrder(null); setReturnQty({}); invalidate(); },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  const cancel = useMutation({
    mutationFn: (id: number) => api(`/api/wholesale/orders/${id}/cancel`, { method: 'POST', body: {} }),
    onSuccess: () => { toast.success('تم إلغاء الطلب وتحرير القطع'); setSelectedOrderId(null); invalidate(); },
    onError: (e: Error) => toast.error(errorMessage(e.message)),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="تجار الجملة" description="طلبات الوزن، تجهيز التشكيلات، العهدة النقدية وكشوف الحساب" actions={
        <><Button variant="outline" onClick={() => setTraderOpen(true)}><Users className="h-4 w-4" /> تاجر جديد</Button>
        <Button variant="brand" onClick={() => setOrderOpen(true)} disabled={!traders.length}><Plus className="h-4 w-4" /> طلب وزن</Button></>
      } />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Metric icon={ClipboardList} label="طلبات مفتوحة" value={String(dashboard?.openOrders ?? 0)} />
        <Metric icon={Boxes} label="وزن مطلوب" value={`${fmtNum(dashboard?.openTargetWeightG)} g`} />
        <Metric icon={PackageCheck} label="جاهز للتسليم" value={String(dashboard?.readyOrders ?? 0)} />
        <Metric icon={Banknote} label="رصيد المصنعية" value={fmtMoney(dashboard?.cashBalance)} />
      </div>

      <Tabs defaultValue="orders">
        <TabsList>
          <TabsTrigger value="orders"><ClipboardList className="h-4 w-4" /> طلبات الوزن</TabsTrigger>
          <TabsTrigger value="traders"><Users className="h-4 w-4" /> التجار</TabsTrigger>
          <TabsTrigger value="reports"><BookOpen className="h-4 w-4" /> ملخص الحسابات</TabsTrigger>
        </TabsList>
        <TabsContent value="orders"><OrdersTable orders={orders} onOpen={setSelectedOrderId} /></TabsContent>
        <TabsContent value="traders"><TradersTable traders={traders} onStatement={setStatementId} onPayment={setPaymentTrader} /></TabsContent>
        <TabsContent value="reports"><Reports traders={traders} orders={orders} onStatement={setStatementId} /></TabsContent>
      </Tabs>

      <Dialog open={traderOpen} onClose={() => setTraderOpen(false)} title="إضافة تاجر جملة" description="اختر عميلاً مسجلاً ليصبح له حساب جملة موحد">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="العميل *" wide><Select value={traderForm.customerId} onChange={(e) => setTraderForm({ ...traderForm, customerId: e.target.value })}>
            <option value="">اختر العميل</option>{(customers ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} {c.phone ? `- ${c.phone}` : ''}</option>)}</Select></Field>
          <Field label="اسم المنشأة"><Input value={traderForm.businessName} onChange={(e) => setTraderForm({ ...traderForm, businessName: e.target.value })} /></Field>
          <Field label="الرقم الضريبي"><Input value={traderForm.taxNumber} onChange={(e) => setTraderForm({ ...traderForm, taxNumber: e.target.value })} /></Field>
          <Field label="نسبة خصم المصنعية"><Input type="number" min="0" max="100" value={traderForm.defaultDiscountPct} onChange={(e) => setTraderForm({ ...traderForm, defaultDiscountPct: e.target.value })} /></Field>
          <Field label="حد الائتمان"><Input type="number" min="0" value={traderForm.creditLimit} onChange={(e) => setTraderForm({ ...traderForm, creditLimit: e.target.value })} /></Field>
          <Field label="مهلة السداد بالأيام"><Input type="number" min="0" value={traderForm.paymentTermsDays} onChange={(e) => setTraderForm({ ...traderForm, paymentTermsDays: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setTraderOpen(false)}>إلغاء</Button><Button variant="brand" loading={createTrader.isPending} disabled={!traderForm.customerId} onClick={() => createTrader.mutate()}>حفظ</Button></div>
      </Dialog>

      <Dialog open={orderOpen} onClose={() => setOrderOpen(false)} title="طلب وزن جديد" className="max-w-3xl">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="التاجر *" wide><Select value={orderForm.traderId} onChange={(e) => {
            const trader = traders.find((t) => String(t.id) === e.target.value);
            setOrderForm({ ...orderForm, traderId: e.target.value, discountPercent: String(trader?.defaultDiscountPct ?? 0) });
          }}><option value="">اختر التاجر</option>{traders.map((t) => <option key={t.id} value={t.id}>{t.name} {t.businessName ? `- ${t.businessName}` : ''}</option>)}</Select></Field>
          <Field label="المعدن"><Select value={orderForm.metalType} onChange={(e) => setOrderForm({ ...orderForm, metalType: e.target.value, carat: e.target.value === 'silver' ? '925' : '18' })}><option value="silver">فضة</option><option value="gold">ذهب</option></Select></Field>
          <Field label="العيار *"><Input value={orderForm.carat} onChange={(e) => setOrderForm({ ...orderForm, carat: e.target.value })} dir="ltr" /></Field>
          <Field label="الصنف"><Select value={orderForm.categoryId} onChange={(e) => setOrderForm({ ...orderForm, categoryId: e.target.value })}><option value="">تشكيلة مفتوحة</option>{(categories ?? []).map((c) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}</Select></Field>
          <Field label="الوزن المطلوب بالجرام *"><Input type="number" min="0.001" step="0.001" value={orderForm.targetWeightG} onChange={(e) => setOrderForm({ ...orderForm, targetWeightG: e.target.value })} /></Field>
          <Field label="هامش الوزن ± جرام"><Input type="number" min="0" step="0.001" value={orderForm.toleranceG} onChange={(e) => setOrderForm({ ...orderForm, toleranceG: e.target.value })} /></Field>
          <Field label="المصنعية لكل جرام"><Input type="number" min="0" step="0.01" value={orderForm.makingPerG} onChange={(e) => setOrderForm({ ...orderForm, makingPerG: e.target.value })} /></Field>
          <Field label="خصم المصنعية %"><Input type="number" min="0" max="100" value={orderForm.discountPercent} onChange={(e) => setOrderForm({ ...orderForm, discountPercent: e.target.value })} /></Field>
          <Field label="دفعة / عربون"><Input type="number" min="0" value={orderForm.deposit} onChange={(e) => setOrderForm({ ...orderForm, deposit: e.target.value })} /></Field>
          <Field label="طريقة الدفعة"><Select value={orderForm.paymentMethod} onChange={(e) => setOrderForm({ ...orderForm, paymentMethod: e.target.value })}>{(methods ?? []).map((m) => <option key={m.code} value={m.code}>{m.nameAr}</option>)}</Select></Field>
          <Field label="مصدر الطلب"><Select value={orderForm.channel} onChange={(e) => setOrderForm({ ...orderForm, channel: e.target.value })}><option value="store">زيارة المحل</option><option value="b2b">متجر B2B</option><option value="phone">هاتف</option><option value="whatsapp">واتساب</option></Select></Field>
          <Field label="موعد التسليم"><Input type="date" value={orderForm.dueDate} onChange={(e) => setOrderForm({ ...orderForm, dueDate: e.target.value })} /></Field>
          <Field label="ملاحظات" wide><Textarea value={orderForm.notes} onChange={(e) => setOrderForm({ ...orderForm, notes: e.target.value })} /></Field>
        </div>
        <div className="mt-5 flex justify-end gap-2"><Button variant="outline" onClick={() => setOrderOpen(false)}>إلغاء</Button><Button variant="brand" loading={createOrder.isPending} disabled={!orderForm.traderId || !orderForm.carat || !Number(orderForm.targetWeightG)} onClick={() => createOrder.mutate()}>إنشاء وبدء التجهيز</Button></div>
      </Dialog>

      {selectedOrderId && details && <OrderDialog order={details} onClose={() => setSelectedOrderId(null)} onSaved={invalidate}
        onDeliver={async () => { if (await confirmDialog('تأكيد تسليم جميع القطع المجهزة وخصمها من المخزون؟')) deliver.mutate(details); }}
        onReturn={() => { setReturnOrder(details); setReturnQty({}); }}
        onCancel={async () => { if (await confirmDialog('إلغاء الطلب وتحرير القطع غير المسلمة؟')) cancel.mutate(details.id); }} />}

      <Dialog open={!!paymentTrader} onClose={() => setPaymentTrader(null)} title={`تسجيل دفعة - ${paymentTrader?.name ?? ''}`}>
        <div className="grid gap-4 sm:grid-cols-2"><Field label="المبلغ *"><Input autoFocus type="number" min="0.01" value={paymentForm.amount} onChange={(e) => setPaymentForm({ ...paymentForm, amount: e.target.value })} /></Field>
        <Field label="طريقة الدفع"><Select value={paymentForm.method} onChange={(e) => setPaymentForm({ ...paymentForm, method: e.target.value })}>{(methods ?? []).map((m) => <option key={m.code} value={m.code}>{m.nameAr}</option>)}</Select></Field>
        <Field label="ملاحظات" wide><Textarea value={paymentForm.notes} onChange={(e) => setPaymentForm({ ...paymentForm, notes: e.target.value })} /></Field></div>
        <div className="mt-5 flex justify-end"><Button variant="brand" loading={payment.isPending} disabled={!Number(paymentForm.amount)} onClick={() => payment.mutate()}>تسجيل الدفعة</Button></div>
      </Dialog>

      <Dialog open={!!returnOrder} onClose={() => setReturnOrder(null)} title={`مرتجع ${returnOrder?.orderNo ?? ''}`} className="max-w-3xl">
        <p className="mb-3 text-sm text-slate-500">أدخل كمية القطع المرتجعة. سيُعاد وزنها للمخزون وعهدة التاجر.</p>
        <div className="max-h-80 overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>القطعة</TableHead><TableHead>الوزن</TableHead><TableHead>متاح للرد</TableHead><TableHead>الكمية</TableHead></TableRow></TableHeader><TableBody>
          {(returnOrder?.items ?? []).filter((x) => x.deliveredQty > x.returnedQty).map((x) => <TableRow key={x.id}><TableCell>{x.itemCodeSnapshot}</TableCell><TableCell>{fmtNum(x.weightGSnapshot)} g</TableCell><TableCell>{x.deliveredQty-x.returnedQty}</TableCell><TableCell><Input className="w-24" type="number" min="0" max={x.deliveredQty-x.returnedQty} value={returnQty[x.id] ?? 0} onChange={(e) => setReturnQty({ ...returnQty, [x.id]: Math.min(x.deliveredQty-x.returnedQty, Math.max(0, Number(e.target.value))) })} /></TableCell></TableRow>)}
        </TableBody></Table></div>
        <div className="mt-4 w-56"><Label>نسبة رد المصنعية</Label><Select value={refundPct} onChange={(e) => setRefundPct(e.target.value)}><option value="0">بدون رد مصنعية</option><option value="50">رد 50%</option><option value="100">رد كامل</option></Select></div>
        <div className="mt-5 flex justify-end"><Button variant="brand" loading={doReturn.isPending} disabled={!Object.values(returnQty).some((q) => q>0)} onClick={() => doReturn.mutate()}><RotateCcw className="h-4 w-4" /> اعتماد المرتجع</Button></div>
      </Dialog>

      <Dialog open={!!statementId} onClose={() => setStatementId(null)} title={`كشف حساب - ${statement?.trader.name ?? ''}`} className="max-w-5xl">
        <div className="max-h-[65vh] overflow-auto"><Table><TableHeader><TableRow><TableHead>التاريخ</TableHead><TableHead>الحركة</TableHead><TableHead>المرجع</TableHead><TableHead>العيار</TableHead><TableHead>الوزن</TableHead><TableHead>النقدية</TableHead><TableHead>الرصيد النقدي</TableHead></TableRow></TableHeader><TableBody>
          {(statement?.entries ?? []).map((e) => <TableRow key={e.id}><TableCell className="whitespace-nowrap text-xs">{fmtDateTime(e.createdAt)}</TableCell><TableCell>{ENTRY_LABELS[e.entryType] ?? e.entryType}</TableCell><TableCell className="font-mono text-xs">{e.orderNo || e.reference || '—'}</TableCell><TableCell>{e.carat || '—'}</TableCell><TableCell className={Number(e.metalDeltaG)<0 ? 'text-emerald-700' : ''}>{Number(e.metalDeltaG) ? `${Number(e.metalDeltaG)>0?'+':''}${fmtNum(e.metalDeltaG)} g` : '—'}</TableCell><TableCell className={Number(e.cashDelta)<0 ? 'text-emerald-700' : ''}>{Number(e.cashDelta) ? fmtMoney(e.cashDelta) : '—'}</TableCell><TableCell className="font-bold">{fmtMoney(e.runningCashBalance)}</TableCell></TableRow>)}
          {!statement?.entries.length && <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">لا توجد حركات</TableCell></TableRow>}
        </TableBody></Table></div>
      </Dialog>
    </div>
  );
}

function OrderDialog({ order, onClose, onSaved, onDeliver, onReturn, onCancel }: { order: OrderDetails; onClose: () => void; onSaved: () => void; onDeliver: () => void; onReturn: () => void; onCancel: () => void }) {
  const { data: inventory = [] } = useItems({ status: 'available', metalType: order.metalType });
  const [pending, setPending] = useState<Record<number, number>>({});
  const [scan, setScan] = useState('');
  const [camera, setCamera] = useState(false);
  const [history, setHistory] = useState<number[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const eligible = useMemo(() => inventory.filter((item) => String(item.carat || '') === String(order.carat) && (!order.categoryId || item.categoryId === order.categoryId)), [inventory, order]);

  useEffect(() => {
    const map: Record<number, number> = {};
    order.items.forEach((x) => { const remaining=x.quantity-x.deliveredQty; if (remaining>0) map[x.itemId]=remaining; });
    setPending(map);
  }, [order]);

  const selected = useMemo(() => Object.entries(pending).map(([id, quantity]) => {
    const itemId=Number(id);
    const stocked=eligible.find((x) => x.id===itemId) || inventory.find((x) => x.id===itemId);
    const allocated=order.items.find((x) => x.itemId===itemId);
    const item=stocked || (allocated ? {
      id:itemId, code:allocated.itemCodeSnapshot, barcode:allocated.barcode, name:allocated.itemNameSnapshot,
      weightG:allocated.weightGSnapshot, quantity:allocated.quantity, availableQty:quantity,
    } as Item : undefined);
    return { item, quantity };
  }).filter((x): x is {item: Item; quantity: number} => !!x.item), [pending, eligible, inventory, order.items]);
  const totalWeight = selected.reduce((sum, x) => sum+Number(x.item.weightG || 0)*x.quantity,0);
  const pieces = selected.reduce((sum,x) => sum+x.quantity,0);

  const accept = (raw: string) => {
    const value=raw.trim().toLowerCase(); if (!value) return;
    const alreadySelected=selected.find((x) => x.item.code.toLowerCase()===value || (x.item.barcode || '').toLowerCase()===value || labelCodeForItem(x.item).toLowerCase()===value);
    if (alreadySelected && Number(alreadySelected.item.quantity ?? 1)===1) { toast.warning(`القطعة ${alreadySelected.item.code} مضافة بالفعل`); beep(220); setScan(''); return; }
    const item=eligible.find((x) => x.code.toLowerCase()===value || (x.barcode || '').toLowerCase()===value || labelCodeForItem(x).toLowerCase()===value);
    if (!item) { toast.error('القطعة غير موجودة أو لا تطابق معدن وعيار الطلب'); setScan(''); return; }
    const current=pending[item.id] || 0; const available=Number(item.availableQty ?? item.quantity ?? 1);
    const serialized=Number(item.quantity ?? 1)===1;
    if (serialized && current>0) { toast.warning(`القطعة ${item.code} مضافة بالفعل`); beep(220); setScan(''); return; }
    if (current>=available) { toast.warning(`لا توجد كمية إضافية متاحة من ${item.code}`); beep(220); setScan(''); return; }
    setPending({ ...pending, [item.id]: current+1 }); setHistory([...history,item.id]); setScan(''); beep(740);
  };
  const undo=() => { const id=history.at(-1); if (!id) return; const next={...pending}; if (next[id]>1) next[id]-=1; else delete next[id]; setPending(next); setHistory(history.slice(0,-1)); };
  const save=useMutation({ mutationFn: () => api(`/api/wholesale/orders/${order.id}/allocations`, { method:'PUT', body:{items:Object.entries(pending).map(([itemId,quantity])=>({itemId:Number(itemId),quantity}))} }), onSuccess:()=>{toast.success('تم حفظ التشكيلة وحجز القطع');onSaved();},onError:(e:Error)=>toast.error(errorMessage(e.message)) });
  const editable=['draft','preparing','ready','partial'].includes(order.status);
  const canDeliver=order.items.some((x)=>x.quantity>x.deliveredQty) && ['preparing','ready','partial'].includes(order.status);

  return <>
    <Dialog open onClose={onClose} title={`${order.orderNo} - ${order.traderName}`} description={`${metalLabel(order.metalType)} عيار ${order.carat}`} className="max-w-6xl">
      <div className="grid gap-3 sm:grid-cols-4">
        <Mini label="المطلوب" value={`${fmtNum(order.targetWeightG)} g`} />
        <Mini label="قيد التجهيز" value={`${fmtNum(totalWeight)} g`} />
        <Mini label="عدد القطع" value={String(pieces)} />
        <Mini label="المتبقي" value={`${fmtNum(Number(order.targetWeightG)-totalWeight)} g`} accent={Math.abs(Number(order.targetWeightG)-totalWeight)<=Number(order.toleranceG)} />
      </div>
      {editable && <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex gap-2"><div className="relative flex-1"><ScanBarcode className="absolute right-3 top-3 h-4 w-4 text-slate-400" /><Input ref={scanRef} autoFocus value={scan} onChange={(e)=>setScan(e.target.value)} onKeyDown={(e)=>{if(e.key==='Enter') accept(scan)}} className="pr-10" placeholder="امسح QR أو الباركود بسرعة..." /></div>
        <Button variant="outline" size="icon" title="استخدام الكاميرا" onClick={()=>setCamera(true)}><Camera className="h-4 w-4" /></Button><Button variant="outline" size="icon" title="تراجع عن آخر مسحة" disabled={!history.length} onClick={undo}><Undo2 className="h-4 w-4" /></Button></div>
        <div className="mt-2 flex items-center justify-between text-xs text-slate-500"><span>القطعة الفريدة لا تتكرر، والصنف الكمي يزيد مع كل مسحة</span><span>هامش مسموح ± {fmtNum(order.toleranceG)} g</span></div>
      </div>}
      <div className="mt-4 max-h-72 overflow-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>القطعة</TableHead><TableHead>الوزن</TableHead><TableHead>مجهزة</TableHead><TableHead>سُلّمت</TableHead><TableHead className="text-end">إجراء</TableHead></TableRow></TableHeader><TableBody>
        {selected.map(({item,quantity})=><TableRow key={item.id}><TableCell><div className="font-mono text-xs font-bold">{item.code}</div><div className="text-xs text-slate-400">{item.name}</div></TableCell><TableCell>{fmtNum(item.weightG)} g</TableCell><TableCell>{quantity}</TableCell><TableCell>{order.items.find((x)=>x.itemId===item.id)?.deliveredQty || 0}</TableCell><TableCell className="text-end"><Button variant="ghost" size="icon" title="حذف من التشكيلة" onClick={()=>{const n={...pending};delete n[item.id];setPending(n)}}><Trash2 className="h-4 w-4 text-rose-600" /></Button></TableCell></TableRow>)}
        {!selected.length&&<TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-400">ابدأ بمسح قطع التشكيلة</TableCell></TableRow>}
      </TableBody></Table></div>
      <div className="mt-4 flex flex-wrap justify-between gap-2"><div className="flex gap-2">{editable&&<Button variant="brand" loading={save.isPending} onClick={()=>save.mutate()}><Save className="h-4 w-4" /> حفظ وحجز</Button>}{canDeliver&&<Button onClick={onDeliver}><Check className="h-4 w-4" /> تسليم المجهز</Button>}</div><div className="flex gap-2">{order.items.some((x)=>x.deliveredQty>x.returnedQty)&&<Button variant="outline" onClick={onReturn}><RotateCcw className="h-4 w-4" /> مرتجع</Button>}{!['completed','cancelled'].includes(order.status)&&<Button variant="ghost" className="text-rose-600" onClick={onCancel}>إلغاء الطلب</Button>}</div></div>
    </Dialog>
    {camera&&<CameraScannerDialog continuous onClose={()=>{setCamera(false);setTimeout(()=>scanRef.current?.focus(),0)}} onScan={accept} />}
  </>;
}

function OrdersTable({ orders, onOpen }: { orders: WholesaleOrder[]; onOpen: (id:number)=>void }) {
  return <Card><CardContent className="p-0"><div className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>الطلب</TableHead><TableHead>التاجر</TableHead><TableHead>المطلوب</TableHead><TableHead>المجهز</TableHead><TableHead>المسلم الصافي</TableHead><TableHead>المصنعية</TableHead><TableHead>الحالة</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>
    {orders.map((o)=><TableRow key={o.id}><TableCell><div className="font-mono text-xs font-bold">{o.orderNo}</div><div className="text-xs text-slate-400">{fmtDateTime(o.createdAt)}</div></TableCell><TableCell>{o.traderName}</TableCell><TableCell>{fmtNum(o.targetWeightG)} g</TableCell><TableCell>{fmtNum(o.allocatedWeightG)} g</TableCell><TableCell>{fmtNum(Number(o.deliveredWeightG)-Number(o.returnedWeightG))} g</TableCell><TableCell>{fmtMoney(Number(o.makingPerG)*(1-Number(o.discountPercent)/100))}/g</TableCell><TableCell><Badge tone={STATUS[o.status]?.tone}>{STATUS[o.status]?.label || o.status}</Badge></TableCell><TableCell><Button size="sm" variant="outline" onClick={()=>onOpen(o.id)}>{['draft','preparing','ready','partial'].includes(o.status)?'فتح وتجهيز':'عرض'}</Button></TableCell></TableRow>)}
    {!orders.length&&<TableRow><TableCell colSpan={8} className="py-10 text-center text-slate-400">لا توجد طلبات وزن بعد</TableCell></TableRow>}
  </TableBody></Table></div></CardContent></Card>;
}

function TradersTable({ traders, onStatement, onPayment }: { traders:Trader[]; onStatement:(id:number)=>void; onPayment:(t:Trader)=>void }) {
  return <Card><CardContent className="p-0"><Table><TableHeader><TableRow><TableHead>التاجر</TableHead><TableHead>الهاتف</TableHead><TableHead>طلبات مفتوحة</TableHead><TableHead>رصيد الوزن حسب العيار</TableHead><TableHead>رصيد المصنعية</TableHead><TableHead></TableHead></TableRow></TableHeader><TableBody>{traders.map((t)=><TableRow key={t.id}><TableCell><div className="font-bold">{t.name}</div><div className="text-xs text-slate-400">{t.businessName}</div></TableCell><TableCell dir="ltr">{t.phone||'—'}</TableCell><TableCell>{t.openOrders}</TableCell><TableCell>{metalBalancesText(t)}</TableCell><TableCell className="font-bold">{fmtMoney(t.cashBalance)}</TableCell><TableCell><div className="flex gap-2"><Button size="sm" variant="outline" onClick={()=>onStatement(t.id)}><BookOpen className="h-3.5 w-3.5" /> كشف</Button><Button size="sm" onClick={()=>onPayment(t)}><Banknote className="h-3.5 w-3.5" /> دفعة</Button></div></TableCell></TableRow>)}{!traders.length&&<TableRow><TableCell colSpan={6} className="py-10 text-center text-slate-400">أضف أول تاجر جملة</TableCell></TableRow>}</TableBody></Table></CardContent></Card>;
}

function Reports({ traders, orders, onStatement }: { traders:Trader[]; orders:WholesaleOrder[]; onStatement:(id:number)=>void }) {
  const ranked=[...traders].sort((a,b)=>Number(b.cashBalance)-Number(a.cashBalance));
  return <div className="grid gap-4 lg:grid-cols-2"><Card><CardContent className="pt-5"><h3 className="mb-4 font-bold">الأرصدة المستحقة</h3>{ranked.map((t)=><button key={t.id} onClick={()=>onStatement(t.id)} className="flex w-full items-center justify-between border-b py-3 text-sm last:border-0"><span>{t.name}</span><span className="font-bold">{fmtMoney(t.cashBalance)}</span></button>)}</CardContent></Card><Card><CardContent className="pt-5"><h3 className="mb-4 font-bold">حالة الطلبات</h3>{Object.entries(STATUS).map(([key,value])=><div key={key} className="flex items-center justify-between border-b py-3 text-sm last:border-0"><Badge tone={value.tone}>{value.label}</Badge><strong>{orders.filter((o)=>o.status===key).length}</strong></div>)}</CardContent></Card></div>;
}

function Metric({ icon:Icon, label, value }: { icon:typeof Users; label:string; value:string }) { return <Card><CardContent className="flex items-center gap-3 pt-5"><div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-50 text-brand-700"><Icon className="h-5 w-5" /></div><div><div className="text-xs text-slate-500">{label}</div><div className="mt-0.5 text-xl font-extrabold">{value}</div></div></CardContent></Card>; }
function Mini({ label,value,accent=false }:{label:string;value:string;accent?:boolean}) { return <div className={`rounded-lg border p-3 ${accent?'border-emerald-300 bg-emerald-50':'border-slate-200'}`}><div className="text-xs text-slate-500">{label}</div><div className="mt-1 text-lg font-extrabold">{value}</div></div>; }
function Field({ label, children, wide=false }: { label:string; children:React.ReactNode; wide?:boolean }) { return <div className={wide?'sm:col-span-2':''}><Label>{label}</Label>{children}</div>; }
function beep(frequency:number) { try { const ctx=new AudioContext(); const osc=ctx.createOscillator(); const gain=ctx.createGain(); osc.frequency.value=frequency; gain.gain.value=.05; osc.connect(gain); gain.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime+.08); } catch { /* audio is optional */ } }
function errorMessage(message:string) { const map:Record<string,string>={ 'wholesale.trader_exists':'هذا العميل مسجل كتاجر جملة بالفعل','wholesale.item_mismatch':'القطعة لا تطابق معدن أو عيار الطلب','wholesale.category_mismatch':'القطعة لا تطابق صنف الطلب','wholesale.order_locked':'لا يمكن تعديل هذا الطلب','wholesale.no_allocations':'لا توجد قطع مجهزة للتسليم' }; return map[message] || `تعذر إتمام العملية: ${message}`; }
function metalBalancesText(trader:Trader) { return trader.metalBalances?.length ? trader.metalBalances.map((b)=>`${metalLabel(b.metalType)} ${b.carat}: ${fmtNum(b.weightG)} g`).join(' | ') : '0.000 g'; }
