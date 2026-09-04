import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Package, TrendingUp, Clock3, Gauge, AlertTriangle, Wallet, Landmark } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useLocations, usePaymentMethods } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { fmtDateTime, fmtMoney, fmtNum, metalColor, metalLabel } from '@/lib/utils';

const today = () => new Date().toISOString().slice(0, 10);
const monthAgo = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 10);
};

export default function Reports() {
  const [from, setFrom] = useState(monthAgo());
  const [to, setTo] = useState(today());
  const [method, setMethod] = useState('');
  const [locationId, setLocationId] = useState('');
  const { data: locations } = useLocations();
  const { data: payMethods } = usePaymentMethods();

  const inventory = useQuery({ queryKey: ['report-inventory-value'], queryFn: () => api<any>('/api/reports/inventory-value') });
  const profit = useQuery({ queryKey: ['report-profit', from, to], queryFn: () => api<any>(`/api/reports/profitability?from=${from}&to=${to}`) });
  const slow = useQuery({ queryKey: ['report-slow-stock'], queryFn: () => api<any>('/api/reports/slow-stock') });
  const limits = useQuery({ queryKey: ['report-stock-limits'], queryFn: () => api<any>('/api/reports/stock-limits') });
  const disc = useQuery({ queryKey: ['report-discrepancies'], queryFn: () => api<any>('/api/reports/discrepancies') });
  const reconc = useQuery({ queryKey: ['report-shift-reconciliation'], queryFn: () => api<any>('/api/reports/shift-reconciliation') });
  const payParams: Record<string, string> = { from, to };
  if (method) payParams.method = method;
  if (locationId) payParams.locationId = locationId;
  const payQ = new URLSearchParams(payParams).toString();
  const pays = useQuery({ queryKey: ['report-payments', payQ], queryFn: () => api<any>(`/api/reports/payments?${payQ}`) });

  const pagInventory = usePagination(inventory.data?.breakdown, 10);
  const pagProfit = usePagination(profit.data?.rows, 10, `${from}-${to}`);
  const pagSlow = usePagination(slow.data?.rows, 10);
  const pagLimits = usePagination(limits.data, 10);
  const pagDisc = usePagination(disc.data, 10);
  const pagReconc = usePagination(reconc.data, 10);
  const pagPays = usePagination(pays.data?.rows, 10, payQ);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader title="التقارير" description="قيمة المخزون، الربحية، الراكد، الحدود، الفروقات، وتسوية الشيفتات" />

      <Tabs defaultValue="inventory">
        <TabsList>
          <TabsTrigger value="inventory"><Package className="h-4 w-4" /> قيمة المخزون</TabsTrigger>
          <TabsTrigger value="profit"><TrendingUp className="h-4 w-4" /> الربحية</TabsTrigger>
          <TabsTrigger value="slow"><Clock3 className="h-4 w-4" /> الراكد</TabsTrigger>
          <TabsTrigger value="limits"><Gauge className="h-4 w-4" /> الحدود</TabsTrigger>
          <TabsTrigger value="disc"><AlertTriangle className="h-4 w-4" /> فروقات الجرد</TabsTrigger>
          <TabsTrigger value="reconc"><Wallet className="h-4 w-4" /> تسوية الشيفت</TabsTrigger>
          <TabsTrigger value="payments"><Landmark className="h-4 w-4" /> المدفوعات</TabsTrigger>
        </TabsList>

        <TabsContent value="inventory">
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(inventory.data?.byLocation ?? []).map((l: any) => (
              <Card key={l.locationId}>
                <CardContent className="p-4">
                  <div className="text-xs text-slate-500">{l.locationName}</div>
                  <div className="mt-1 text-xl font-extrabold text-brand-700">{fmtMoney(l.totalValue)}</div>
                  <div className="text-xs text-slate-400">{l.pieceCount} قطعة</div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card>
            <CardHeader><CardTitle className="text-base">التفصيل حسب المعدن والعيار</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الفرع</TableHead><TableHead>المعدن</TableHead><TableHead>العيار</TableHead><TableHead>العدد</TableHead><TableHead>القيمة</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagInventory.slice.map((b: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{b.locationName}</TableCell>
                      <TableCell><Badge tone={metalColor(b.metalType)}>{metalLabel(b.metalType)}</Badge></TableCell>
                      <TableCell>{b.carat || '—'}</TableCell>
                      <TableCell>{b.count}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(b.metalValue)}</TableCell>
                    </TableRow>
                  ))}
                  {(inventory.data?.breakdown ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-400">لا توجد بيانات</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagInventory} pageSize={pagInventory.pageSize} onPageSizeChange={pagInventory.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profit">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label>من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label>إلى</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </div>
            <div className="flex gap-3">
              <Card><CardContent className="p-4">
                <div className="text-xs text-slate-500">إجمالي الربح</div>
                <div className="text-xl font-extrabold text-emerald-700">{fmtMoney(profit.data?.summary?.totalProfit ?? 0)}</div>
              </CardContent></Card>
              <Card><CardContent className="p-4">
                <div className="text-xs text-slate-500">عدد الفواتير</div>
                <div className="text-xl font-extrabold text-slate-900">{profit.data?.summary?.invoiceCount ?? 0}</div>
              </CardContent></Card>
            </div>
          </div>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الفاتورة</TableHead><TableHead>القطعة</TableHead><TableHead>ربح المعدن</TableHead><TableHead>المصنعية</TableHead><TableHead>التكلفة</TableHead><TableHead>صافي الربح</TableHead><TableHead>التاريخ</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagProfit.slice.map((r: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell className="font-mono text-xs font-bold">{r.invoiceNo}</TableCell>
                      <TableCell>
                        <div className="font-mono text-xs">{r.itemCodeSnapshot}</div>
                        {r.itemNameSnapshot && <div className="text-xs text-slate-400">{r.itemNameSnapshot}</div>}
                      </TableCell>
                      <TableCell>{fmtMoney(r.metalProfit)}</TableCell>
                      <TableCell>{fmtMoney(r.craftsmanshipCharged)}</TableCell>
                      <TableCell>{fmtMoney(r.cost)}</TableCell>
                      <TableCell className={Number(r.profit) >= 0 ? 'font-bold text-emerald-700' : 'font-bold text-rose-600'}>
                        {fmtMoney(r.profit)}
                      </TableCell>
                      <TableCell className="text-xs">{fmtDateTime(r.createdAt)}</TableCell>
                    </TableRow>
                  ))}
                  {(profit.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">لا توجد مبيعات في هذه الفترة</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagProfit} pageSize={pagProfit.pageSize} onPageSizeChange={pagProfit.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="slow">
          <Card className="mb-4 bg-amber-50"><CardContent className="p-4 text-sm text-amber-800">
            القطع المتاحة أو المحجوزة التي مضى عليها أكثر من {slow.data?.days ?? 90} يومًا دون بيع.
          </CardContent></Card>
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>القطعة</TableHead><TableHead>الفرع</TableHead><TableHead>المعدن</TableHead><TableHead>الوزن</TableHead><TableHead>أيام في المخزون</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagSlow.slice.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <div className="font-mono text-xs font-bold">{r.code}</div>
                        {r.name && <div className="text-xs text-slate-400">{r.name}</div>}
                      </TableCell>
                      <TableCell className="text-xs">{r.locationName}</TableCell>
                      <TableCell><Badge tone={metalColor(r.metalType)}>{metalLabel(r.metalType)} {r.carat && `— ${r.carat}`}</Badge></TableCell>
                      <TableCell>{fmtNum(r.weightG)} جم</TableCell>
                      <TableCell>
                        <Badge tone="bg-amber-100 text-amber-800">{r.daysInStock} يوم</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  {(slow.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={5} className="py-8 text-center text-slate-400">لا توجد قطع راكدة</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagSlow} pageSize={pagSlow.pageSize} onPageSizeChange={pagSlow.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="limits">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الفرع</TableHead><TableHead>المعدن</TableHead><TableHead>العيار</TableHead><TableHead>الكمية الحالية</TableHead><TableHead>الحد الأدنى</TableHead><TableHead>الحد الأقصى</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagLimits.slice.map((r: any, i: number) => (
                    <TableRow key={i}>
                      <TableCell>{r.locationName}</TableCell>
                      <TableCell><Badge tone={metalColor(r.metalType)}>{metalLabel(r.metalType)}</Badge></TableCell>
                      <TableCell>{r.carat || '—'}</TableCell>
                      <TableCell className="font-bold">{r.currentQty}</TableCell>
                      <TableCell>{r.minQty}</TableCell>
                      <TableCell>{r.maxQty ?? '—'}</TableCell>
                      <TableCell>
                        {r.status === 'below' && <Badge tone="bg-rose-100 text-rose-800">أقل من الحد</Badge>}
                        {r.status === 'above' && <Badge tone="bg-amber-100 text-amber-800">أعلى من الحد</Badge>}
                        {r.status === 'ok' && <Badge tone="bg-emerald-100 text-emerald-800">طبيعي</Badge>}
                      </TableCell>
                    </TableRow>
                  ))}
                  {(limits.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={7} className="py-8 text-center text-slate-400">لا توجد بيانات</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagLimits} pageSize={pagLimits.pageSize} onPageSizeChange={pagLimits.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="disc">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الجرد</TableHead><TableHead>الفرع</TableHead><TableHead>التاريخ</TableHead><TableHead>ناقصة</TableHead><TableHead>زائدة</TableHead><TableHead>صافي القيمة</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagDisc.slice.map((r: any) => (
                    <TableRow key={r.stockCountId}>
                      <TableCell className="font-mono text-xs">#{r.stockCountId}</TableCell>
                      <TableCell>{r.locationName}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(r.startedAt)}</TableCell>
                      <TableCell className="text-rose-600">{r.missingCount}</TableCell>
                      <TableCell className="text-violet-600">{r.extraCount}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(r.netValue)}</TableCell>
                    </TableRow>
                  ))}
                  {(disc.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">لا توجد جردات مكتملة</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagDisc} pageSize={pagDisc.pageSize} onPageSizeChange={pagDisc.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="reconc">
          <Card>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الموظف</TableHead><TableHead>الفرع</TableHead><TableHead>المتوقع</TableHead><TableHead>الفعلي</TableHead><TableHead>الفرق</TableHead><TableHead>الإغلاق</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagReconc.slice.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell>{r.employeeName}</TableCell>
                      <TableCell className="text-xs">{r.locationName}</TableCell>
                      <TableCell>{fmtMoney(r.expectedCash)}</TableCell>
                      <TableCell>{fmtMoney(r.countedCash)}</TableCell>
                      <TableCell className={Number(r.difference) < 0 ? 'font-bold text-rose-600' : 'font-bold text-emerald-700'}>
                        {fmtMoney(r.difference)}
                      </TableCell>
                      <TableCell className="text-xs">{r.closedAt ? fmtDateTime(r.closedAt) : '—'}</TableCell>
                    </TableRow>
                  ))}
                  {(reconc.data ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={6} className="py-8 text-center text-slate-400">لا توجد تسويات بعد</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagReconc} pageSize={pagReconc.pageSize} onPageSizeChange={pagReconc.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="payments">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <Label>من</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label>إلى</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-44" />
            </div>
            <div>
              <Label>طريقة الدفع</Label>
              <Select value={method} onChange={(e) => setMethod(e.target.value)} className="w-48">
                <option value="">الكل</option>
                {(payMethods ?? []).map((m) => (
                  <option key={m.code} value={m.code}>{m.nameAr}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label>الفرع</Label>
              <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="w-44">
                <option value="">الكل</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.nameAr}</option>
                ))}
              </Select>
            </div>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card><CardContent className="p-4">
              <div className="text-xs text-slate-500">إجمالي المدفوعات</div>
              <div className="mt-1 text-xl font-extrabold text-brand-700">{fmtMoney(pays.data?.summary?.total ?? 0)} ج.م</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-slate-500">عدد الفواتير</div>
              <div className="mt-1 text-xl font-extrabold text-slate-900">{pays.data?.summary?.count ?? 0}</div>
            </CardContent></Card>
            <Card><CardContent className="p-4">
              <div className="text-xs text-slate-500">متوسط الفاتورة</div>
              <div className="mt-1 text-xl font-extrabold text-slate-900">{fmtMoney(pays.data?.summary?.avgInvoice ?? 0)} ج.م</div>
            </CardContent></Card>
          </div>

          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {(pays.data?.byMethod ?? []).map((m: any) => (
              <Card key={m.code} className={m.is_active ? '' : 'opacity-60'}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full" style={{ background: m.color }} />
                    <span className="text-sm font-bold text-slate-900">{m.nameAr}</span>
                    {!m.is_active && <span className="text-[10px] text-slate-400">(موقوفة)</span>}
                  </div>
                  <div className="mt-1 text-lg font-extrabold text-slate-900">{fmtMoney(m.total)} ج.م</div>
                  <div className="text-xs text-slate-400">{m.count} فاتورة</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle className="text-base">الفواتير حسب طريقة الدفع</CardTitle></CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader><TableRow><TableHead>الفاتورة</TableHead><TableHead>التاريخ</TableHead><TableHead>الفرع</TableHead><TableHead>الكاشير</TableHead><TableHead>الطريقة</TableHead><TableHead>المعدن</TableHead><TableHead>المصنعية</TableHead><TableHead>الخصم</TableHead><TableHead>الإجمالي</TableHead></TableRow></TableHeader>
                <TableBody>
                  {pagPays.slice.map((r: any) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-mono text-xs font-bold">{r.invoiceNo}</TableCell>
                      <TableCell className="text-xs">{fmtDateTime(r.createdAt)}</TableCell>
                      <TableCell className="text-xs">{r.locationName}</TableCell>
                      <TableCell className="text-xs">{r.cashierName}</TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-1.5 text-xs font-medium">
                          <span className="h-2.5 w-2.5 rounded-full" style={{ background: r.paymentMethodColor ?? '#64748b' }} />
                          {r.paymentMethodName ?? r.paymentMethod}
                        </span>
                      </TableCell>
                      <TableCell>{fmtMoney(r.metalSubtotal)}</TableCell>
                      <TableCell>{fmtMoney(r.craftsmanshipTotal)}</TableCell>
                      <TableCell className="text-rose-600">{r.discountAmount > 0 ? fmtMoney(r.discountAmount) : '—'}</TableCell>
                      <TableCell className="font-bold">{fmtMoney(r.total)}</TableCell>
                    </TableRow>
                  ))}
                  {(pays.data?.rows ?? []).length === 0 && (
                    <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">لا توجد فواتير في هذه الفترة</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
              <Pagination {...pagPays} pageSize={pagPays.pageSize} onPageSizeChange={pagPays.setPageSize} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
