import { Request } from 'express';
import type { Queryable } from './db.js';

/** Insert a generic audit-log row. Never throws. */
export async function audit(
  db: Queryable,
  table: string,
  recordId: string | number,
  action: string,
  performedBy: number | undefined,
  oldData?: any,
  newData?: any,
) {
  try {
    await db.query(
      `INSERT INTO audit_log (table_name, record_id, action, old_data, new_data, performed_by)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [table, String(recordId), action, oldData ?? null, newData ?? null, performedBy ?? null],
    );
  } catch {
    /* audit must never break a business operation */
  }
}

/** Format a JSON-ish snake_case row into camelCase for the API (recursive). */
export function camelize<T = any>(row: any): T {
  if (!row || typeof row !== 'object') return row;
  if (Array.isArray(row)) return row.map((x) => camelize(x)) as T;
  if (row instanceof Date) return row as T;
  const out: any = {};
  for (const [k, v] of Object.entries(row)) {
    const key = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
    out[key] = camelize(v);
  }
  return out as T;
}

export function camelizeRows<T = any>(rows: any[]): T[] {
  return rows.map((r) => camelize<T>(r));
}

export function formatEgyptianNumber(n: number | string | null | undefined, digits = 2): string {
  const num = Number(n ?? 0);
  return new Intl.NumberFormat('ar-EG-u-nu-latn', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(num);
}

export const now = () => new Date();

/** Today's date (YYYY-MM-DD) in the server's local timezone — matches DB CURRENT_DATE. */
export function todayLocal(): string {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Derive item status from batch quantities (quantity / reserved / in-transit). */
export function deriveStatus(
  quantity: number,
  reservedQty: number,
  inTransitQty: number,
): 'available' | 'reserved' | 'sold' | 'in_transit' {
  if (quantity <= 0) return 'sold';
  if (quantity - reservedQty - inTransitQty <= 0) {
    if (inTransitQty > 0) return 'in_transit';
    if (reservedQty > 0) return 'reserved';
  }
  return 'available';
}
