import { useState } from 'react';
import { Plus, MapPin, Trash2, Gauge, Pencil } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useLocations } from '@/hooks/useData';
import { api } from '@/lib/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { can } from '@/stores/auth';

export default function Locations() {
  const { data: locations } = useLocations();
  const qc = useQueryClient();

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ code: '', nameAr: '', nameEn: '' });
  const [editForm, setEditForm] = useState({ code: '', nameAr: '', nameEn: '', isActive: true });
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deleteLoc, setDeleteLoc] = useState<any>(null);
  const [moveToId, setMoveToId] = useState('');
  const [limitOpen, setLimitOpen] = useState(false);
  const [limitForm, setLimitForm] = useState({ locationId: '', metalType: 'gold', carat: '', minQty: '0', maxQty: '' });

  const { data: limits } = useQuery({
    queryKey: ['stock-limits'],
    queryFn: () => api<any[]>('/api/stock-limits'),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ['locations'] });

  const addLocation = useMutation({
    mutationFn: (body: any) => api('/api/locations', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تمت إضافة الفرع');
      setOpen(false);
      setForm({ code: '', nameAr: '', nameEn: '' });
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const startEdit = (l: any) => {
    setEditForm({ code: l.code, nameAr: l.nameAr, nameEn: l.nameEn ?? '', isActive: !!l.isActive });
    setEditingId(l.id);
  };

  const saveEdit = useMutation({
    mutationFn: (body: any) => api(`/api/locations/${editingId}`, { method: 'PUT', body }),
    onSuccess: () => {
      toast.success('تم حفظ الفرع');
      setEditingId(null);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const deleteLocation = useMutation({
    mutationFn: (body: any) => api(`/api/locations/${deleteLoc.id}`, { method: 'DELETE', body }),
    onSuccess: (d: any) => {
      toast.success(d.movedItems > 0 ? `تم حذف الفرع ونقل ${d.movedItems} قطعة` : 'تم حذف الفرع');
      setDeleteLoc(null);
      setMoveToId('');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const startDelete = (l: any) => {
    setDeleteLoc(l);
    const first = (locations ?? []).find((x) => x.id !== l.id && x.isActive);
    setMoveToId(first ? String(first.id) : '');
  };

  const saveLimit = useMutation({
    mutationFn: (body: any) => api('/api/stock-limits', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم حفظ الحدود');
      setLimitOpen(false);
      qc.invalidateQueries({ queryKey: ['stock-limits'] });
      qc.invalidateQueries({ queryKey: ['report-stock-limits'] });
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const deleteLimit = useMutation({
    mutationFn: (id: number) => api(`/api/stock-limits/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      toast.success('تم حذف الحد');
      qc.invalidateQueries({ queryKey: ['stock-limits'] });
    },
  });

  if (!can('locations.manage')) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-lg bg-slate-100 p-8 text-center text-slate-500">
          ليس لديك صلاحية لإدارة الفروع والمواقع
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الفروع والمواقع"
        description="كل مكان له هوية مستقلة — المخزون والنقل تتم عبر المعرّفات"
        actions={
          can('locations.manage') ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <Plus className="h-4 w-4" /> إضافة فرع
            </Button>
          ) : undefined
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {(locations ?? []).map((l) => (
          <Card key={l.id}>
            <CardContent className="p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50">
                  <MapPin className="h-5 w-5 text-brand-600" />
                </div>
                <div className="flex-1">
                  <div className="font-bold text-slate-900">{l.nameAr}</div>
                  <div className="text-xs text-slate-400">{l.code}</div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={l.isActive ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>
                    {l.isActive ? 'نشط' : 'موقوف'}
                  </Badge>
                  {can('locations.manage') && (
                    <>
                      <button
                        onClick={() => startEdit(l)}
                        className="rounded-md border border-slate-200 p-1.5 text-slate-500 transition-colors hover:border-brand-400 hover:text-brand-600"
                        title="تعديل الفرع"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => startDelete(l)}
                        className="rounded-md border border-slate-200 p-1.5 text-slate-500 transition-colors hover:border-rose-400 hover:text-rose-600"
                        title="حذف الفرع"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Gauge className="h-5 w-5 text-brand-600" /> حدود المخزون (Min/Max)
          </CardTitle>
          <Button variant="outline" size="sm" onClick={() => setLimitOpen(true)}>
            <Plus className="h-4 w-4" /> إضافة حد
          </Button>
        </CardHeader>
        <CardContent className="p-0">
          <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
            {(limits ?? []).map((lim) => (
              <div key={lim.id} className="flex items-center justify-between rounded-lg border border-slate-200 p-3">
                <div>
                  <div className="text-sm font-bold text-slate-900">
                    {(locations ?? []).find((l) => l.id === lim.locationId)?.nameAr ?? `#${lim.locationId}`}
                  </div>
                  <div className="text-xs text-slate-500">
                    {lim.metalType === 'gold' ? 'ذهب' : 'فضة'} {lim.carat ? `— عيار ${lim.carat}` : ''}
                  </div>
                  <div className="text-xs text-slate-400">الحد: {lim.minQty} — {lim.maxQty ?? '∞'}</div>
                </div>
                <button
                  onClick={() => deleteLimit.mutate(lim.id)}
                  className="text-slate-400 hover:text-rose-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {(limits ?? []).length === 0 && (
              <div className="text-sm text-slate-400">لا توجد حدود محددة بعد.</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="إضافة فرع جديد">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>الكود *</Label>
            <Input value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>الاسم بالعربية *</Label>
            <Input value={form.nameAr} onChange={(e) => setForm({ ...form, nameAr: e.target.value })} />
          </div>
          <div>
            <Label>الاسم بالإنجليزية</Label>
            <Input value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} dir="ltr" />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button variant="brand" disabled={!form.code || !form.nameAr} onClick={() => addLocation.mutate(form)}>
            حفظ
          </Button>
        </div>
      </Dialog>

      <Dialog open={deleteLoc != null} onClose={() => setDeleteLoc(null)} title="حذف الفرع">
        <p className="text-sm leading-relaxed text-slate-600">
          حذف فرع «{deleteLoc?.nameAr}»؟ ستنتقل منتجات الفرع إلى الفرع الذي تختاره.
        </p>
        <div className="mt-4">
          <Label>نقل المنتجات إلى</Label>
          <Select value={moveToId} onChange={(e) => setMoveToId(e.target.value)}>
            <option value="">— اختر —</option>
            {(locations ?? [])
              .filter((l) => l.id !== deleteLoc?.id && l.isActive)
              .map((l) => (
                <option key={l.id} value={l.id}>{l.nameAr}</option>
              ))}
          </Select>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setDeleteLoc(null)}>إلغاء</Button>
          <Button
            variant="destructive"
            disabled={!moveToId}
            loading={deleteLocation.isPending}
            onClick={() => deleteLocation.mutate({ moveToLocationId: Number(moveToId) })}
          >
            <Trash2 className="h-4 w-4" /> حذف الفرع
          </Button>
        </div>
      </Dialog>

      <Dialog open={editingId != null} onClose={() => setEditingId(null)} title="تعديل الفرع">
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <Label>الكود *</Label>
            <Input value={editForm.code} onChange={(e) => setEditForm({ ...editForm, code: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>الاسم بالعربية *</Label>
            <Input value={editForm.nameAr} onChange={(e) => setEditForm({ ...editForm, nameAr: e.target.value })} />
          </div>
          <div>
            <Label>الاسم بالإنجليزية</Label>
            <Input value={editForm.nameEn} onChange={(e) => setEditForm({ ...editForm, nameEn: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>الحالة</Label>
            <Select
              value={String(editForm.isActive)}
              onChange={(e) => setEditForm({ ...editForm, isActive: e.target.value === 'true' })}
            >
              <option value="true">نشط</option>
              <option value="false">موقوف</option>
            </Select>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setEditingId(null)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!editForm.code || !editForm.nameAr}
            onClick={() =>
              saveEdit.mutate({ code: editForm.code, nameAr: editForm.nameAr, nameEn: editForm.nameEn, isActive: editForm.isActive })
            }
          >
            حفظ
          </Button>
        </div>
      </Dialog>

      <Dialog open={limitOpen} onClose={() => setLimitOpen(false)} title="إضافة حد مخزون">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>الفرع *</Label>
            <Select value={limitForm.locationId} onChange={(e) => setLimitForm({ ...limitForm, locationId: e.target.value })}>
              <option value="">اختر…</option>
              {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
            </Select>
          </div>
          <div>
            <Label>المعدن *</Label>
            <Select value={limitForm.metalType} onChange={(e) => setLimitForm({ ...limitForm, metalType: e.target.value })}>
              <option value="gold">ذهب</option>
              <option value="silver">فضة</option>
            </Select>
          </div>
          <div>
            <Label>العيار</Label>
            <Input value={limitForm.carat} onChange={(e) => setLimitForm({ ...limitForm, carat: e.target.value })} dir="ltr" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>الحد الأدنى</Label>
              <Input type="number" value={limitForm.minQty} onChange={(e) => setLimitForm({ ...limitForm, minQty: e.target.value })} />
            </div>
            <div>
              <Label>الحد الأقصى</Label>
              <Input type="number" value={limitForm.maxQty} onChange={(e) => setLimitForm({ ...limitForm, maxQty: e.target.value })} />
            </div>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setLimitOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!limitForm.locationId}
            onClick={() =>
              saveLimit.mutate({
                locationId: Number(limitForm.locationId),
                metalType: limitForm.metalType,
                carat: limitForm.carat || null,
                minQty: Number(limitForm.minQty),
                maxQty: limitForm.maxQty ? Number(limitForm.maxQty) : null,
              })
            }
          >
            حفظ
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
