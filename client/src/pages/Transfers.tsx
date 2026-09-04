import { useState } from 'react';
import { ArrowLeftRight, CheckCircle2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Pagination } from '@/components/ui/pagination';
import { Badge } from '@/components/ui/badge';
import { Dialog, confirmDialog } from '@/components/ui/dialog';
import { toast } from '@/components/ui/toast';
import { useItems, useLocations, useMovements } from '@/hooks/useData';
import { usePagination } from '@/hooks/usePagination';
import { api } from '@/lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { fmtDateTime, STATUS_BADGE } from '@/lib/utils';
import { can } from '@/stores/auth';

export default function Transfers() {
  const { data: movements, isLoading } = useMovements();
  const { data: locations } = useLocations();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [itemId, setItemId] = useState('');
  const [toLocationId, setToLocationId] = useState('');
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState(1);
  const [filterStatus, setFilterStatus] = useState('');

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['movements'] });
    qc.invalidateQueries({ queryKey: ['items'] });
  };

  const { data: availableItems } = useItems({ status: 'available' });

  const selectedItem = (availableItems ?? []).find((it) => String(it.id) === itemId);
  const selectedAvailable = selectedItem?.availableQty ?? 1;

  const createMovement = useMutation({
    mutationFn: (body: any) => api('/api/movements', { method: 'POST', body }),
    onSuccess: () => {
      toast.success('تم إنشاء النقل — القطعة تحت النقل');
      setOpen(false);
      setItemId(''); setToLocationId(''); setReason(''); setQty(1);
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const receiveMutation = useMutation({
    mutationFn: (id: number) => api(`/api/movements/${id}/receive`, { method: 'POST', body: {} }),
    onSuccess: () => {
      toast.success('تم استلام القطعة');
      invalidate();
    },
    onError: (e: any) => toast.error('خطأ: ' + e.message),
  });

  const list = (movements ?? []).filter((m) => (filterStatus ? m.status === filterStatus : true));
  const pag = usePagination(list, 10, filterStatus);

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="النقل بين الفروع"
        description="كل نقل مسجَّل بناقل ومكان مصدر وهدف — والاستلام إجباري من الطرف المستلم"
        actions={
          can('movement.create') ? (
            <Button variant="brand" onClick={() => setOpen(true)}>
              <ArrowLeftRight className="h-4 w-4" /> نقل قطعة
            </Button>
          ) : undefined
        }
      />

      <Card className="mb-5">
        <CardContent className="flex items-center gap-3 p-4">
          <div className="w-44">
            <Label>الحالة</Label>
            <Select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
              <option value="">الكل</option>
              <option value="in_transit">تحت النقل</option>
              <option value="received">مستلمة</option>
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
                <TableHead>من</TableHead>
                <TableHead>إلى</TableHead>
                <TableHead>الناقل</TableHead>
                <TableHead>المستلم</TableHead>
                <TableHead>الوقت</TableHead>
                <TableHead>الحالة</TableHead>
                <TableHead className="text-end">إجراء</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading && <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">جارٍ التحميل…</TableCell></TableRow>}
              {pag.slice.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-mono text-xs font-bold">{m.itemCode}</TableCell>
                  <TableCell className="text-xs">{m.quantity ?? 1}</TableCell>
                  <TableCell className="text-xs">{m.fromLocation ?? '—'}</TableCell>
                  <TableCell className="text-xs">{m.toLocation}</TableCell>
                  <TableCell className="text-xs">{m.movedByName}</TableCell>
                  <TableCell className="text-xs">{m.receivedByName ?? '—'}</TableCell>
                  <TableCell className="text-xs">{fmtDateTime(m.movedAt)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_BADGE[m.status]}>{m.status === 'in_transit' ? 'تحت النقل' : 'مستلمة'}</Badge>
                  </TableCell>
                  <TableCell className="text-end">
                    {m.status === 'in_transit' && can('movement.receive') && (
                      <Button
                        size="sm"
                        variant="brand"
                        onClick={async () => {
                          if (await confirmDialog('تأكيد استلام هذه القطعة في الفرع الهدف؟')) {
                            receiveMutation.mutate(m.id);
                          }
                        }}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> تأكيد الاستلام
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {list.length === 0 && !isLoading && (
                <TableRow><TableCell colSpan={9} className="py-8 text-center text-slate-400">لا توجد حركات</TableCell></TableRow>
              )}
            </TableBody>
          </Table>
          <Pagination {...pag} pageSize={pag.pageSize} onPageSizeChange={pag.setPageSize} />
        </CardContent>
      </Card>

      <Dialog open={open} onClose={() => setOpen(false)} title="نقل قطعة بين الفروع">
        <div className="space-y-4">
          <div>
            <Label>القطعة (المتاحة)</Label>
            <Select value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">اختر قطعة…</option>
              {(availableItems ?? []).map((it) => (
                <option key={it.id} value={it.id}>
                  {it.code} — {it.name || it.metalType} ({it.locationName}) • متاح {it.availableQty ?? 1}
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
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(Number(e.target.value) || 1, selectedAvailable)))}
              />
            </div>
            <div>
              <Label>إلى الفرع</Label>
              <Select value={toLocationId} onChange={(e) => setToLocationId(e.target.value)}>
                <option value="">اختر الفرع…</option>
                {(locations ?? []).map((l) => (
                  <option key={l.id} value={l.id}>{l.nameAr}</option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label>السبب (اختياري)</Label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="outline" onClick={() => setOpen(false)}>إلغاء</Button>
          <Button
            variant="brand"
            disabled={!itemId || !toLocationId}
            onClick={() => createMovement.mutate({ itemId: Number(itemId), toLocationId: Number(toLocationId), quantity: qty, reason })}
          >
            إنشاء النقل
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
