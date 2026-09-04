import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function fmtMoney(n: number | string | null | undefined): string {
  const num = Number(n ?? 0);
  return num.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

export function fmtNum(n: number | string | null | undefined, digits = 3): string {
  const num = Number(n ?? 0);
  return num.toLocaleString('ar-EG-u-nu-latn', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleDateString('ar-EG-u-nu-latn', { day: 'numeric', month: 'long', year: 'numeric' });
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  return date.toLocaleString('ar-EG-u-nu-latn', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export const metalLabel = (m: string) => (m === 'gold' ? 'ذهب' : m === 'silver' ? 'فضة' : m);
export const metalColor = (m: string) =>
  m === 'gold' ? 'bg-amber-100 text-amber-800' : 'bg-slate-200 text-slate-700';

const FALLBACK_METHODS: Record<string, { name: string; color: string }> = {
  cash: { name: 'نقدي', color: '#10b981' },
  transfer: { name: 'تحويل بنكي', color: '#0ea5e9' },
  card: { name: 'كارت', color: '#8b5cf6' },
  wallet: { name: 'محفظة إلكترونية', color: '#f59e0b' },
};

export function methodName(code: string | undefined | null, methods?: { code: string; nameAr: string }[]): string {
  if (!code) return '—';
  const hit = methods?.find((m) => m.code === code);
  return hit?.nameAr ?? FALLBACK_METHODS[code]?.name ?? code;
}

export function methodColor(code: string | undefined | null, methods?: { code: string; color: string }[]): string {
  if (!code) return '#64748b';
  const hit = methods?.find((m) => m.code === code);
  return hit?.color ?? FALLBACK_METHODS[code]?.color ?? '#64748b';
}

export const STATUS_LABELS: Record<string, string> = {
  available: 'متاحة',
  reserved: 'محجوزة',
  sold: 'مباعة',
  in_transit: 'تحت النقل',
};

export const PHYSICAL_LABELS: Record<string, string> = {
  new: 'جديدة',
  used: 'مستعملة',
};

export const STATUS_BADGE: Record<string, string> = {
  available: 'bg-emerald-100 text-emerald-800',
  reserved: 'bg-sky-100 text-sky-800',
  sold: 'bg-slate-200 text-slate-700',
  in_transit: 'bg-amber-100 text-amber-800',
  active: 'bg-emerald-100 text-emerald-800',
  returned: 'bg-rose-100 text-rose-800',
  completed: 'bg-emerald-100 text-emerald-800',
  cancelled: 'bg-slate-200 text-slate-700',
  open: 'bg-emerald-100 text-emerald-800',
  closed: 'bg-slate-200 text-slate-700',
  in_progress: 'bg-sky-100 text-sky-800',
  received: 'bg-emerald-100 text-emerald-800',
  found: 'bg-emerald-100 text-emerald-800',
  missing: 'bg-rose-100 text-rose-800',
  unexpected: 'bg-violet-100 text-violet-800',
  below: 'bg-rose-100 text-rose-800',
  above: 'bg-amber-100 text-amber-800',
  ok: 'bg-emerald-100 text-emerald-800',
};
