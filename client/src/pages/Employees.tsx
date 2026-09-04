import { useState } from 'react';
import { Plus, Pencil, KeyRound } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useEmployees, useLocations } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime } from '@/lib/utils';
import { can } from '@/stores/auth';

const ROLE_LABELS: Record<string, string> = { manager: 'مدير', cashier: 'كاشير', social: 'سوشيال' };

const EMPTY = {
  employeeNo: '', fullName: '', phone: '', roleId: '', locationId: '',
  discountCapPercent: '0', username: '', pin: '', notes: '',
};

export default function Employees() {
  const { data: employees } = useEmployees();
  const { data: locations } = useLocations();
  const qc = useQueryClient();
  const pag = usePagination(employees, 10);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [form, setForm] = useState<any>(EMPTY);
  const [resetId, setResetId] = useState<number | null>(null);
  const [newPin, setNewPin] = useState('');
  const [roles, setRoles] = useState<any[]>([]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['employees'] });

  const openForm = (e: any) => {
    setEditing(e);
    setForm(
      e
        ? {
            ...e,
            roleId: String(e.roleId ?? ''), locationId: String(e.locationId ?? ''),
            discountCapPercent: String(e.discountCapPercent ?? 0),
          }
        : EMPTY,
    );
    setOpen(true);
  };

  const saveMutation = useMutation({
    mutationFn: (body: any) =>
      api(editing ? `/api/employees/${editing.id}` : '/api/employees', {
        method: editing ? 'PUT' : 'POST',
        body,
      }),
    onSuccess: () => {
      toast.success(editing ? 'تم تحديث الموظف' : 'تمت إضافة الموظف');
      setOpen(false);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const resetPin = useMutation({
    mutationFn: () => api(`/api/employees/${resetId}/reset-pin`, { method: 'POST', body: { pin: newPin } }),
    onSuccess: () => {
      toast.success('تم إعادة تعيين كود الدخول');
      setResetId(null);
      setNewPin('');
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="الموظفون والصلاحيات"
        description="الصلاحيات مرتبطة بالدور — عند مغادرة موظف تُوقف حالته ولا يُحذف سجله"
        actions={
          can('employees.manage') ? (
            <Button variant="brand" onClick={() => openForm(null)}>
              <Plus className="h-4 w-4" /> إضافة موظف
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>الموظف</TableHead>
                <TableHead>رقم الموظف</TableHead>
                <TableHead>الدور</TableHead>
                <TableHead>الفرع</TableHead>
                <TableHead>سقف الخصم</TableHead>
                <TableHead>آخر دخول</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pag.slice.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
                        {e.fullName.charAt(0)}
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">{e.fullName}</div>
                        <div className="text-xs text-slate-400" dir="ltr">{e.username}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-xs">{e.employeeNo}</TableCell>
                  <TableCell>
                    <Badge tone="bg-brand-100 text-brand-800">{ROLE_LABELS[e.roleCode] ?? e.role}</Badge>
                  </TableCell>
                  <TableCell className="text-xs">{e.locationName ?? '—'}</TableCell>
                  <TableCell className="text-xs">{e.discountCapPercent}%</TableCell>
                  <TableCell className="text-xs">{e.lastLoginAt ? fmtDateTime(e.lastLoginAt) : '—'}</TableCell>
                  <TableCell>
                    <Badge tone={e.status === 'active' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}>
                      {e.status === 'active' ? 'شغال' : 'متوقف'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openForm(e)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => setResetId(e.id)}>
                        <KeyRound className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title={editing ? 'تعديل موظف' : 'إضافة موظف'}>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>رقم الموظف *</Label>
            <Input value={form.employeeNo} onChange={(e) => setForm({ ...form, employeeNo: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>الاسم الكامل *</Label>
            <Input value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
          </div>
          <div>
            <Label>رقم الموبايل</Label>
            <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>اسم المستخدم *</Label>
            <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} dir="ltr" />
          </div>
          <div>
            <Label>الدور *</Label>
            <Select
              value={form.roleId}
              onChange={(e) => setForm({ ...form, roleId: e.target.value })}
              onFocus={() => {
                void api<any[]>('/api/employees/roles').then((r) => setRoles(r));
              }}
            >
              <option value="">اختر…</option>
              {(roles.length ? roles : [{ id: 1, nameAr: 'مدير المحل' }, { id: 2, nameAr: 'كاشير / بياع' }, { id: 3, nameAr: 'مسؤول سوشيال' }]).map((r) => (
                <option key={r.id} value={r.id}>{r.nameAr}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>الفرع</Label>
            <Select value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
              <option value="">—</option>
              {(locations ?? []).map((l) => <option key={l.id} value={l.id}>{l.nameAr}</option>)}
            </Select>
          </div>
          <div>
            <Label>سقف خصم المصنعية %</Label>
            <Input type="number" value={form.discountCapPercent} onChange={(e) => setForm({ ...form, discountCapPercent: e.target.value })} />
          </div>
          <div>
            <Label>{editing ? 'كود دخول جديد (اتركه لتغييره)' : 'كود الدخول *'}</Label>
            <Input type="password" value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value })} dir="ltr" className="text-center tracking-[0.4em]" />
          </div>
          <div className="sm:col-span-2">
            <Label>ملاحظات إدارية</Label>
            <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!form.employeeNo || !form.fullName || !form.username || !form.roleId || (!editing && !form.pin)}
            onClick={() =>
              saveMutation.mutate({
                employeeNo: form.employeeNo,
                fullName: form.fullName,
                phone: form.phone || null,
                username: form.username,
                pin: editing ? form.pin || undefined : form.pin,
                roleId: Number(form.roleId),
                locationId: form.locationId ? Number(form.locationId) : null,
                discountCapPercent: Number(form.discountCapPercent || 0),
                notes: form.notes || null,
              })
            }
          >
            حفظ
          </Button>
        </div>
      </Dialog>

      <Dialog open={resetId != null} onClose={() => setResetId(null)} title="إعادة تعيين كود الدخول">
        <div>
          <Label>كود الدخول الجديد</Label>
          <Input
            type="password"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            dir="ltr"
            className="text-center tracking-[0.5em]"
          />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setResetId(null)}>إلغاء</Button>
          <Button variant="brand" disabled={!newPin} onClick={() => resetPin.mutate()}>إعادة التعيين</Button>
        </div>
      </Dialog>
    </div>
  );
}
