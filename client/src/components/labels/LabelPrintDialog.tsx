import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { useSettings } from '@/hooks/useData';
import {
  LABEL_TEMPLATES,
  labelOptionsFromSettings,
  printJewelryLabels,
  type LabelTemplateId,
} from '@/lib/labels';
import type { Item } from '@/lib/types';
import { LabelPreview } from './LabelPreview';

interface LabelPrintDialogProps {
  items: Item[];
  open: boolean;
  onClose: () => void;
}

export function LabelPrintDialog({ items, open, onClose }: LabelPrintDialogProps) {
  const { data: settings } = useSettings();
  const savedOptions = labelOptionsFromSettings(settings);
  const [template, setTemplate] = useState<LabelTemplateId>(savedOptions.template);
  const [copies, setCopies] = useState(1);
  const [printing, setPrinting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTemplate(labelOptionsFromSettings(settings).template);
    setCopies(1);
  }, [open, settings]);

  const options = { ...savedOptions, template };
  const total = items.length * copies;

  const onPrint = async () => {
    try {
      setPrinting(true);
      await printJewelryLabels(items, options, copies);
      toast.success(`تم تجهيز ${total} ملصق للطباعة`);
    } catch (error: any) {
      toast.error(error.message || 'تعذر تجهيز الطباعة');
    } finally {
      setPrinting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={items.length > 1 ? `طباعة ${items.length} منتجات` : `طباعة ملصق ${items[0]?.code ?? ''}`}
      description={`70 × 13 مم · ${savedOptions.printerName}`}
      className="max-w-3xl"
      footer={(
        <>
          <Button variant="outline" onClick={onClose}>إلغاء</Button>
          <Button variant="brand" loading={printing} disabled={items.length === 0} onClick={onPrint}>
            <Printer className="h-4 w-4" /> طباعة {total} ملصق
          </Button>
        </>
      )}
    >
      <div className="space-y-5">
        <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100 p-3">
          {items[0] && <LabelPreview item={items[0]} options={options} className="mx-auto max-w-2xl shadow-sm" />}
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label>قالب التصميم</Label>
            <Select value={template} onChange={(event) => setTemplate(event.target.value as LabelTemplateId)}>
              {LABEL_TEMPLATES.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </Select>
          </div>
          <div>
            <Label>عدد النسخ لكل منتج</Label>
            <Input
              type="number"
              min={1}
              max={50}
              value={copies}
              onChange={(event) => setCopies(Math.max(1, Math.min(50, Number(event.target.value) || 1)))}
            />
          </div>
        </div>

        {items.length > 1 && (
          <div className="max-h-28 overflow-y-auto border-t border-slate-200 pt-3 text-sm text-slate-600">
            {items.map((item) => item.code).join(' · ')}
          </div>
        )}
      </div>
    </Dialog>
  );
}
