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
