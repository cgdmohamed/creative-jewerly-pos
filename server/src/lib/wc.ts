import fs from 'node:fs';
import path from 'node:path';
import * as WooCommerceRestApiModule from '@woocommerce/woocommerce-rest-api';
import { query } from '../db.js';
import { config } from '../config.js';
import type { Queryable } from '../db.js';

// Resolve the default class across CJS interop shapes (tsx nests it as
// `.default.default`; plain ESM gives `.default`; require gives the namespace).
const WooCommerceRestApi: any =
  (WooCommerceRestApiModule as any).default?.default ??
  (WooCommerceRestApiModule as any).default ??
  WooCommerceRestApiModule;

export function httpError(status: number, message: string) {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

/* ------------------------------------------------------------------ */
/* WooCommerce resource shapes (subset we care about)                   */
/* ------------------------------------------------------------------ */
export interface WcProduct {
  id: number;
  name: string;
  slug: string;
  permalink: string;
  sku: string;
  description: string;
  short_description: string;
  price: string;
  regular_price: string;
  manage_stock: boolean;
  stock_quantity: number | null;
  weight: string;
  categories: { id: number; name: string; slug: string }[];
  images: { id: number; src: string }[];
  attributes: { id: number; name: string; options: string[] }[];
  meta_data: { id: number; key: string; value: string }[];
  status: string;
}

export interface WcCustomer {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  billing: { first_name: string; last_name: string; phone: string; email: string; address_1: string; city: string };
}

export interface WcOrder {
  id: number;
  number: string;
  status: string;
  date_created: string;
  payment_method: string;
  payment_method_title: string;
  customer_id: number;
  billing: { first_name: string; last_name: string; phone: string; email: string; address_1: string; city: string };
  line_items: { id: number; product_id: number; name: string; sku: string; quantity: number }[];
  total: string;
  currency: string;
}

export const IMPORTABLE_ORDER_STATUSES = ['processing', 'completed', 'on-hold', 'pending'];

/* ------------------------------------------------------------------ */
/* Store config (from app_settings)                                     */
/* ------------------------------------------------------------------ */
export async function getWcConfig(): Promise<{ url: string; consumerKey: string; consumerSecret: string } | null> {
  const rows = await query(`SELECT key, value FROM app_settings
    WHERE key IN ('wc_url','wc_consumer_key','wc_consumer_secret')`);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  if (!m.wc_url || !m.wc_consumer_key || !m.wc_consumer_secret) return null;
  return {
    url: m.wc_url.replace(/\/+$/, ''),
    consumerKey: m.wc_consumer_key,
    consumerSecret: m.wc_consumer_secret,
  };
}

export async function readAutoSyncSettings() {
  const rows = await query(`SELECT key, value FROM app_settings
    WHERE key IN ('wc_auto_sync_enabled','wc_auto_sync_interval_min','wc_auto_sync_ops','wc_weight_kg')`);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  const enabled = m.wc_auto_sync_enabled === 'true';
  const intervalMin = Math.max(15, Math.floor(Number(m.wc_auto_sync_interval_min ?? 60) || 60));
  const ops = (m.wc_auto_sync_ops || 'products.in,stock.push,customers.in,orders.in')
    .split(',').map((s) => s.trim()).filter(Boolean);
  return { enabled, intervalMin, ops, weightKg: m.wc_weight_kg !== 'false' };
}

export const AUTO_SYNC_OPS = ['products.in', 'stock.push', 'customers.in', 'customers.out', 'orders.in'] as const;
export type AutoSyncOp = typeof AUTO_SYNC_OPS[number];

/* ------------------------------------------------------------------ */
/* Sync log helper                                                      */
/* ------------------------------------------------------------------ */
export interface SyncResult {
  op: string;
  direction: 'in' | 'out';
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { ref: string | number; reason: string }[];
}

export async function logSync(db: Queryable, r: SyncResult, ranBy?: number | null) {
  await db.query(
    `INSERT INTO wc_sync_log (op, direction, imported, updated, skipped, failed, errors, ran_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [r.op, r.direction, r.imported, r.updated, r.skipped, r.failed,
     JSON.stringify(r.errors.slice(0, 100)), ranBy ?? null],
  );
}

/* ------------------------------------------------------------------ */
/* WooCommerce REST client wrapper                                      */
/* ------------------------------------------------------------------ */
export class WcClient {
  private api: any;

  constructor(cfg: { url: string; consumerKey: string; consumerSecret: string }) {
    const parsed = new URL(cfg.url);
    this.api = new WooCommerceRestApi({
      url: parsed.origin,
      consumerKey: cfg.consumerKey,
      consumerSecret: cfg.consumerSecret,
      version: 'wc/v3',
      timeout: 30000,
    });
  }

  /** `path` is joined onto `{url}/wp-json/wc/v3/` by the library — a leading
   *  slash would create `wc/v3//products`, which WordPress 404s on. */
  private normalize(path: string): string {
    return path.replace(/^\/+/, '');
  }

  async get<T = any>(path: string, params: Record<string, any> = {}): Promise<T> {
    const { data } = await this.api.get(this.normalize(path), params);
    return data as T;
  }

  /** Paginate over `per_page=100` until the remote has nothing more. */
  async getAll<T = any>(path: string, params: Record<string, any> = {}): Promise<T[]> {
    const out: T[] = [];
    let page = 1;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const res: any = await this.api.get(this.normalize(path), { ...params, page, per_page: 100 });
      const rows: T[] = res.data;
      out.push(...rows);
      const totalPages = Number(res.headers?.['x-wp-totalpages'] ?? '0');
      if (rows.length === 0 || page >= totalPages) break;
      page += 1;
    }
    return out;
  }

  async post<T = any>(path: string, body: any, params: Record<string, any> = {}): Promise<T> {
    const { data } = await this.api.post(this.normalize(path), body, params);
    return data as T;
  }

  async put<T = any>(path: string, body: any, params: Record<string, any> = {}): Promise<T> {
    const { data } = await this.api.put(this.normalize(path), body, params);
    return data as T;
  }
}

/* ------------------------------------------------------------------ */
/* Helpers                                                              */
/* ------------------------------------------------------------------ */
export function stripHtml(html?: string): string {
  return (html ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function slugify(s: string): string {
  return s.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'cat';
}

/** Attribute lookup helpers — jewelry stores tag metal & carat via attributes. */
export function attrValue(p: WcProduct, ...names: string[]): string | null {
  for (const a of p.attributes ?? []) {
    const n = a.name.toLowerCase();
    if (names.some((x) => n.includes(x.toLowerCase())) && a.options?.[0]) return String(a.options[0]).trim();
  }
  return null;
}

export function metalFromAttrs(p: WcProduct): 'gold' | 'silver' | null {
  const v = attrValue(p, 'metal', 'معدن', 'خام')?.toLowerCase() ?? '';
  if (/فض|silver|925/.test(v)) return 'silver';
  if (/دهب|ذهب|gold/.test(v)) return 'gold';
  return null;
}

export function caratFromAttrs(p: WcProduct): string | null {
  const v = attrValue(p, 'carat', 'عيار');
  if (!v) return null;
  const digits = v.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (digits.startsWith('9') || digits.includes('925')) return '925';
  return digits.slice(0, 2);
}

/** Extract a weight (in grams) from a product attribute like «الوزن» = "5 جرام"
 *  or "31.1 جم". Returns null when absent or unparseable. */
export function weightFromAttrs(p: WcProduct): number | null {
  const v = attrValue(p, 'الوزن', 'وزن', 'weight');
  if (!v) return null;
  const t = v
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .toLowerCase()
    .replace(/\s+/g, ' ');
  const m = t.match(/(-?[\d.,]+)\s*(جرام|جم|غ|غرام|g|كيلو|كغم|كجم|كج|kg|اوقية|أوقية|اوزة|oz|اونصة)?/);
  if (!m) return null;
  const val = Number.parseFloat(m[1].replace(',', '.'));
  if (!Number.isFinite(val)) return null;
  const unit = m[2] ?? '';
  if (/كيلو|كغم|كجم|كج|kg/.test(unit)) return val * 1000;
  if (/اوقية|أوقية|اوزة|oz|اونصة/.test(unit)) return val * 31.1035;
  if (unit && !/جرام|جم|غ|غرام|g/.test(unit)) return null;
  return val;
}

/** Real stores often don't tag metal explicitly — infer it from the carat
 *  attribute (925/999/990/958 → silver), then the category, then the name. */
export function inferMetal(p: WcProduct): 'gold' | 'silver' | null {
  const attr = metalFromAttrs(p);
  if (attr) return attr;
  const carat = caratFromAttrs(p);
  if (carat) return /925|999|990|958/.test(carat) ? 'silver' : 'gold';
  const text = [
    ...(p.categories ?? []).map((c) => c.name),
    p.name ?? '',
    p.sku ?? '',
  ].join(' ').toLowerCase();
  if (/فضة|فضه|silver/.test(text)) return 'silver';
  if (/ذهب|دهب|gold/.test(text)) return 'gold';
  return null;
}

/** Marker appended to item notes when a store product had no weight and was
 *  imported with the 1g placeholder — also suppresses price push on export. */
export const WEIGHT_PLACEHOLDER_MARKER = 'الوزن الافتراضي';

/** Extract WC order meta `_barcode`. */
export function barcodeFromProduct(p: WcProduct): string | null {
  for (const m of p.meta_data ?? []) {
    if (String(m.key).toLowerCase() === '_barcode' && m.value) return String(m.value);
  }
  return attrValue(p, 'barcode', 'باركود');
}

/** Download a product image into the shared uploads dir. Never throws. */
export async function downloadImage(url: string, prefix = 'wc'): Promise<string | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
    if (!/^image\//.test(type)) return null;
    const file = `${prefix}-${Date.now()}-${Math.round(Math.random() * 1e6)}.${ext}`;
    fs.writeFileSync(path.resolve(config.uploadDir, file), buf);
    return `/uploads/${file}`;
  } catch {
    return null;
  }
}

/** Latest today's price for a metal/carat, or null if not set yet. */
export async function todayMetalPrice(db: Queryable, metalType: string, carat: string | null): Promise<number | null> {
  const p = await db.queryOne<any>(
    `SELECT price_per_gram FROM price_history
      WHERE metal_type = $1 AND COALESCE(carat,'') = COALESCE($2,'')
        AND effective_date = CURRENT_DATE AND end_date IS NULL`,
    [metalType, carat || null],
  );
  return p ? Number(p.price_per_gram) : null;
}

/** Resolve a WC order payment title to a local payment method code. */
export async function resolvePaymentMethod(db: Queryable, title: string | null): Promise<string> {
  const t = (title ?? '').toLowerCase();
  const rows = await query(`SELECT code, name_ar, name_en FROM payment_methods`);
  for (const r of rows) {
    if (String(r.name_ar ?? '').toLowerCase() === t || String(r.name_en ?? '').toLowerCase() === t) return r.code;
  }
  if (/cash|نقد/.test(t)) return 'cash';
  if (/bank|transfer|تحويل/.test(t)) return 'transfer';
  if (/card|credit|debit|كارت/.test(t)) return 'card';
  if (/wallet|paypal|محفظ/.test(t)) return 'wallet';
  return 'cash';
}
