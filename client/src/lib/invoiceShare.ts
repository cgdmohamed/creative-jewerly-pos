import { fmtMoney } from '@/lib/utils';
import type { Invoice } from '@/lib/types';

// Human-readable Arabic invoice summary suitable for WhatsApp / clipboard.
export function invoiceText(inv: Invoice): string {
  const lines: string[] = [
    'فاتورة — محل السبائك والمشغولات',
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

export function copyInvoiceText(inv: Invoice): boolean {
  const text = invoiceText(inv);
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(text);
    return true;
  }
  return false;
}

// Open WhatsApp with the invoice text pre-filled for the given phone (if any).
// Returns true when a link was opened.
export function shareInvoiceWhatsApp(inv: Invoice, phone?: string | null): boolean {
  const digits = String(phone ?? '').replace(/[^\d+]/g, '');
  if (!digits) return false;
  window.open(`https://wa.me/${digits}?text=${encodeURIComponent(invoiceText(inv))}`, '_blank', 'noopener');
  return true;
}
