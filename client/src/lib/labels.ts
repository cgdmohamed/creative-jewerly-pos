import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import type { AppSettings, Item } from './types';

export type LabelTemplateId =
  | 'basic'
  | 'classic'
  | 'modern'
  | 'arabic-focus'
  | 'slogan'
  | 'metal-first'
  | 'simple-arabic'
  | 'premium-text'
  | 'clean-bold';

export interface LabelTemplate {
  id: LabelTemplateId;
  name: string;
  codeType: 'qr' | 'barcode';
}

export interface LabelOptions {
  template: LabelTemplateId;
  logoUrl: string | null;
  brandName: string;
  printerName: string;
  offsetX: number;
  offsetY: number;
}

export const LABEL_TEMPLATES: LabelTemplate[] = [
  { id: 'basic', name: 'الأساسي (افتراضي)', codeType: 'qr' },
  { id: 'classic', name: '1. كلاسيكي', codeType: 'barcode' },
  { id: 'modern', name: '2. عصري', codeType: 'qr' },
  { id: 'arabic-focus', name: '3. عربي', codeType: 'barcode' },
  { id: 'slogan', name: '4. عبارة تسويقية', codeType: 'qr' },
  { id: 'metal-first', name: '5. إبراز العيار', codeType: 'barcode' },
  { id: 'simple-arabic', name: '6. عربي بسيط', codeType: 'qr' },
  { id: 'premium-text', name: '7. فاخر', codeType: 'barcode' },
  { id: 'clean-bold', name: '8. واضح وجريء', codeType: 'qr' },
];

const TEMPLATE_IDS = new Set(LABEL_TEMPLATES.map((template) => template.id));
const DEFAULT_LOGO = '/brand/black_logo.svg';

export const LABEL_SAMPLE_ITEM = {
  id: 248,
  code: 'RG-0248',
  productKind: 'jewelry',
  metalType: 'silver',
  carat: '925',
  weightG: 7.85,
  stoneWeightG: 0,
  craftsmanshipType: 'fixed',
  craftsmanshipValue: 0,
  status: 'available',
  physicalStatus: 'new',
  manufacturingVarianceG: 0,
} as Item;

export function labelCodeForItem(item: Pick<Item, 'id' | 'labelCode'>): string {
  return item.labelCode || `99${String(item.id).padStart(6, '0')}`;
}

export function labelOptionsFromSettings(settings?: AppSettings): LabelOptions {
  const rawTemplate = settings?.label_template as LabelTemplateId | undefined;
  return {
    template: rawTemplate && TEMPLATE_IDS.has(rawTemplate) ? rawTemplate : 'basic',
    logoUrl: settings?.label_logo_enabled === 'false'
      ? null
      : settings?.label_logo_data_url || DEFAULT_LOGO,
    brandName: settings?.label_brand_name?.trim() || 'GOLDEN CROWN',
    printerName: settings?.label_printer_name?.trim() || 'LV-1300',
    offsetX: finiteSetting(settings?.label_offset_x_mm),
    offsetY: finiteSetting(settings?.label_offset_y_mm),
  };
}

function finiteSetting(value?: string): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? Math.min(5, Math.max(-5, number)) : 0;
}

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function text(
  value: string,
  x: number,
  y: number,
  size: number,
  options: { bold?: boolean; anchor?: 'start' | 'middle' | 'end'; rtl?: boolean; spacing?: number } = {},
): string {
  const anchor = options.anchor ?? 'middle';
  const weight = options.bold ? 700 : 400;
  const direction = options.rtl ? ' direction="rtl" unicode-bidi="plaintext"' : '';
  const spacing = options.spacing ? ` letter-spacing="${options.spacing}"` : '';
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="Arial, sans-serif" font-size="${size}" font-weight="${weight}"${direction}${spacing}>${xml(value)}</text>`;
}

function line(x1: number, y1: number, x2: number, y2: number, width = 1): string {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#000" stroke-width="${width}"/>`;
}

function logo(url: string | null, x: number, y: number, width: number, height: number): string {
  if (!url) return '';
  return `<image href="${xml(url)}" x="${x}" y="${y}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid meet"/>`;
}

function weightLine(item: Item): string {
  const value = Number(item.weightG);
  return Number.isFinite(value) && value > 0 ? `${value.toFixed(2)} g` : '';
}

function metalLine(item: Item): string {
  if (item.productKind === 'general') return shortText(item.name?.trim() || 'ITEM', 14);
  const carat = item.carat?.trim() || '';
  if (item.metalType === 'silver') return `Ag ${carat || '925'}`;
  if (item.metalType === 'gold') return carat ? `${carat}K` : 'Au';
  return carat;
}

function compactCode(item: Item): string {
  const code = item.code.trim();
  return code.length > 14 ? code.slice(0, 14) : code;
}

function productLines(item: Item, right = 463, metal = true): string {
  const center = 360 + (right - 360) / 2;
  const code = compactCode(item);
  const codeSize = code.length > 10 ? 13 : 17;
  return [
    text(code, center, 27, codeSize, { bold: true }),
    text(weightLine(item), center, 58, 15),
    metal ? text(metalLine(item), center, 87, 15) : '',
  ].join('');
}

function splitBrand(brand: string): [string, string] {
  const words = brand.trim().split(/\s+/);
  if (words.length < 2) return [shortText(words[0] || 'GOLDEN', 16), 'CROWN'];
  const midpoint = Math.ceil(words.length / 2);
  return [
    shortText(words.slice(0, midpoint).join(' '), 16),
    shortText(words.slice(midpoint).join(' '), 16),
  ];
}

function shortText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

async function codeImage(type: 'qr' | 'barcode', value: string): Promise<string> {
  if (type === 'qr') {
    return QRCode.toDataURL(value, {
      errorCorrectionLevel: 'M',
      margin: 4,
      width: 87,
      color: { dark: '#000000', light: '#ffffff' },
    });
  }

  const canvas = document.createElement('canvas');
  JsBarcode(canvas, value, {
    format: 'CODE128',
    displayValue: false,
    width: 1,
    height: 58,
    margin: 0,
    background: '#ffffff',
    lineColor: '#000000',
  });
  return canvas.toDataURL('image/png');
}

function leftTemplate(template: LabelTemplateId, options: LabelOptions): string {
  const brand = splitBrand(options.brandName);
  const mark = logo(options.logoUrl, 7, 9, 58, 86);
  switch (template) {
    case 'basic':
      return '';
    case 'classic':
      return logo(options.logoUrl, 65, 8, 58, 86) || text(options.brandName, 100, 57, 17, { bold: true });
    case 'modern':
      return `${mark}${line(73, 13, 73, 91, 2)}${text('FINE', 139, 31, 12, { spacing: 2 })}${text('SILVER', 139, 53, 12, { spacing: 2 })}${text('JEWELRY', 139, 75, 12, { spacing: 2 })}`;
    case 'arabic-focus':
      return `${mark}${text('مجوهرات', 137, 40, 16, { bold: true, rtl: true })}${text('وفضيات', 137, 64, 16, { bold: true, rtl: true })}${line(112, 78, 162, 78, 2)}`;
    case 'slogan':
      return `${mark}${line(73, 13, 73, 91, 2)}${text('TIMELESS', 139, 25, 10, { spacing: 1 })}${text('PIECES', 139, 44, 10, { spacing: 1 })}${text('BRIGHTER', 139, 63, 10, { spacing: 1 })}${text('PEOPLE', 139, 82, 10, { spacing: 1 })}`;
    case 'metal-first':
      return `${mark}${line(73, 13, 73, 91, 2)}${text('Ag 925', 139, 35, 17, { bold: true })}${line(111, 47, 166, 47)}${text('SILVER', 139, 67, 10, { spacing: 1 })}${text('JEWELRY', 139, 83, 9, { spacing: 1 })}`;
    case 'simple-arabic':
      return `${mark}${line(73, 13, 73, 91, 2)}${text('قطع مميزة', 139, 40, 15, { bold: true, rtl: true })}${text('لقصة أجمل', 139, 66, 15, { bold: true, rtl: true })}${line(113, 80, 162, 80, 2)}`;
    case 'premium-text':
      return `${mark}${line(73, 13, 73, 91, 2)}${text('EST.', 139, 28, 10, { spacing: 2 })}${text('TRUST', 139, 49, 10, { spacing: 2 })}${text('QUALITY', 139, 70, 10, { spacing: 2 })}${line(114, 82, 163, 82)}`;
    case 'clean-bold':
      return `${mark}${line(73, 13, 73, 91, 2)}${text(brand[0], 139, 42, brand[0].length > 12 ? 13 : 16, { bold: true, rtl: /[\u0600-\u06ff]/.test(brand[0]) })}${text(brand[1], 139, 64, brand[1].length > 12 ? 11 : 14, { bold: true, rtl: /[\u0600-\u06ff]/.test(brand[1]) })}${text('مجوهرات وفضيات', 139, 84, 10, { rtl: true })}`;
  }
}

export async function buildLabelSvg(item: Item, options: LabelOptions): Promise<string> {
  const template = LABEL_TEMPLATES.find((entry) => entry.id === options.template) ?? LABEL_TEMPLATES[0];
  const labelCode = labelCodeForItem(item);
  const image = await codeImage(template.codeType, labelCode);
  if (options.template === 'basic') {
    const brand = shortText(options.brandName, 18);
    const details = [metalLine(item), weightLine(item)].filter(Boolean).join('  |  ');
    const dx = options.offsetX * 8;
    const dy = options.offsetY * 8;
    return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="13mm" viewBox="0 0 560 104" role="img" aria-label="${xml(`ملصق ${item.code}`)}">
      <rect width="560" height="104" fill="#fff"/>
      <g transform="translate(${dx} ${dy})" fill="#000">
        <image href="${image}" x="56" y="1" width="87" height="87"/>
        ${text(labelCode, 100, 101, 10)}
        ${text(brand, 460, 25, brand.length > 14 ? 15 : 18, { bold: true })}
        ${text(compactCode(item), 460, 56, compactCode(item).length > 10 ? 13 : 15)}
        ${text(details, 460, 86, details.length > 16 ? 13 : 16, { bold: true })}
      </g>
    </svg>`;
  }
  const codeGraphic = template.codeType === 'qr'
    ? `<image href="${image}" x="469" y="8" width="87" height="87"/>`
    : `<image href="${image}" x="442" y="10" width="116" height="58" preserveAspectRatio="none"/>${text(labelCode, 500, 89, 10)}`;
  const right = options.template === 'metal-first'
    ? `${productLines(item, 438, false)}${codeGraphic}`
    : `${productLines(item, template.codeType === 'qr' ? 463 : 438)}${codeGraphic}`;
  const dx = options.offsetX * 8;
  const dy = options.offsetY * 8;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="70mm" height="13mm" viewBox="0 0 560 104" role="img" aria-label="${xml(`ملصق ${item.code}`)}">
    <rect width="560" height="104" fill="#fff"/>
    <g transform="translate(${dx} ${dy})" fill="#000">
      ${leftTemplate(options.template, options)}
      ${right}
    </g>
  </svg>`;
}

export async function printJewelryLabels(
  items: Item[],
  options: LabelOptions,
  copies = 1,
): Promise<void> {
  const popup = window.open('', 'jewelry-label-print', 'width=920,height=640');
  if (!popup) throw new Error('تعذر فتح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا الموقع.');

  popup.document.write('<!doctype html><html lang="ar" dir="rtl"><head><title>تجهيز الملصقات</title></head><body style="font-family:Arial;padding:24px">جارٍ تجهيز الملصقات...</body></html>');
  popup.document.close();

  try {
    const pages: string[] = [];
    const count = Math.max(1, Math.min(50, Math.round(copies)));
    for (const item of items) {
      const svg = await buildLabelSvg(item, options);
      for (let copy = 0; copy < count; copy += 1) pages.push(svg);
    }

    popup.document.open();
    popup.document.write(`<!doctype html>
      <html><head><base href="${xml(`${window.location.origin}/`)}"><title>ملصقات المنتجات</title>
      <style>
        * { box-sizing: border-box; }
        html, body { margin: 0; padding: 0; background: #fff; }
        .label-page { width: 70mm; height: 13mm; overflow: hidden; break-after: page; page-break-after: always; }
        .label-page:last-child { break-after: auto; page-break-after: auto; }
        .label-page svg { display: block; width: 70mm; height: 13mm; }
        @page { size: 70mm 13mm; margin: 0; }
        @media screen {
          body { padding: 16px; background: #e5e7eb; }
          .label-page { margin: 0 auto 12px; box-shadow: 0 1px 5px #64748b; }
        }
        @media print { .label-page { margin: 0; } }
      </style></head><body>${pages.map((page) => `<div class="label-page">${page}</div>`).join('')}
      <script>window.addEventListener('load',()=>setTimeout(()=>window.print(),350));window.addEventListener('afterprint',()=>window.close());</script>
      </body></html>`);
    popup.document.close();
  } catch (error) {
    popup.close();
    throw error;
  }
}
