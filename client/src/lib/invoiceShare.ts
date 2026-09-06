import { fmtMoney } from '@/lib/utils';
import type { Invoice } from '@/lib/types';
import { DEFAULT_STORE_NAME } from '@/lib/branding';

// Human-readable Arabic invoice summary suitable for WhatsApp / clipboard.
export function invoiceText(inv: Invoice, storeName = DEFAULT_STORE_NAME): string {
  const lines: string[] = [
    `فاتورة — ${storeName}`,
    `رقم: ${inv.invoiceNo}`,
    `التاريخ: ${new Date(inv.createdAt).toLocaleString('ar-EG-u-nu-latn')}`,
    '',
    ...(inv.items ?? []).map(
      (it) =>
        `• ${it.itemCodeSnapshot} ${it.itemNameSnapshot ?? ''} ×${it.quantity ?? 1} — ${fmtMoney(it.lineTotal)} ج.م`,
    ),
    '',
    `الإجمالي: ${fmtMoney(inv.total)} ج.م`,
  ];
  if (Number(inv.discountAmount) > 0) lines.push(`خصم: ${fmtMoney(inv.discountAmount)} ج.م`);
  if (inv.payments?.[0]?.amount) lines.push(`المدفوع: ${fmtMoney(inv.payments[0].amount)} ج.م`);
  return lines.join('\n');
}

export function copyInvoiceText(inv: Invoice, storeName?: string): boolean {
  const text = invoiceText(inv, storeName);
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

// Open WhatsApp with the invoice text pre-filled for the given phone (if any).
// Returns true when a link was opened.
export function shareInvoiceWhatsApp(inv: Invoice, phone?: string | null, storeName?: string): boolean {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return false;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(invoiceText(inv, storeName))}`, '_blank', 'noopener');
  return true;
}

function whatsappNumber(phone?: string | null): string {
  let digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  // Local Egyptian mobile numbers are stored as 01xxxxxxxxx in the POS.
  if (digits.startsWith('0')) digits = `20${digits.slice(1)}`;
  return digits.length >= 8 ? digits : '';
}

export function openInvoiceWhatsAppWeb(inv: Invoice, phone?: string | null, storeName?: string): boolean {
  const digits = whatsappNumber(phone);
  if (!digits) return false;
  const message = invoiceText(inv, storeName);
  const popup = window.open(
    `https://web.whatsapp.com/send?phone=${digits}&text=${encodeURIComponent(message)}`,
    '_blank',
  );
  if (popup) popup.opener = null;
  return popup !== null;
}

export async function downloadInvoicePdf(element: HTMLElement, inv: Invoice): Promise<string> {
  const [{ toPng }, { jsPDF }] = await Promise.all([import('html-to-image'), import('jspdf')]);
  const dataUrl = await toPng(element, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    pixelRatio: 2,
  });

  const image = new Image();
  image.src = dataUrl;
  await image.decode();

  const pageWidth = 80;
  const margin = 4;
  const imageWidth = pageWidth - margin * 2;
  const imageHeight = imageWidth * (image.naturalHeight / image.naturalWidth);
  const pageHeight = Math.max(60, imageHeight + margin * 2);
  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [pageWidth, pageHeight] });
  pdf.addImage(dataUrl, 'PNG', margin, margin, imageWidth, imageHeight, undefined, 'FAST');

  const filename = `${String(inv.invoiceNo || 'invoice').replace(/[^a-zA-Z0-9_-]/g, '_')}.pdf`;
  pdf.save(filename);
  return filename;
}
