import { useState, useEffect } from 'react';
import { Plus, History, Pencil, Camera, Tags, Archive, RotateCcw, Trash2, Info, Gem, HandCoins, Image } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useCategories, useItems, useLocations, useItemAudit } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fmtMoney, fmtNum, metalColor, metalLabel, STATUS_BADGE, STATUS_LABELS, cn,
} from '@/lib/utils';
import type { Category, Item } from '@/lib/types';
import { can } from '@/stores/auth';

const EMPTY: Record<string, any> = {
  code: '', barcode: '', name: '', description: '', productKind: 'jewelry',
  metalType: 'gold', carat: '', salePrice: '',
  weightG: '', stoneWeightG: '0', craftsmanshipType: 'fixed', craftsmanshipValue: '0',
  cost: '', metalPriceAtAdd: '', sourceSupplier: '', physicalStatus: 'new',
  manufacturingVarianceG: '0', notes: '', categoryId: undefined, currentLocationId: undefined, size: '',
  quantity: '1', minQty: '0', maxQty: '',
};

export default function Items() {
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [auditItem, setAuditItem] = useState<Item | null>(null);
  const [statusItem, setStatusItem] = useState<Item | null>(null);
  const [statusValue, setStatusValue] = useState('reserved');
  const [deleteItem, setDeleteItem] = useState<Item | null>(null);
  const [catsOpen, setCatsOpen] = useState(false);
  const qc = useQueryClient();

  const { data: items, isLoading } = useItems(filters);
  const { data: locations } = useLocations();
  const { data: categories } = useCategories();

  const pag = usePagination(items, 10, JSON.stringify(filters));

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['items'] });
    qc.invalidateQueries({ queryKey: ['report-inventory-value'] });
  };

  const saveMutation = useMutation({
    mutationFn: async (body: any) => {
      const url = editing ? `/api/items/${editing.id}` : '/api/items';
      return api(url, { method: editing ? 'PUT' : 'POST', body });
    },
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث القطعة' : 'تمت إضافة القطعة');
      setFormOpen(false);
      setEditing(null);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + (e.message || '')),
  });

  const statusMutation = useMutation({
    mutationFn: (body: any) => api(`/api/items/${statusItem!.id}/status`, { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم تغيير الحالة');
      setStatusItem(null);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const archiveMutation = useMutation({
    mutationFn: ({ id, active }: any) => api(`/api/items/${id}/archive`, { method: 'POST', body: { active } }),
    onSuccess: () => {
      toast.success('تم تحديث القطعة');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api(`/api/items/${deleteItem!.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('تم حذف القطعة');
      setDeleteItem(null);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="المخزون / القطع"
        description="كل سبيكة ومشغولة لها سجل مستقل وتتبع كامل"
        actions={
          can('inventory.manage') ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => setCatsOpen(true)}>
                <Tags className="h-4 w-4" /> الفئات
              </Button>
              <Button variant="brand" onClick={() => { setEditing(null); setFormOpen(true); }}>
                <Plus className="h-4 w-4" /> إضافة قطعة
              </Button>
            </div>
          ) : undefined
        }
      />

      <Card className="mb-5">
        <CardContent className="flex flex-wrap items-end gap-3 p-4">
          <div className="min-w-44 flex-1">
            <Label>بحث (كود / باركود / اسم)</Label>
            <Input
              placeholder="اكتب للبحث…"
              onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value || '' }))}
            />
          </div>
          <div className="w-40">
            <Label>الفرع</Label>
            <Select
              value={filters.locationId ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, locationId: e.target.value }))}
            >
              <option value="">الكل</option>
              {(locations ?? []).map((l) => (
                <option key={l.id} value={l.id}>{l.nameAr}</option>
              ))}
            </Select>
          </div>
          <div className="w-44">
            <Label>الفئة</Label>
            <Select
              value={filters.categoryId ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, categoryId: e.target.value }))}
            >
              <option value="">الكل</option>
              {(categories ?? []).map((c) => (
                <option key={c.id} value={c.id}>{c.nameAr}</option>
              ))}
            </Select>
          </div>
          <div className="w-40">
            <Label>المعدن</Label>
            <Select
              value={filters.metalType ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, metalType: e.target.value }))}
            >
              <option value="">الكل</option>
              <option value="gold">ذهب</option>
              <option value="silver">فضة</option>
            </Select>
          </div>
          <div className="w-40">
            <Label>الحالة</Label>
            <Select
              value={filters.status ?? ''}
              onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
            >
              <option value="">الكل</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          <div className="flex h-10 items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={filters.needsReview === 'true'}
              onChange={(e) => setFilters((f) => ({ ...f, needsReview: e.target.checked ? 'true' : '' }))}
            />
            <label>تحتاج مراجعة</label>
          </div>
          <div className="flex h-10 items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              className="h-4 w-4 accent-brand-600"
              checked={filters.includeInactive === 'true'}
              onChange={(e) => setFilters((f) => ({ ...f, includeInactive: e.target.checked ? 'true' : '' }))}
            />
            <label>إظهار المؤرشفة</label>
          </div>
          <Button variant="outline" onClick={() => setFilters({})}>مسح الفلاتر</Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الكود</TableHead>
                <TableHead>الوصف</TableHead>
                <TableHead>المعدن / العيار</TableHead>
                <TableHead>الكمية</TableHead>
                <TableHead>الوزن</TableHead>
                <TableHead>المصنعية</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-400">جارٍ التحميل…</TableCell></TableRow>
              )}
              {pag.slice.map((it) => (
                <TableRow key={it.id}>
                  <TableCell>
                    <div className="font-mono text-xs font-bold">{it.code}</div>
                    {it.barcode && <div className="text-xs text-slate-400">باركود: {it.barcode}</div>}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium text-slate-800">{it.name || '—'}</div>
                    <div className="text-xs text-slate-400">{it.categoryName}</div>
                  </TableCell>
                  <TableCell>
                    {it.productKind === 'general' ? (
                      <Badge tone="bg-slate-100 text-slate-700">منتج عام</Badge>
                    ) : (
                      <>
                        <Badge tone={metalColor(it.metalType || '')}>{metalLabel(it.metalType || '')}</Badge>
                        {it.carat && <span className="mr-2 text-xs text-slate-500">عيار {it.carat}</span>}
                      </>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="font-bold">{it.quantity ?? 1}</div>
                    <div className="text-xs text-slate-500">
                      متاح {it.availableQty ?? 0}
                      {!!it.reservedQty && <span className="text-violet-600"> · محجوز {it.reservedQty}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{it.weightG != null ? `${fmtNum(it.weightG)} جم` : '—'}</TableCell>
                  <TableCell className="text-xs text-slate-600">
                    {it.productKind === 'general'
                      ? (it.salePrice != null ? `سعر ثابت: ${fmtMoney(it.salePrice)}` : '—')
                      : it.craftsmanshipType === 'percent'
                        ? `${it.craftsmanshipValue}%`
                        : fmtMoney(it.craftsmanshipValue)}
                  </TableCell>
                  <TableCell><Badge tone={STATUS_BADGE[it.status]}>{STATUS_LABELS[it.status]}</Badge>
                    {it.needsReview && (
                      <div className="mt-1">
                        <Badge tone="bg-rose-100 text-rose-700">تحتاج مراجعة الوزن</Badge>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="text-xs">{it.locationName}</TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => { setAuditItem(it); }}>
                        <History className="h-3.5 w-3.5" /> سجل
                      </Button>
                      {can('inventory.manage') && (
                        <>
                          <Button variant="ghost" size="sm" onClick={() => { setEditing(it); setFormOpen(true); }}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => { setStatusItem(it); setStatusValue('reserved'); }}
                          >
                            حالة
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title={it.isActive ? 'أرشفة' : 'استرجاع'}
                            onClick={() => archiveMutation.mutate({ id: it.id, active: !it.isActive })}
                          >
                            {it.isActive ? <Archive className="h-3.5 w-3.5" /> : <RotateCcw className="h-3.5 w-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            title="حذف نهائي"
                            onClick={() => setDeleteItem(it)}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                          </Button>
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(items ?? []).length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-slate-400">لا توجد قطع مطابقة</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <ItemForm
        open={formOpen}
        editing={editing}
        onClose={() => { setFormOpen(false); setEditing(null); }}
        onSubmit={(body: any) => saveMutation.mutate(body)}
        locations={locations ?? []}
        categories={categories ?? []}
      />

      {auditItem && <AuditDialog item={auditItem} onClose={() => setAuditItem(null)} />}

      <CategoriesDialog open={catsOpen} onClose={() => setCatsOpen(false)} />

      <Dialog
        open={!!statusItem}
        onClose={() => setStatusItem(null)}
        title={`تغيير حالة: ${statusItem?.code}`}
        description="سيُسجَّل التغيير في سجل القطعة مع السبب"
      >
        <div className="space-y-3">
          <div>
            <Label>الحالة الجديدة</Label>
            <Select value={statusValue} onChange={(e) => setStatusValue(e.target.value)}>
              {Object.entries(STATUS_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setStatusItem(null)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={statusMutation.isPending}
            onClick={() => statusMutation.mutate({ status: statusValue })}
          >
            تأكيد
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={!!deleteItem}
        onClose={() => setDeleteItem(null)}
        title="حذف القطعة نهائياً"
        description="لا يمكن التراجع — القطع المرتبطة بفواتير أو حجوزات أو حركات لن تُحذف"
      >
        <p className="text-sm leading-relaxed text-slate-600">
          حذف «{deleteItem?.name || deleteItem?.code}» ({deleteItem?.code}) نهائياً من النظام؟
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteItem(null)}>إلغاء</Button>
          <Button
            variant="destructive"
            loading={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className="h-4 w-4" /> حذف نهائي
          </Button>
        </div>
      </Dialog>
    </div>
  );
}

function ItemForm({ open, editing, onClose, onSubmit, locations, categories }: any) {
  const [form, setForm] = useState<any>(EMPTY);
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const qc = useQueryClient();

  useEffect(() => {
    if (open) {
      setForm(editing ? { ...EMPTY, ...editing, quantity: editing.quantity ?? 1 } : { ...EMPTY });
      setPhotoFile(null);
    }
  }, [open, editing]);

  const set = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

  const photoMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      return api<{ photoUrl: string }>(`/api/items/${editing.id}/photo`, { method: 'POST', body: fd });
    },
    onSuccess: (res) => {
      setForm((f: any) => ({ ...f, photoUrl: res.photoUrl }));
      qc.invalidateQueries({ queryKey: ['items'] });
    },
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={editing ? 'تعديل قطعة' : 'إضافة قطعة'}
      description="كل البيانات تُسجَّل وتُربط بالمعرّفات الثابتة"
      className="max-w-3xl"
    >
      <Tabs defaultValue="basic">
        <TabsList>
          <TabsTrigger value="basic"><Info className="h-4 w-4" /> الأساسية</TabsTrigger>
          <TabsTrigger value="metal"><Gem className="h-4 w-4" /> المعدن والوزن</TabsTrigger>
          <TabsTrigger value="price"><HandCoins className="h-4 w-4" /> المصنعية والسعر</TabsTrigger>
          <TabsTrigger value="notes"><Image className="h-4 w-4" /> ملاحظات وصورة</TabsTrigger>
        </TabsList>

        <TabsContent value="basic">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="كود القطعة *">
              <Input value={form.code} onChange={(e) => set('code', e.target.value)} placeholder="BAR-21-001" dir="ltr" />
            </Field>
            <Field label="الباركود">
              <Input value={form.barcode} onChange={(e) => set('barcode', e.target.value)} dir="ltr" />
            </Field>
            <Field label="الاسم / الوصف">
              <Input value={form.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
            <Field label="الفئة">
              <Select value={form.categoryId ?? ''} onChange={(e) => set('categoryId', Number(e.target.value))}>
                <option value="">—</option>
                {categories.map((c: any) => <option key={c.id} value={c.id}>{c.nameAr}</option>)}
              </Select>
            </Field>
            <Field label="نوع المنتج">
              <Select value={form.productKind} onChange={(e) => set('productKind', e.target.value)}>
                <option value="jewelry">مجوهرات (تُسعّر بالوزن والعيار)</option>
                <option value="general">منتج عام (ساعة، هدية… بسعر ثابت)</option>
              </Select>
            </Field>
            <Field label="المقاس / الحجم">
              <Input value={form.size} onChange={(e) => set('size', e.target.value)} />
            </Field>
            <Field label="الفرع">
              <Select value={form.currentLocationId ?? ''} onChange={(e) => set('currentLocationId', Number(e.target.value) || null)}>
                <option value="">—</option>
                {locations.map((l: any) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
              </Select>
            </Field>
            <Field label="الكمية">
              <Input type="number" min={1} value={form.quantity} onChange={(e) => set('quantity', e.target.value)} />
            </Field>
            <Field label="حد أدنى للطلب (قطعة)">
              <Input type="number" min={0} value={form.minQty} onChange={(e) => set('minQty', e.target.value)} />
            </Field>
            <Field label="حد أقصى للطلب (قطعة)">
              <Input type="number" min={0} value={form.maxQty} onChange={(e) => set('maxQty', e.target.value)} />
            </Field>
          </div>
        </TabsContent>

        <TabsContent value="metal">
          {form.productKind === 'general' ? (
            <div className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">
              المنتجات العامة (ساعات، هدايا…) تُباع بسعر ثابت — لا تحتاج معدن أو وزن.
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع المعدن *">
              <Select value={form.metalType} onChange={(e) => set('metalType', e.target.value)}>
                <option value="gold">ذهب</option>
                <option value="silver">فضة</option>
              </Select>
            </Field>
            <Field label="العيار">
              <Input value={form.carat} onChange={(e) => set('carat', e.target.value)} placeholder="21 / 24 / 925" dir="ltr" />
            </Field>
            <Field label="الوزن بالجرام *">
              <Input type="number" step="0.001" value={form.weightG} onChange={(e) => set('weightG', e.target.value)} />
            </Field>
            <Field label="وزن الأحجار (جم)">
              <Input type="number" step="0.001" value={form.stoneWeightG} onChange={(e) => set('stoneWeightG', e.target.value)} />
            </Field>
            <Field label="فرق وزن التصنيع (جم)">
              <Input type="number" step="0.001" value={form.manufacturingVarianceG} onChange={(e) => set('manufacturingVarianceG', e.target.value)} />
            </Field>
            <Field label="الحالة الفيزيائية">
              <Select value={form.physicalStatus} onChange={(e) => set('physicalStatus', e.target.value)}>
                <option value="new">جديدة</option>
                <option value="used">مستعملة</option>
              </Select>
            </Field>
          </div>
          )}
        </TabsContent>

        <TabsContent value="price">
          {form.productKind === 'general' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="سعر البيع (ج.م) *">
                <Input type="number" value={form.salePrice} onChange={(e) => set('salePrice', e.target.value)} />
              </Field>
              <Field label="التكلفة / الشراء">
                <Input type="number" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
              </Field>
              <Field label="المصدر / المورد" className="sm:col-span-2">
                <Input value={form.sourceSupplier} onChange={(e) => set('sourceSupplier', e.target.value)} />
              </Field>
            </div>
          ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="نوع المصنعية">
              <Select value={form.craftsmanshipType} onChange={(e) => set('craftsmanshipType', e.target.value)}>
                <option value="fixed">ثابتة</option>
                <option value="percent">نسبة %</option>
              </Select>
            </Field>
            <Field label={form.craftsmanshipType === 'percent' ? 'المصنعية %' : 'المصنعية (ج.م)'}>
              <Input type="number" value={form.craftsmanshipValue} onChange={(e) => set('craftsmanshipValue', e.target.value)} />
            </Field>
            <Field label="التكلفة / التصنيع">
              <Input type="number" value={form.cost} onChange={(e) => set('cost', e.target.value)} />
            </Field>
            <Field label="سعر المعدن عند الإضافة">
              <Input type="number" value={form.metalPriceAtAdd} onChange={(e) => set('metalPriceAtAdd', e.target.value)} />
            </Field>
            <Field label="المصدر / المورد / الورشة" className="sm:col-span-2">
              <Input value={form.sourceSupplier} onChange={(e) => set('sourceSupplier', e.target.value)} />
            </Field>
          </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <div className="space-y-4">
            <div>
              <Label>ملاحظات (خدوش، عيوب…)</Label>
              <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} />
            </div>

            <div>
              <Label>صورة القطعة</Label>
              <div className="flex items-center gap-3">
                {(form.photoUrl || photoFile) && (
                  <img
                    src={photoFile ? URL.createObjectURL(photoFile) : form.photoUrl}
                    alt=""
                    className="h-20 w-20 rounded-lg border border-slate-200 object-cover"
                  />
                )}
                <div className="flex items-center gap-2">
                  <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 text-sm hover:bg-slate-50">
                    <Camera className="h-4 w-4" /> اختيار صورة
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        setPhotoFile(f);
                        if (editing?.id) {
                          setPhotoUploading(true);
                          photoMutation.mutate(f, { onSettled: () => setPhotoUploading(false) });
                        }
                      }}
                    />
                  </label>
                  {photoUploading && <span className="text-xs text-slate-500">جارٍ الرفع…</span>}
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      <div className="mt-6 flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>إلغاء</Button>
        <Button
          variant="brand"
          loading={false}
          onClick={() => {
            const isGeneral = form.productKind === 'general';
            if (!form.code?.trim()) { toast.error('أدخل كود القطعة'); return; }
            if (isGeneral && !(Number(form.salePrice) > 0)) { toast.error('أدخل سعر البيع للمنتج العام'); return; }
            if (!isGeneral && !(Number(form.weightG) > 0)) { toast.error('أدخل وزن القطعة بالجرام'); return; }
            onSubmit({
              ...form,
              productKind: form.productKind,
              salePrice: isGeneral && Number(form.salePrice) > 0 ? Number(form.salePrice) : null,
              metalType: isGeneral ? null : form.metalType,
              carat: isGeneral ? null : form.carat,
              weightG: isGeneral ? null : Number(form.weightG),
              stoneWeightG: isGeneral ? 0 : Number(form.stoneWeightG ?? 0),
              manufacturingVarianceG: isGeneral ? 0 : Number(form.manufacturingVarianceG ?? 0),
              craftsmanshipType: isGeneral ? 'fixed' : form.craftsmanshipType,
              craftsmanshipValue: isGeneral ? 0 : Number(form.craftsmanshipValue ?? 0),
              quantity: Number(form.quantity) || 1,
              minQty: Math.max(0, Number(form.minQty) || 0),
              maxQty: form.maxQty === '' || form.maxQty == null ? null : Math.max(Number(form.maxQty) || 0, Number(form.minQty) || 0),
            });
          }}
        >
          حفظ
        </Button>
      </div>
    </Dialog>
  );
}

function Field({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function AuditDialog({ item, onClose }: { item: Item; onClose: () => void }) {
  const { data } = useItemAudit(item.id);
  return (
    <Dialog open onClose={onClose} title={`سجل القطعة: ${item.code}`} description="السيرة الذاتية الكاملة للقطعة" className="max-w-3xl">
      <div className="space-y-5">
        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">تغييرات الحالة</h4>
          <Table>
            <TableHeader><TableRow><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>السبب</TableHead><TableHead>بواسطة</TableHead><TableHead>الوقت</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.statuses ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400">لا يوجد</TableCell></TableRow>}
              {(data?.statuses ?? []).map((s: any) => (
                <TableRow key={s.id}>
                  <TableCell className="text-xs">{s.fromStatus ? STATUS_LABELS[s.fromStatus] : '—'}</TableCell>
                  <TableCell className="text-xs">{STATUS_LABELS[s.toStatus]}</TableCell>
                  <TableCell className="whitespace-normal text-xs">{s.reason}</TableCell>
                  <TableCell className="text-xs">{s.changedByName}</TableCell>
                  <TableCell className="text-xs">{new Date(s.changedAt).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">حركات النقل</h4>
          <Table>
            <TableHeader><TableRow><TableHead>من</TableHead><TableHead>إلى</TableHead><TableHead>الناقل</TableHead><TableHead>المستلم</TableHead><TableHead>الوقت</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.movements ?? []).length === 0 && <TableRow><TableCell colSpan={5} className="text-center text-slate-400">لا يوجد</TableCell></TableRow>}
              {(data?.movements ?? []).map((m: any) => (
                <TableRow key={m.id}>
                  <TableCell className="text-xs">{m.fromLocation}</TableCell>
                  <TableCell className="text-xs">{m.toLocation}</TableCell>
                  <TableCell className="text-xs">{m.movedByName}</TableCell>
                  <TableCell className="text-xs">{m.receivedByName ?? '—'}</TableCell>
                  <TableCell className="text-xs">{new Date(m.movedAt).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">المبيعات</h4>
          <Table>
            <TableHeader><TableRow><TableHead>الفاتورة</TableHead><TableHead>سعر البيع</TableHead><TableHead>الكاشير</TableHead><TableHead>الوقت</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.sales ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400">لم تُبَع بعد</TableCell></TableRow>}
              {(data?.sales ?? []).map((s: any) => (
                <TableRow key={s.invoiceId}>
                  <TableCell className="text-xs font-mono">{s.invoiceNo}</TableCell>
                  <TableCell className="text-xs">{fmtMoney(s.lineTotal)}</TableCell>
                  <TableCell className="text-xs">{s.cashierName}</TableCell>
                  <TableCell className="text-xs">{new Date(s.createdAt).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="mb-2 text-sm font-bold text-slate-700">الحجوزات</h4>
          <Table>
            <TableHeader><TableRow><TableHead>العميل</TableHead><TableHead>العربون</TableHead><TableHead>الحالة</TableHead><TableHead>الوقت</TableHead></TableRow></TableHeader>
            <TableBody>
              {(data?.reservations ?? []).length === 0 && <TableRow><TableCell colSpan={4} className="text-center text-slate-400">لا يوجد</TableCell></TableRow>}
              {(data?.reservations ?? []).map((r: any) => (
                <TableRow key={r.id}>
                  <TableCell className="text-xs">{r.customerName}</TableCell>
                  <TableCell className="text-xs">{fmtMoney(r.downPayment)}</TableCell>
                  <TableCell className="text-xs">
                    <Badge tone={STATUS_BADGE[r.status]}>{r.status === 'active' ? 'نشط' : r.status === 'completed' ? 'مكتمل' : 'ملغي'}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{new Date(r.reservedAt).toLocaleString('ar-EG-u-nu-latn')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </Dialog>
  );
}

function CategoriesDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data: categories } = useCategories();
  const qc = useQueryClient();
  const [form, setForm] = useState({ code: '', nameAr: '', nameEn: '' });
  const [editId, setEditId] = useState<number | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['categories'] });

  const save = useMutation({
    mutationFn: async () => {
      const url = editId ? `/api/categories/${editId}` : '/api/categories';
      const body = editId
        ? { nameAr: form.nameAr, nameEn: form.nameEn || null }
        : { code: form.code, nameAr: form.nameAr, nameEn: form.nameEn || null };
      return api(url, { method: editId ? 'PUT' : 'POST', body });
    },
    onSuccess: () => {
      toast.success(editId ? 'تم تحديث الفئة' : 'تمت إضافة الفئة');
      setForm({ code: '', nameAr: '', nameEn: '' });
      setEditId(null);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + (e.message || '')),
  });

  const toggle = useMutation({
    mutationFn: (c: Category) =>
      api(`/api/categories/${c.id}`, { method: 'PUT', body: { isActive: !c.isActive } }),
    onSuccess: () => {
      toast.success('تم تحديث الفئة');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + (e.message || '')),
  });

  const deleteCat = useMutation({
    mutationFn: (c: Category) => api(`/api/categories/${c.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('تم حذف الفئة');
      invalidate();
    },
    onError: (e: any) => toast.error(e.message || 'خطأ في الحذف'),
  });

  const onDelete = async (c: Category) => {
    const ok = await confirmDialog(`حذف فئة «${c.nameAr}» نهائياً؟`);
    if (ok) deleteCat.mutate(c);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="الفئات"
      description="أضف أو عدّل فئات القطع (سبيكة، خاتم، سلسلة …)"
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-slate-200 p-3">
          <div className="mb-2 text-sm font-bold text-slate-700">
            {editId ? `تعديل فئة (${editId})` : 'فئة جديدة'}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {!editId && (
              <div>
                <Label>الكود</Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm({ ...form, code: e.target.value })}
                  placeholder="مثال: WATCH"
                  dir="ltr"
                />
              </div>
            )}
            <div>
              <Label>الاسم بالعربية</Label>
              <Input
                value={form.nameAr}
                onChange={(e) => setForm({ ...form, nameAr: e.target.value })}
                placeholder="مثال: ساعة"
              />
            </div>
            <div>
              <Label>الاسم بالإنجليزية (اختياري)</Label>
              <Input
                value={form.nameEn}
                onChange={(e) => setForm({ ...form, nameEn: e.target.value })}
                placeholder="Watch"
                dir="ltr"
              />
            </div>
          </div>
          <div className="mt-2 flex justify-end gap-2">
            {editId != null && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setEditId(null); setForm({ code: '', nameAr: '', nameEn: '' }); }}
              >
                إلغاء التعديل
              </Button>
            )}
            <Button
              variant="brand"
              size="sm"
              disabled={
                !form.nameAr.trim() ||
                (editId == null && !form.code.trim()) ||
                save.isPending
              }
              onClick={() => save.mutate()}
            >
              {editId != null ? 'حفظ' : 'إضافة'}
            </Button>
          </div>
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto">
          {(categories ?? []).map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between rounded-lg border border-slate-100 px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-400">{c.code}</span>
                <span className={cn('text-sm font-bold', c.isActive ? 'text-slate-800' : 'text-slate-400 line-through')}>
                  {c.nameAr}
                </span>
                <span className="text-[11px] text-slate-400">({c.itemCount ?? 0})</span>
              </div>
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setEditId(c.id);
                    setForm({ code: c.code, nameAr: c.nameAr, nameEn: c.nameEn ?? '' });
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => toggle.mutate(c)} disabled={toggle.isPending}>
                  {c.isActive ? 'تعطيل' : 'تفعيل'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  title={c.itemCount ? `لا يمكن الحذف — عليها ${c.itemCount} قطعة` : 'حذف الفئة'}
                  disabled={!!c.itemCount || deleteCat.isPending}
                  onClick={() => onDelete(c)}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
            </div>
          ))}
          {(categories ?? []).length === 0 && (
            <div className="py-6 text-center text-sm text-slate-400">لا توجد فئات بعد</div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
