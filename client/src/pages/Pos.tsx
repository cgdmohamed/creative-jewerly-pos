import { useEffect, useRef, useState } from 'react';
import { ScanLine, Trash2, Plus, Minus, Printer, X, WifiOff, Gem, CloudUpload, RotateCcw, MessageCircle, UserPlus, ShoppingCart, HandCoins, Calculator, Camera } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useActivePrices, useItems, usePaymentMethodsActive, useSettings, useCustomers, useCategories } from '@/hooks/useData';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/stores/auth';
import { useOfflineStore } from '@/stores/offline';
import { fmtMoney, fmtNum, metalLabel, fmtDateTime, cn } from '@/lib/utils';
import { downloadInvoicePdf, openInvoiceWhatsAppWeb } from '@/lib/invoiceShare';
import type { CartLine, Item } from '@/lib/types';
import { storeName } from '@/lib/branding';
import { labelCodeForItem } from '@/lib/labels';
import { CameraScannerDialog } from '@/components/scanner/CameraScannerDialog';

const hasUsablePhone = (phone?: string | null) => String(phone ?? '').replace(/\D/g, '').length >= 8;

export default function Pos() {
  const { employee } = useAuth();
  const qc = useQueryClient();
  const { data: prices } = useActivePrices();
  const { data: payMethods } = usePaymentMethodsActive();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Item[]>([]);
  const [discountType, setDiscountType] = useState<'percent' | 'fixed'>('percent');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [discountValue, setDiscountValue] = useState(0);
  const [managerPin, setManagerPin] = useState('');
  const [needApproval, setNeedApproval] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [paidAmount, setPaidAmount] = useState('');
  const [showPad, setShowPad] = useState(false);
  const [lastInvoice, setLastInvoice] = useState<any>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const { data: allItems } = useItems({ includeInactive: 'false' });
  const { data: settings } = useSettings();
  const name = storeName(settings);
  const { data: customers } = useCustomers();
  const { data: categories } = useCategories();
  const [activeCategory, setActiveCategory] = useState<number | 'all'>('all');
  const [customerId, setCustomerId] = useState<number | ''>('');
  const [showCustomerForm, setShowCustomerForm] = useState(false);
  const [customerForm, setCustomerForm] = useState({ name: '', phone: '' });
  const [showCameraScanner, setShowCameraScanner] = useState(false);

  const isDiscountOverride = employee?.permissions.includes('invoice.discount_override');
  const cashierDiscountEnabled = settings?.cashier_discount_enabled !== 'false';
  const capOverrideEnabled = settings?.cashier_cap_override_enabled !== 'false';

  const { pushPending, pending, failures, removePending, removeFailure, retryFailure, syncNow } = useOfflineStore();
  const [offline, setOffline] = useState(false);
  const [showPending, setShowPending] = useState(false);

  useEffect(() => {
    const onOffline = () => setOffline(true);
    const onOnline = () => {
      setOffline(false);
      void useOfflineStore.getState().syncNow();
      qc.invalidateQueries({ queryKey: ['items'] });
    };
    window.addEventListener('offline', onOffline);
    window.addEventListener('online', onOnline);
    setOffline(!navigator.onLine);
    return () => {
      window.removeEventListener('offline', onOffline);
      window.removeEventListener('online', onOnline);
    };
  }, [qc]);

  const isGeneral = (item: Item) => item.productKind === 'general';

  const metalPriceFor = (item: Item): number | null => {
    const p = (prices ?? []).find(
      (x) => x.metalType === item.metalType && (x.carat || '') === (item.carat || ''),
    );
    return p ? Number(p.pricePerGram) : null;
  };

  /** Unit line total: the fixed sale price for general products (watches…),
   *  weight × daily metal price for jewelry. Null = not sellable yet. */
  const unitTotal = (item: Item): number | null => {
    if (isGeneral(item)) {
      const sp = Number(item.salePrice);
      return sp > 0 ? sp : null;
    }
    const mp = metalPriceFor(item);
    return mp != null && Number(item.weightG) > 0 ? Number(item.weightG) * mp : null;
  };

  const availableItems = (allItems ?? []).filter(
    (i) => i.status === 'available' && (activeCategory === 'all' || i.categoryId === activeCategory),
  );

  const doSearch = (q: string) => {
    const val = q.trim();
    if (!val) { setResults([]); return; }
    const matches = (allItems ?? []).filter((it) =>
      it.status === 'available' &&
      (it.code.toLowerCase().includes(val.toLowerCase()) ||
        (it.barcode || '').toLowerCase().includes(val.toLowerCase()) ||
        labelCodeForItem(it).includes(val) ||
        (it.name || '').toLowerCase().includes(val.toLowerCase())),
    );
    setResults(matches);
  };

  const findScannedItem = (raw: string) => {
    const scanned = raw.trim().toLowerCase();
    return (allItems ?? []).find((item) =>
      item.status === 'available' && (
        labelCodeForItem(item) === scanned ||
        item.code.toLowerCase() === scanned ||
        (item.barcode || '').toLowerCase() === scanned
      ),
    );
  };

  const acceptScannedCode = (raw: string) => {
    const value = raw.trim();
    const item = findScannedItem(value);
    setQuery(value);
    if (item) {
      if (addToCart(item)) toast.success(`تمت قراءة ${item.code}`);
      return;
    }
    doSearch(value);
    toast.warning('لم يتم العثور على منتج مطابق للرمز');
  };

  const addToCart = (item: Item): boolean => {
    const general = isGeneral(item);
    const unit = unitTotal(item);
    if (unit == null) {
      toast.error(general
        ? 'لا يوجد سعر بيع لهذا المنتج — حدّد سعر البيع أولاً'
        : `لا يوجد سعر لليوم لهذا المعدن (${metalLabel(item.metalType || '')} عيار ${item.carat || '—'})`);
      return false;
    }
    if (cart.some((l) => l.item.id === item.id)) {
      toast.warning('القطعة موجودة بالفعل في الفاتورة');
      return false;
    }
    let unitMetal = 0;
    let unitCraft: number;
    if (general) {
      unitCraft = unit;
    } else {
      unitMetal = Number(item.weightG) * metalPriceFor(item)!;
      unitCraft =
        item.craftsmanshipType === 'percent'
          ? (unitMetal * Number(item.craftsmanshipValue)) / 100
          : Number(item.craftsmanshipValue);
    }
    setCart((c) => [
      ...c,
      {
        item, quantity: 1, metalPrice: general ? 0 : metalPriceFor(item)!,
        metalTotal: unitMetal, craft: unitCraft, lineTotal: unitMetal + unitCraft,
      },
    ]);
    setQuery('');
    setResults([]);
    searchRef.current?.focus();
    return true;
  };

  const removeLine = (id: number) => setCart((c) => c.filter((l) => l.item.id !== id));

  const setLineQty = (id: number, qty: number) => {
    setCart((c) =>
      c.map((l) => {
        if (l.item.id !== id) return l;
        const q = Math.max(1, Math.min(qty, l.item.availableQty ?? 1));
        if (isGeneral(l.item)) {
          const unit = Number(l.item.salePrice) || 0;
          return { ...l, quantity: q, metalTotal: 0, craft: unit * q, lineTotal: unit * q };
        }
        const metalTotal = Number(l.item.weightG) * l.metalPrice * q;
        const craft =
          l.item.craftsmanshipType === 'percent'
            ? (metalTotal * Number(l.item.craftsmanshipValue)) / 100
            : Number(l.item.craftsmanshipValue) * q;
        return { ...l, quantity: q, metalTotal, craft, lineTotal: metalTotal + craft };
      }),
    );
  };

  const metalSubtotal = cart.reduce((s, l) => s + l.metalTotal, 0);
  const rawCraftTotal = cart.reduce((s, l) => s + l.craft, 0);
  const discount =
    discountType === 'fixed'
      ? Math.min(Number(discountValue || 0), rawCraftTotal)
      : (rawCraftTotal * Number(discountPercent || 0)) / 100;
  const craftTotal = rawCraftTotal - discount;
  const vatPercent = Number(settings?.vat_percent ?? 0);
  const vat = vatPercent > 0 ? ((metalSubtotal + craftTotal) * vatPercent) / 100 : 0;
  const total = metalSubtotal + craftTotal + vat;

  const paidNum = paidAmount ? Number(paidAmount) : 0;
  const hasPaid = paidAmount.trim() !== '';
  const change = paidNum - total;

  const pressPaidKey = (k: string) => {
    if (k === 'C') return setPaidAmount('');
    if (k === '⌫') return setPaidAmount((p) => p.slice(0, -1));
    setPaidAmount((p) => {
      const next = (p === '0' ? '' : p) + k;
      return next.length <= 9 ? next : p;
    });
  };

  const discountRate = rawCraftTotal > 0 ? (discount / rawCraftTotal) * 100 : 0;
  const exceedCap =
    !isDiscountOverride && discount > 0 && discountRate > Number(employee?.discountCapPercent ?? 0);
  const capBlocked = exceedCap && !capOverrideEnabled;

  const checkout = async () => {
    const selectedCustomer = (customers ?? []).find((customer) => customer.id === customerId);
    if (!customerId) {
      setCustomerForm({ name: '', phone: '' });
      setShowCustomerForm(true);
      toast.warning('يجب إضافة عميل ورقم موبايل قبل إتمام البيع');
      return;
    }
    if (!hasUsablePhone(selectedCustomer?.phone)) {
      toast.warning('العميل المختار لا يحتوي على رقم موبايل — حدّث بياناته أو اختر عميلاً آخر');
      return;
    }

    const payload = {
      items: cart.map((l) => ({ itemId: l.item.id, quantity: l.quantity })),
      discountType,
      discountPercent: discountType === 'percent' ? Number(discountPercent) : 0,
      discountValue: discountType === 'fixed' ? Number(discountValue) : 0,
      managerPin: needApproval ? managerPin : null,
      paymentMethod,
      paidAmount: paidAmount ? Number(paidAmount) : total,
      customerId: customerId || null,
      customerPhone: null,
      locationId: employee?.locationId ?? 1,
      isOffline: offline,
      deviceId: navigator.userAgent,
    };
    try {
      const inv = await api('/api/invoices', { method: 'POST', body: payload });
      setLastInvoice(inv);
      setCart([]);
      setDiscountType('percent');
      setDiscountPercent(0);
      setDiscountValue(0);
      setManagerPin('');
      setNeedApproval(false);
      setPaidAmount('');
      setCustomerId('');
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['dashboard-data'] });
      qc.invalidateQueries({ queryKey: ['invoices'] });
    } catch (e: any) {
      if (!navigator.onLine || e instanceof TypeError) {
        pushPending('invoice.create', payload);
        toast.info('تم حفظ الفاتورة محليًا — ستُرسل عند عودة الاتصال');
        setCart([]);
      } else if (String(e.message).includes('discount.requires_manager')) {
        setNeedApproval(true);
        toast.warning('تجاوز سقف الخصم — مطلوب موافقة المدير (PIN)');
      } else if (String(e.message).includes('discount.disabled_for_cashier')) {
        toast.error('الخصم معطّل للكاشير — تواصل مع المدير');
      } else if (String(e.message).includes('discount.exceeds_cap')) {
        toast.error('تجاوز سقف الخصم غير مسموح في الإعدادات الحالية');
      } else if (String(e.message).includes('not_available')) {
        toast.error('إحدى القطع لم تعد متاحة — حدث خطأ في المخزون');
      } else if (String(e.message).includes('prices.missing_today')) {
        toast.error('لا يوجد سعر محدد لليوم لأحد المعادن — لا يمكن البيع');
      } else if (String(e.message).includes('customers.required')) {
        setCustomerForm({ name: '', phone: '' });
        setShowCustomerForm(true);
        toast.warning('يجب إضافة عميل وربطه بالفاتورة قبل إتمام البيع');
      } else if (String(e.message).includes('customers.phone_required')) {
        toast.warning('يجب أن يحتوي العميل على رقم موبايل صالح قبل إتمام البيع');
      } else {
        toast.error('خطأ: ' + e.message);
      }
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="نقطة البيع"
        description={offline ? 'وضع العمل دون اتصال — تُحفظ الفواتير محليًا' : 'بحث سريع بالكود أو الباركود'}
        actions={
          pending.length > 0 || failures.length > 0 ? (
            <button
              onClick={() => setShowPending(true)}
              className="flex items-center gap-2 rounded-full bg-sky-100 px-3 py-1.5 text-sm font-bold text-sky-800 transition-colors hover:bg-sky-200"
            >
              {offline ? <WifiOff className="h-3.5 w-3.5" /> : <CloudUpload className="h-3.5 w-3.5" />}
              {pending.length > 0 ? `قيد المزامنة: ${pending.length}` : ''}
              {failures.length > 0 ? `${pending.length > 0 ? ' • ' : ''}فشل: ${failures.length}` : ''}
            </button>
          ) : offline ? (
            <Badge tone="bg-amber-100 text-amber-800"><WifiOff className="h-3.5 w-3.5" /> دون اتصال</Badge>
          ) : undefined
        }
      />

      {showPending && (
        <PendingOpsDialog
          pending={pending}
          failures={failures}
          onClose={() => setShowPending(false)}
          onRemovePending={removePending}
          onRemoveFailure={removeFailure}
          onRetry={retryFailure}
          onSync={async () => {
            const r = await syncNow();
            if (r) {
              if (r.failed === 0) toast.success(`تمت مزامنة ${r.applied} عملية بنجاح`);
              else toast.warning(`فشلت ${r.failed} عملية — راجع القائمة`);
            } else if (!navigator.onLine) {
              toast.error('لا يوجد اتصال بالإنترنت');
            }
          }}
        />
      )}

      {showCustomerForm && (
        <Dialog open onClose={() => setShowCustomerForm(false)} title="إضافة عميل جديد" className="max-w-sm">
          <div className="space-y-3">
            <div>
              <Label>اسم العميل *</Label>
              <Input
                value={customerForm.name}
                onChange={(e) => setCustomerForm({ ...customerForm, name: e.target.value })}
                placeholder="مثال: أحمد محمد"
              />
            </div>
            <div>
              <Label>رقم الموبايل (مطلوب للإرسال) *</Label>
              <Input
                value={customerForm.phone}
                onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })}
                dir="ltr"
                placeholder="01xxxxxxxxx"
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowCustomerForm(false)}>إلغاء</Button>
            <Button
              variant="brand"
              disabled={!customerForm.name.trim() || !hasUsablePhone(customerForm.phone)}
              onClick={async () => {
                if (!navigator.onLine) {
                  toast.error('إضافة عميل جديد تحتاج اتصالاً بالإنترنت');
                  return;
                }
                try {
                  const created = await api<any>('/api/customers', {
                    method: 'POST',
                    body: { name: customerForm.name, phone: customerForm.phone || null },
                  });
                  qc.setQueryData<any[]>(['customers', ''], (current = []) => [
                    created,
                    ...current.filter((customer) => customer.id !== created.id),
                  ]);
                  setCustomerId(created.id);
                  setCustomerForm({ name: '', phone: '' });
                  setShowCustomerForm(false);
                  void qc.invalidateQueries({ queryKey: ['customers'] });
                  toast.success('تم تسجيل العميل وربطه بالفاتورة');
                } catch (e: any) {
                  toast.error('خطأ: ' + e.message);
                }
              }}
            >
              <UserPlus className="h-4 w-4" /> حفظ وربط
            </Button>
          </div>
        </Dialog>
      )}

      {showCameraScanner && (
        <CameraScannerDialog
          onClose={() => setShowCameraScanner(false)}
          onScan={(value) => {
            setShowCameraScanner(false);
            acceptScannedCode(value);
          }}
        />
      )}

      <div className="grid gap-6 lg:grid-cols-5">
        {/* Search panel */}
        <div className="lg:col-span-3 space-y-4">
          <Card>
            <CardContent className="p-4">
              <div className="flex gap-2">
                <div className="relative min-w-0 flex-1">
                  <ScanLine className="absolute right-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
                  <Input
                    ref={searchRef}
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); doSearch(e.target.value); }}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return;
                      const exact = findScannedItem(e.currentTarget.value);
                      const item = exact ?? (results.length === 1 ? results[0] : null);
                      if (item) {
                        e.preventDefault();
                        if (addToCart(item)) toast.success(`تمت قراءة ${item.code}`);
                      } else {
                        toast.warning('لم يتم العثور على منتج مطابق للرمز');
                      }
                    }}
                    placeholder="امسح QR / الباركود أو اكتب الكود والاسم…"
                    className="h-12 pr-10 text-base"
                    autoFocus
                  />
                </div>
                <Button
                  variant="outline"
                  className="h-12 shrink-0 px-3"
                  onClick={() => setShowCameraScanner(true)}
                  title="قراءة QR أو الباركود بالكاميرا"
                >
                  <Camera className="h-5 w-5" />
                  <span className="hidden sm:inline">الكاميرا</span>
                </Button>
              </div>

              {results.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {results.map((it) => {
                    const general = isGeneral(it);
                    const unit = unitTotal(it);
                    return (
                      <button
                        key={it.id}
                        onClick={() => addToCart(it)}
                        className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white p-3 text-start transition-colors hover:border-brand-400 hover:bg-brand-50"
                      >
                        <ProductThumb src={it.photoUrl} className="h-16 w-16 rounded-lg border border-slate-100" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-bold text-slate-900">{it.name || it.code}</div>
                          <div className="font-mono text-xs text-slate-400">{it.code}</div>
                          <div className="text-xs text-slate-400">
                            {it.categoryName && <span className="text-brand-600">{it.categoryName} • </span>}
                            {general
                              ? 'منتج عام — بسعر ثابت'
                              : <>{metalLabel(it.metalType || '')} {it.carat && `• عيار ${it.carat}`} • {fmtNum(it.weightG)} جم</>}
                            {!!(it.availableQty ?? 0) && <span className="text-emerald-600"> • متاح {it.availableQty}</span>}
                          </div>
                        </div>
                        <div className="text-left">
                          {unit != null ? (
                            <div className="text-xs font-bold text-brand-700">
                              {general ? fmtMoney(unit) : `${fmtMoney(metalPriceFor(it))} / جم`}
                            </div>
                          ) : (
                            <div className="text-xs text-rose-600">{general ? 'بدون سعر' : 'لا سعر اليوم'}</div>
                          )}
                          <Plus className="mt-1 h-4 w-4 text-slate-400" />
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {results.length === 0 && query && (
                <div className="mt-3 rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
                  لا توجد قطع متاحة مطابقة للبحث.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Available items quick pick */}
          <Card>
            <CardContent className="p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-700">قطع متاحة حالياً</h3>
                <span className="text-xs text-slate-400">
                  {availableItems.reduce((s, i) => s + (i.availableQty ?? 1), 0)} قطعة
                </span>
              </div>

              <div className="mb-3 flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className={cn(
                    'rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                    activeCategory === 'all'
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700',
                  )}
                >
                  الكل
                </button>
                {(categories ?? []).filter((c) => c.isActive !== false).map((c) => {
                  const count = (allItems ?? []).filter(
                    (i) => i.status === 'available' && i.categoryId === c.id,
                  ).length;
                  if (!count) return null;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => setActiveCategory(c.id)}
                      className={cn(
                        'rounded-full border px-3 py-1 text-xs font-bold transition-colors',
                        activeCategory === c.id
                          ? 'border-brand-600 bg-brand-600 text-white'
                          : 'border-slate-200 bg-white text-slate-600 hover:border-brand-300 hover:text-brand-700',
                      )}
                    >
                      {c.nameAr}
                      <span className={cn('mr-1.5', activeCategory === c.id ? 'text-white/80' : 'text-slate-400')}>{count}</span>
                    </button>
                  );
                })}
              </div>

              <div className="max-h-80 overflow-y-auto pr-1">
                <div className="grid gap-2 sm:grid-cols-2">
                  {availableItems
                    .slice(0, 24)
                    .map((it) => (
                      <button
                        key={it.id}
                        onClick={() => addToCart(it)}
                        disabled={unitTotal(it) == null}
                        className="flex min-w-0 items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 text-start transition-colors hover:border-brand-400 hover:bg-brand-50 disabled:opacity-50"
                      >
                          <ProductThumb src={it.photoUrl} className="h-12 w-12 rounded-md border border-slate-100" />
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-bold text-slate-900">{it.name || it.code}</div>
                            {it.categoryName && (
                              <div className="truncate text-[11px] text-brand-600">{it.categoryName}</div>
                            )}
                            <div className="truncate font-mono text-[10px] text-slate-400">{it.code}</div>
                            <div className="text-xs text-slate-500">
                              {isGeneral(it) ? 'بسعر ثابت' : `${fmtNum(it.weightG)} جم`}
                              {!!(it.availableQty ?? 0) && <span className="text-emerald-600"> • {it.availableQty}</span>}
                            </div>
                          </div>
                          <div className="text-left">
                            {unitTotal(it) != null && (
                              <div className="text-xs font-bold text-brand-700">{fmtMoney(unitTotal(it)!)}</div>
                            )}
                          </div>
                      </button>
                    ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Cart */}
        <div className="lg:col-span-2">
          <Card className="sticky top-10 overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 bg-slate-50/60 px-4 py-3">
              <h3 className="flex items-center gap-2 font-bold text-slate-900">
                <ShoppingCart className="h-4 w-4 text-brand-600" />
                الفاتورة
                {cart.length > 0 && <Badge tone="bg-brand-100 text-brand-700">{cart.length}</Badge>}
              </h3>
              {cart.length > 0 && (
                <button
                  onClick={() => setCart([])}
                  className="flex items-center gap-1 text-xs font-medium text-rose-600 hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" /> تفريغ
                </button>
              )}
            </div>

            <div className="max-h-72 space-y-2 overflow-y-auto p-3">
              {cart.length === 0 ? (
                <div className="flex flex-col items-center gap-2 py-12 text-slate-300">
                  <Gem className="h-10 w-10" />
                  <span className="text-sm font-medium text-slate-400">
                    الفاتورة فارغة — امسح قطعة أو اخترها من القائمة
                  </span>
                </div>
              ) : (
                cart.map((l) => (
                  <div
                    key={l.item.id}
                    className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2.5 shadow-sm"
                  >
                    <ProductThumb src={l.item.photoUrl} className="h-12 w-12 shrink-0 rounded-lg border border-slate-100" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-bold text-slate-900">{l.item.name || l.item.code}</span>
                        <button onClick={() => removeLine(l.item.id)} className="text-slate-300 transition-colors hover:text-rose-600" title="حذف القطعة">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="truncate font-mono text-xs text-slate-400">{l.item.code}</div>
                      <div className="mt-0.5 text-xs text-slate-500">
                        {isGeneral(l.item) ? (
                          <>سعر ثابت {fmtMoney(l.craft)}</>
                        ) : (
                          <>
                            {fmtNum(l.item.weightG)} جم × {fmtMoney(l.metalPrice)}
                            <span className="text-slate-400">/جم • مصنعية {fmtMoney(l.craft)}</span>
                          </>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-col items-center gap-1.5">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setLineQty(l.item.id, l.quantity + 1)}
                          disabled={l.quantity >= (l.item.availableQty ?? 1)}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-7 text-center text-sm font-bold text-slate-900">{l.quantity}</span>
                        <button
                          onClick={() => setLineQty(l.item.id, l.quantity - 1)}
                          disabled={l.quantity <= 1}
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-40"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      <span className="text-sm font-extrabold text-slate-900">{fmtMoney(l.lineTotal)}</span>
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="border-t border-slate-100 bg-slate-50/60 p-4">
              <div className="space-y-1.5 rounded-xl bg-white p-3 text-sm ring-1 ring-slate-100">
                <div className="flex justify-between">
                  <span className="text-slate-500">قيمة المعدن</span>
                  <span className="font-medium text-slate-900">{fmtMoney(metalSubtotal)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">المصنعية / سعر المنتجات</span>
                  <span className="font-medium text-slate-900">{fmtMoney(rawCraftTotal)}</span>
                </div>
                {discount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>الخصم ({discountType === 'fixed' ? fmtMoney(Number(discountValue)) : discountPercent + '%'})</span>
                    <span>-{fmtMoney(discount)}</span>
                  </div>
                )}
                {vat > 0 && (
                  <div className="flex justify-between text-slate-500">
                    <span>ضريبة القيمة المضافة ({vatPercent}%)</span>
                    <span className="font-medium">{fmtMoney(vat)}</span>
                  </div>
                )}
                <div className="flex items-end justify-between border-t border-dashed border-slate-200 pt-2">
                  <span className="text-sm font-bold text-slate-900">الإجمالي</span>
                  <span className="text-xl font-extrabold leading-none text-brand-700">
                    {fmtMoney(total)}
                    <span className="text-sm"> ج.م</span>
                  </span>
                </div>
              </div>
            </div>

            <div className="space-y-3 border-t border-slate-100 p-4">

                {!isDiscountOverride && !cashierDiscountEnabled && (
                  <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                    الخصم معطّل للكاشير من الإعدادات
                  </div>
                )}

                {(isDiscountOverride || cashierDiscountEnabled) && (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between">
                      <Label>الخصم على المصنعية</Label>
                      {isDiscountOverride ? (
                        <Badge tone="bg-emerald-100 text-emerald-800">مدير — بدون سقف</Badge>
                      ) : (
                        <span className="text-[11px] text-slate-400">سقفك {employee?.discountCapPercent}% من المصنعية</span>
                      )}
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <Select value={discountType} onChange={(e) => setDiscountType(e.target.value as any)}>
                        <option value="percent">نسبة %</option>
                        <option value="fixed">قيمة ثابتة</option>
                      </Select>
                      <Input
                        type="number"
                        min={0}
                        className="col-span-2"
                        value={discountType === 'percent' ? discountPercent : discountValue}
                        placeholder={discountType === 'percent' ? 'مثال: 5' : 'المبلغ بالجنيه'}
                        onChange={(e) => {
                          const v = Math.max(0, Number(e.target.value) || 0);
                          if (discountType === 'percent') setDiscountPercent(Math.min(v, 100));
                          else setDiscountValue(v);
                        }}
                      />
                    </div>
                    {exceedCap && (
                      <div className="text-[11px] text-amber-700">
                        تجاوزت سقف الخصم ({employee?.discountCapPercent}% من المصنعية).
                        {capBlocked ? ' التجاوز معطّل من الإعدادات — لا يمكن تطبيق هذا الخصم.' : ' مطلوب موافقة المدير.'}
                      </div>
                    )}
                  </div>
                )}

                {exceedCap && !capBlocked && !needApproval && (
                  <button
                    onClick={() => setNeedApproval(true)}
                    className="w-full rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800"
                  >
                    تجاوز سقف الخصم المسموح ({employee?.discountCapPercent}%) — مطلوب موافقة المدير
                  </button>
                )}

                {needApproval && (
                  <div>
                    <Label>PIN المدير للموافقة على الخصم</Label>
                    <Input
                      type="password"
                      value={managerPin}
                      onChange={(e) => setManagerPin(e.target.value)}
                      dir="ltr"
                      className="text-center tracking-[0.5em]"
                    />
                  </div>
                )}

                <div className="space-y-3">
                  <div>
                    <Label>العميل (مطلوب)</Label>
                    <div className="flex gap-2">
                      <Select
                        value={customerId}
                        onChange={(e) => {
                          if (e.target.value === '__new__') {
                            setCustomerForm({ name: '', phone: '' });
                            setShowCustomerForm(true);
                          } else {
                            setCustomerId(e.target.value ? Number(e.target.value) : '');
                          }
                        }}
                        className="flex-1"
                      >
                        <option value="">اختر العميل</option>
                        {(customers ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}{c.phone ? ` — ${c.phone}` : ''}
                          </option>
                        ))}
                      </Select>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setCustomerForm({ name: '', phone: '' });
                          setShowCustomerForm(true);
                        }}
                        title="إضافة عميل جديد"
                      >
                        <UserPlus className="h-4 w-4" /> عميل جديد
                      </Button>
                    </div>
                  </div>

                  <div>
                    <Label>طريقة الدفع</Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(payMethods ?? []).map((m) => (
                        <button
                          key={m.code}
                          type="button"
                          onClick={() => setPaymentMethod(m.code)}
                          className={cn(
                            'flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2.5 text-xs font-bold transition-all',
                            paymentMethod === m.code
                              ? 'border-transparent text-white shadow-sm'
                              : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
                          )}
                          style={paymentMethod === m.code ? { background: m.color } : undefined}
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ background: paymentMethod === m.code ? '#fff' : m.color }}
                          />
                          {m.nameAr}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="mb-1 flex items-center justify-between">
                      <Label>المدفوع</Label>
                      {cart.length > 0 && (
                        <button
                          type="button"
                          onClick={() => setPaidAmount(String(total))}
                          className="text-[11px] font-bold text-brand-600 hover:underline"
                        >
                          المبلغ كامل
                        </button>
                      )}
                    </div>
                    <div className="relative rounded-xl border-2 border-brand-200 bg-white px-4 py-3 text-center shadow-sm">
                      <button
                        type="button"
                        onClick={() => setShowPad((v) => !v)}
                        title={showPad ? 'إخفاء لوحة الأرقام' : 'إظهار لوحة الأرقام'}
                        className={cn(
                          'absolute left-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md border transition-colors',
                          showPad
                            ? 'border-brand-200 bg-brand-50 text-brand-700'
                            : 'border-slate-200 bg-white text-slate-400 hover:text-slate-700',
                        )}
                      >
                        <Calculator className="h-4 w-4" />
                      </button>
                      <div dir="ltr" className="text-3xl font-extrabold tabular-nums leading-none text-slate-900">
                        {paidAmount || '0'}
                      </div>
                      <div className="mt-1 text-[11px] font-medium text-slate-400">جنيه مصري</div>
                    </div>
                    {showPad && (
                      <div dir="ltr" className="mt-2 grid grid-cols-3 gap-1.5">
                        {['7', '8', '9', '4', '5', '6', '1', '2', '3', 'C', '0', '⌫'].map((k) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => pressPaidKey(k)}
                            className={cn(
                              'rounded-lg border py-2.5 text-base font-bold transition-all active:scale-95',
                              k === 'C' || k === '⌫'
                                ? 'border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100'
                                : 'border-slate-200 bg-white text-slate-800 hover:bg-slate-50',
                            )}
                          >
                            {k}
                          </button>
                        ))}
                      </div>
                    )}
                    {hasPaid &&
                      (change >= 0 ? (
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">
                          <span>الباقي للعميل</span>
                          <span>{fmtMoney(change)} ج.م</span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center justify-between rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700">
                          <span>المتبقي مستحق</span>
                          <span>{fmtMoney(-change)} ج.م</span>
                        </div>
                      ))}
                  </div>
                </div>

                <Button
                  variant="brand"
                  size="lg"
                  className="w-full"
                  disabled={cart.length === 0 || capBlocked}
                  onClick={checkout}
                >
                  <HandCoins className="h-4 w-4" /> إتمام البيع — {fmtMoney(total)} ج.م
                </Button>
              </div>
          </Card>
        </div>
      </div>

      {lastInvoice && (
        <InvoiceModal invoice={lastInvoice} storeName={name} onClose={() => setLastInvoice(null)} />
      )}
    </div>
  );
}

function InvoiceModal({ invoice, storeName, onClose }: { invoice: any; storeName: string; onClose: () => void }) {
  const { employee } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);
  const [sendingWhatsApp, setSendingWhatsApp] = useState(false);

  const sendPdfToWhatsApp = async () => {
    if (!invoice.customerId || !hasUsablePhone(invoice.customerPhone)) {
      toast.error('لا يمكن الإرسال: الفاتورة غير مرتبطة بعميل لديه رقم موبايل');
      return;
    }
    if (!printRef.current) return;

    const opened = openInvoiceWhatsAppWeb(invoice, invoice.customerPhone, storeName);
    setSendingWhatsApp(true);
    try {
      const filename = await downloadInvoicePdf(printRef.current, invoice);
      toast[opened ? 'success' : 'warning'](
        opened
          ? `تم تنزيل ${filename} وفتح محادثة العميل — أرفق الملف من التنزيلات`
          : `تم تنزيل ${filename} — اسمح بالنوافذ المنبثقة ثم افتح واتساب مجدداً`,
      );
    } catch {
      toast.error('تعذر إنشاء ملف PDF للفاتورة');
    } finally {
      setSendingWhatsApp(false);
    }
  };

  return (
    <Dialog open onClose={onClose} title="تم البيع بنجاح" className="max-w-md">
      <div ref={printRef} className="print-area rounded-lg border border-slate-200 p-5 text-sm">
        <div className="mb-3 text-center">
          <div className="text-lg font-extrabold text-slate-900">{storeName}</div>
          <div className="text-xs text-slate-500">فاتورة داخلية</div>
        </div>
        <div className="mb-3 flex justify-between border-b border-dashed pb-2">
          <span className="font-mono font-bold">{invoice.invoiceNo}</span>
          <span className="whitespace-nowrap text-xs text-slate-500">{new Date(invoice.createdAt).toLocaleString('ar-EG-u-nu-latn')}</span>
        </div>
        <table className="mb-3 w-full text-xs">
          <thead>
            <tr className="border-b text-slate-500">
              <th className="py-1 text-start">القطعة</th>
              <th className="py-1 text-start">كمية</th>
              <th className="py-1 text-start">وزن</th>
              <th className="py-1 text-start">سعر</th>
              <th className="py-1 text-start">مصنعية</th>
              <th className="py-1 text-start">إجمالي</th>
            </tr>
          </thead>
          <tbody>
            {(invoice.items ?? []).map((it: any) => (
              <tr key={it.id} className="border-b border-slate-100">
                <td className="py-1 font-mono">{it.itemCodeSnapshot}</td>
                <td className="py-1">{it.quantity ?? 1}</td>
                <td className="py-1">{fmtNum(it.weightGSnapshot)}</td>
                <td className="py-1">{fmtMoney(it.metalPriceSnapshot)}</td>
                <td className="py-1">{fmtMoney(it.craftsmanshipSnapshot)}</td>
                <td className="py-1">{fmtMoney(it.lineTotal)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between"><span>قيمة المعدن</span><span>{fmtMoney(invoice.metalSubtotal)}</span></div>
          <div className="flex justify-between"><span>المصنعية</span><span>{fmtMoney(invoice.craftsmanshipTotal)}</span></div>
          {Number(invoice.discountAmount) > 0 && (
            <div className="flex justify-between text-rose-600"><span>الخصم</span><span>-{fmtMoney(invoice.discountAmount)}</span></div>
          )}
          {Number(invoice.vatAmount) > 0 && (
            <div className="flex justify-between"><span>ضريبة القيمة المضافة ({Number(invoice.vatPercent)}%)</span><span>{fmtMoney(invoice.vatAmount)}</span></div>
          )}
          <div className="flex justify-between border-t border-dashed pt-1 font-bold">
            <span>الإجمالي</span><span className="whitespace-nowrap">{fmtMoney(invoice.total)} ج.م</span>
          </div>
          {Number(invoice.total) > Number(invoice.payments?.[0]?.amount) && (
            <div className="flex justify-between text-slate-500">
              <span>المتبقي مستحق</span><span className="whitespace-nowrap">{fmtMoney(Number(invoice.total) - Number(invoice.payments?.[0]?.amount))}</span>
            </div>
          )}
        </div>
        <div className="mt-3 border-t border-dashed pt-2 text-center text-xs text-slate-500">
          {invoice.customerName && <div className="mb-1">العميل: {invoice.customerName}</div>}
          الكاشير: {invoice.cashierName ?? employee?.fullName}
        </div>
      </div>
      <div className="mt-4 flex gap-2">
        <Button
          variant="outline"
          className="flex-1"
          disabled={sendingWhatsApp}
          onClick={sendPdfToWhatsApp}
          title="تنزيل الفاتورة PDF وفتح محادثة العميل على واتساب ويب"
        >
          <MessageCircle className="h-4 w-4" /> {sendingWhatsApp ? 'جاري التجهيز...' : 'واتساب'}
        </Button>
        <Button variant="outline" className="flex-1" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> طباعة
        </Button>
        <Button variant="brand" className="flex-1" onClick={onClose}>
          <X className="h-4 w-4" /> إغلاق
        </Button>
      </div>
    </Dialog>
  );
}

const OP_LABELS: Record<string, string> = {
  'invoice.create': 'فاتورة بيع',
  'invoice.return': 'إرجاع فاتورة',
  'reservation.create': 'حجز بعربون',
};

function PendingOpsDialog({
  pending,
  failures,
  onClose,
  onRemovePending,
  onRemoveFailure,
  onRetry,
  onSync,
}: {
  pending: { id: string; op: string; createdAt: string }[];
  failures: { id: string; op: string; createdAt: string; error: string; status: string }[];
  onClose: () => void;
  onRemovePending: (id: string) => void;
  onRemoveFailure: (id: string) => void;
  onRetry: (id: string) => void;
  onSync: () => void;
}) {
  return (
    <Dialog open onClose={onClose} title="العمليات المحلية" className="max-w-lg">
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-slate-700">
            العمليات في انتظار المزامنة ({pending.length})
          </span>
          <Button size="sm" variant="outline" onClick={onSync} disabled={!navigator.onLine}>
            <CloudUpload className="h-4 w-4" /> مزامنة الآن
          </Button>
        </div>
        {pending.length === 0 ? (
          <div className="rounded-lg bg-slate-50 py-6 text-center text-sm text-slate-400">
            لا توجد عمليات معلقة
          </div>
        ) : (
          <ul className="space-y-2">
            {pending.map((p) => (
              <li key={p.id} className="flex items-center gap-3 rounded-lg border border-slate-200 p-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-900">{OP_LABELS[p.op] ?? p.op}</div>
                  <div className="text-xs text-slate-400">{fmtDateTime(p.createdAt)}</div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => onRemovePending(p.id)} title="حذف العملية">
                  <Trash2 className="h-4 w-4 text-rose-500" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        {failures.length > 0 && (
          <>
            <div className="text-sm font-bold text-rose-700">عمليات فشلت عند المزامنة ({failures.length})</div>
            <ul className="space-y-2">
              {failures.map((f) => (
                <li key={f.id} className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-bold text-slate-900">{OP_LABELS[f.op] ?? f.op}</div>
                      <div className="mt-0.5 text-xs text-rose-700" dir="ltr">{f.error}</div>
                      <div className="text-xs text-slate-400">{fmtDateTime(f.createdAt)}</div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => onRetry(f.id)} title="إعادة المحاولة">
                      <RotateCcw className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => onRemoveFailure(f.id)} title="حذف">
                      <Trash2 className="h-4 w-4 text-rose-500" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Dialog>
  );
}

function ProductThumb({ src, alt, className }: { src?: string | null; alt?: string; className?: string }) {
  const [err, setErr] = useState(false);
  if (!src || err) {
    return (
      <div className={`flex shrink-0 items-center justify-center bg-gradient-to-br from-brand-50 to-amber-50 text-brand-300 ${className}`}>
        <Gem className="h-1/3 w-1/3" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt ?? ''}
      onError={() => setErr(true)}
      loading="lazy"
      className={`shrink-0 object-cover ${className}`}
    />
  );
}
