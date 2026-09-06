import { useEffect, useRef, useState } from 'react';
import { ImageUp, Printer, RotateCcw, Save } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { api } from '@/lib/api';
import {
  LABEL_SAMPLE_ITEM,
  LABEL_TEMPLATES,
  labelOptionsFromSettings,
  printJewelryLabels,
} from '@/lib/labels';
import type { AppSettings } from '@/lib/types';
import { cn } from '@/lib/utils';
import { LabelPreview } from './LabelPreview';

interface PrinterSettingsSectionProps {
  settings?: AppSettings;
}

export function PrinterSettingsSection({ settings }: PrinterSettingsSectionProps) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Partial<AppSettings>>({});
  const current = { ...settings, ...draft };
  const options = labelOptionsFromSettings(current);
  const dirty = Object.keys(draft).length > 0;

  useEffect(() => setDraft({}), [settings]);

  const update = (key: keyof AppSettings, value: string) => setDraft((valueBefore) => ({ ...valueBefore, [key]: value }));

  const save = useMutation({
    mutationFn: () => api('/api/settings', {
      method: 'PUT',
      body: draft,
    }),
    onSuccess: () => {
      toast.success('تم حفظ إعدادات طابعة الملصقات');
      setDraft({});
      qc.invalidateQueries({ queryKey: ['settings'] });
    },
    onError: (error: any) => toast.error('خطأ: ' + error.message),
  });

  const uploadLogo = async (file?: File) => {
    if (!file) return;
    try {
      if (!file.type.startsWith('image/') || file.size > 2 * 1024 * 1024) {
        throw new Error('اختر صورة شعار لا يتجاوز حجمها 2 MB');
      }
      const logoData = await thermalLogo(file);
      update('label_logo_data_url', logoData);
      update('label_logo_enabled', 'true');
    } catch (error: any) {
      toast.error(error.message || 'تعذر قراءة الشعار');
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const printTest = async () => {
    try {
      await printJewelryLabels([LABEL_SAMPLE_ITEM], options, 1);
    } catch (error: any) {
      toast.error(error.message || 'تعذر تجهيز طباعة الاختبار');
    }
  };

  return (
    <Card className="mt-5">
      <CardContent className="space-y-6 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 pb-4">
          <div>
            <h2 className="text-lg font-bold text-slate-900">طابعة ملصقات المنتجات</h2>
            <p className="mt-1 text-sm text-slate-500">ملصق مجوهرات حراري 70 × 13 مم</p>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={printTest}><Printer className="h-4 w-4" /> طباعة اختبار</Button>
            <Button variant="brand" loading={save.isPending} disabled={!dirty} onClick={() => save.mutate()}>
              <Save className="h-4 w-4" /> حفظ
            </Button>
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="space-y-5">
            <div>
              <Label>قوالب التصميم</Label>
              <div className="grid gap-3 sm:grid-cols-2">
                {LABEL_TEMPLATES.map((template) => {
                  const selected = options.template === template.id;
                  const templateOptions = { ...options, template: template.id };
                  return (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => update('label_template', template.id)}
                      className={cn(
                        'overflow-hidden rounded-lg border-2 bg-slate-100 p-2 text-start transition-colors',
                        selected ? 'border-brand-600 ring-2 ring-brand-600/15' : 'border-slate-200 hover:border-slate-400',
                      )}
                    >
                      <LabelPreview item={LABEL_SAMPLE_ITEM} options={templateOptions} />
                      <span className="mt-2 block text-xs font-bold text-slate-700">{template.name}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="space-y-4 border-slate-200 lg:border-r lg:pr-5">
            <div>
              <Label>المعاينة المختارة</Label>
              <div className="overflow-hidden rounded-lg border border-slate-300 bg-slate-100 p-2">
                <LabelPreview item={LABEL_SAMPLE_ITEM} options={options} />
              </div>
            </div>

            <div>
              <Label>اسم الماركة</Label>
              <Input
                maxLength={80}
                value={current.label_brand_name ?? 'GOLDEN CROWN'}
                onChange={(event) => update('label_brand_name', event.target.value)}
              />
            </div>

            <div>
              <Label>الطابعة المفضلة</Label>
              <Input
                maxLength={120}
                dir="ltr"
                value={current.label_printer_name ?? 'LV-1300'}
                onChange={(event) => update('label_printer_name', event.target.value)}
              />
            </div>

            <div>
              <Label>الشعار</Label>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(event) => void uploadLogo(event.target.files?.[0])}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => fileRef.current?.click()}>
                  <ImageUp className="h-4 w-4" /> رفع شعار
                </Button>
                <Button
                  variant="ghost"
                  title="استعادة الشعار الافتراضي"
                  onClick={() => {
                    update('label_logo_data_url', '');
                    update('label_logo_enabled', 'true');
                  }}
                >
                  <RotateCcw className="h-4 w-4" /> الافتراضي
                </Button>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-slate-600">
                <input
                  type="checkbox"
                  checked={current.label_logo_enabled !== 'false'}
                  onChange={(event) => update('label_logo_enabled', event.target.checked ? 'true' : 'false')}
                  className="h-4 w-4 accent-brand-600"
                />
                إظهار الشعار على الملصق
              </label>
            </div>

            <div>
              <Label>معايرة موضع الطباعة (مم)</Label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="mb-1 block text-xs text-slate-500">أفقي</span>
                  <Input
                    type="number"
                    min={-5}
                    max={5}
                    step={0.1}
                    value={current.label_offset_x_mm ?? '0'}
                    onChange={(event) => update('label_offset_x_mm', event.target.value)}
                  />
                </div>
                <div>
                  <span className="mb-1 block text-xs text-slate-500">رأسي</span>
                  <Input
                    type="number"
                    min={-5}
                    max={5}
                    step={0.1}
                    value={current.label_offset_y_mm ?? '0'}
                    onChange={(event) => update('label_offset_y_mm', event.target.value)}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function thermalLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const source = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, 360 / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) throw new Error('تعذر تجهيز الشعار');
        context.fillStyle = '#fff';
        context.fillRect(0, 0, width, height);
        context.drawImage(image, 0, 0, width, height);
        const pixels = context.getImageData(0, 0, width, height);
        for (let index = 0; index < pixels.data.length; index += 4) {
          const gray = pixels.data[index] * 0.299 + pixels.data[index + 1] * 0.587 + pixels.data[index + 2] * 0.114;
          const color = gray < 170 ? 0 : 255;
          pixels.data[index] = color;
          pixels.data[index + 1] = color;
          pixels.data[index + 2] = color;
          pixels.data[index + 3] = 255;
        }
        context.putImageData(pixels, 0, 0);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error);
      } finally {
        URL.revokeObjectURL(source);
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(source);
      reject(new Error('ملف الشعار غير صالح'));
    };
    image.src = source;
  });
}
