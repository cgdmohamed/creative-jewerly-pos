import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx, Queryable, pool } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus } from '../utils.js';
import { buildInvoice, poolAsQueryable } from './invoices.js';
import {
  WcClient, getWcConfig, readAutoSyncSettings, logSync, httpError,
  stripHtml, slugify, metalFromAttrs, caratFromAttrs, inferMetal, weightFromAttrs,
  WEIGHT_PLACEHOLDER_MARKER,
  barcodeFromProduct, downloadImage, todayMetalPrice, resolvePaymentMethod,
  AUTO_SYNC_OPS, SyncResult, WcProduct, WcCustomer, WcOrder, IMPORTABLE_ORDER_STATUSES,
} from '../lib/wc.js';

export const woocommerceRouter = Router();
woocommerceRouter.use(authenticate);
woocommerceRouter.use(requirePermission('woocommerce.manage'));

const AUTO_SYNC_KEYS = [
  'wc_auto_sync_enabled', 'wc_auto_sync_interval_min', 'wc_auto_sync_ops', 'wc_weight_kg',
] as const;

/* ------------------------------------------------------------------ */
/* Config                                                               */
/* ------------------------------------------------------------------ */
woocommerceRouter.get('/config', async (_req, res) => {
  const cfg = await getWcConfig();
  const as = await readAutoSyncSettings();
  const rows = await query(`SELECT key, value FROM app_settings WHERE key IN ($1,$2,$3)`,
    ['wc_consumer_key', 'wc_consumer_secret', 'wc_url']);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  res.json({
    configured: !!cfg,
    url: cfg?.url ?? m.wc_url ?? '',
    hasKey: !!m.wc_consumer_key,
    hasSecret: !!m.wc_consumer_secret,
    autoSync: {
      enabled: as.enabled,
      intervalMin: as.intervalMin,
      ops: as.ops.filter((o) => (AUTO_SYNC_OPS as readonly string[]).includes(o)),
    },
    weightKg: as.weightKg,
  });
});

woocommerceRouter.put('/config', async (req, res) => {
  const b = req.body ?? {};
  const updates: Record<string, string> = {};

  if (b.url != null) {
    const url = String(b.url).trim();
    if (url && !/^https?:\/\//i.test(url)) return res.status(400).json({ error: 'bad.url' });
    if (url) updates.wc_url = url.replace(/\/+$/, '');
  }
  // Blank key/secret fields mean "keep the stored value".
  if (b.consumerKey && String(b.consumerKey).trim()) updates.wc_consumer_key = String(b.consumerKey).trim();
  if (b.consumerSecret && String(b.consumerSecret).trim()) updates.wc_consumer_secret = String(b.consumerSecret).trim();

  if (b.autoSyncEnabled != null) updates.wc_auto_sync_enabled = b.autoSyncEnabled ? 'true' : 'false';
  if (b.autoSyncIntervalMin != null) {
    const n = Math.max(15, Math.floor(Number(b.autoSyncIntervalMin) || 60));
    updates.wc_auto_sync_interval_min = String(n);
  }
  if (Array.isArray(b.autoSyncOps)) {
    updates.wc_auto_sync_ops = b.autoSyncOps
      .filter((o: string) => (AUTO_SYNC_OPS as readonly string[]).includes(o))
      .join(',');
  }
  if (b.weightKg != null) updates.wc_weight_kg = b.weightKg ? 'true' : 'false';

  if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'missing:config' });
  for (const [k, v] of Object.entries(updates)) {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [k, v]);
  }
  await audit(poolAsQueryable(), 'app_settings', 'woocommerce.config', 'update', req.employee!.id, null, {
    ...updates, wc_consumer_key: updates.wc_consumer_key ? '***' : undefined, wc_consumer_secret: updates.wc_consumer_secret ? '***' : undefined,
  });
  res.json(await buildConfigPayload());
});

woocommerceRouter.post('/test', async (_req, res) => {
  try {
    const client = await wcClient();
    const info = await client.get<any>('/');
    const meta = await queryOne<any>(`SELECT id FROM locations ORDER BY id LIMIT 1`);
    res.json({ ok: true, info: info ?? {}, locationId: meta?.id ?? null });
  } catch (e: any) {
    const detail = e?.response?.data?.message || e?.message || String(e);
    res.status(400).json({ error: 'woocommerce.connection_failed', detail: String(detail).slice(0, 500) });
  }
});

async function buildConfigPayload() {
  const cfg = await getWcConfig();
  const as = await readAutoSyncSettings();
  const rows = await query(`SELECT key, value FROM app_settings WHERE key IN ($1,$2,$3)`,
    ['wc_consumer_key', 'wc_consumer_secret', 'wc_url']);
  const m: Record<string, string> = {};
  for (const r of rows) m[r.key] = r.value;
  return {
    configured: !!cfg,
    url: cfg?.url ?? m.wc_url ?? '',
    hasKey: !!m.wc_consumer_key,
    hasSecret: !!m.wc_consumer_secret,
    autoSync: { enabled: as.enabled, intervalMin: as.intervalMin, ops: as.ops },
    weightKg: as.weightKg,
  };
}

async function wcClient(): Promise<WcClient> {
  const cfg = await getWcConfig();
  if (!cfg) throw httpError(400, 'woocommerce.not_configured');
  return new WcClient(cfg);
}

/* ------------------------------------------------------------------ */
/* Products — import (all data, SKU/link-based)                         */
/* ------------------------------------------------------------------ */
async function importProducts(ranBy: number | null, dryRun = false): Promise<SyncResult> {
  const res: SyncResult = { op: 'products.in', direction: 'in', imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const client = await wcClient();
  // All non-trash statuses — some stores keep weighted bullion/stock unpublished.
  const products = await client.getAll<WcProduct>('/products');
  const settings = await readAutoSyncSettings();

  for (const p of products) {
    try {
      const outcome = await tx(async (q) => importProduct(q, p, settings.weightKg, ranBy, dryRun));
      if (outcome === 'created') res.imported += 1;
      else if (outcome === 'updated') res.updated += 1;
      else res.skipped += 1;
    } catch (e: any) {
      res.failed += 1;
      res.errors.push({ ref: p.id, reason: e?.message || String(e) });
    }
  }
  if (!dryRun) await logSync(poolAsQueryable(), res, ranBy);
  return res;
}

async function importProduct(
  q: Queryable, p: WcProduct, weightKg: boolean, ranBy: number | null, dryRun: boolean,
): Promise<'created' | 'updated' | 'skipped'> {
  const code = (p.sku || '').trim() || `WC-${p.id}`;
  const name = p.name || null;
  const description = stripHtml(p.short_description || p.description) || null;
  const metal = inferMetal(p);
  // Silver jewelry without a عيار attribute is sterling by default (925);
  // guessing a gold carat would be wrong, so leave gold unknown.
  const carat = caratFromAttrs(p) ?? (metal === 'silver' ? '925' : null);
  // The الوزن attribute (grams, e.g. "5 جرام") takes priority; otherwise use
  // the store weight field honouring the configured kg setting.
  const weightAttr = weightFromAttrs(p);
  const weightRaw = Number.parseFloat(p.weight || '');
  const weight = weightAttr ?? (weightKg && weightRaw > 0 ? weightRaw * 1000 : weightRaw);
  const manageStock = !!p.manage_stock && p.stock_quantity != null;
  const barcode = barcodeFromProduct(p);
  const notes = p.permalink || null;

  const hasRealSku = !!(p.sku && String(p.sku).trim());
  let existing = await q.queryOne<any>(`SELECT * FROM items WHERE wc_product_id = $1`, [p.id]);
  // Fallback by code/SKU only for items not yet linked to any WC product —
  // an item already linked elsewhere must never be silently re-linked to a
  // different product just because a SKU got reused.
  if (!existing && code !== `WC-${p.id}`) {
    existing = await q.queryOne<any>(
      `SELECT * FROM items WHERE code = $1 AND wc_product_id IS NULL`, [code]);
  }

  // Products without a recognizable metal (watches, gifts…) import as
  // fixed-price "general" products instead of being skipped entirely.
  const isGeneral = !metal;
  const salePrice = isGeneral
    ? (Number.parseFloat(p.regular_price ?? '') || Number.parseFloat(p.price ?? '') || null)
    : null;

  // New jewelry must at least have a metal; weight-less ones get a 1g
  // placeholder + a marker note (manager must set the real weight before selling).
  const weightPlaceholder = !isGeneral && !(weight > 0);
  const finalWeight = weightPlaceholder ? 1 : (weight > 0 ? round2(weight) : null);
  // Only trust the WC weight when the local item has none or still carries the
  // importer's placeholder marker — a real, manager-verified weight set in the
  // POS wins, so re-imports never clobber it (and the export pushes it back).
  const applyWeight = weight > 0 && (
    existing == null
    || existing.weight_g == null
    || Number(existing.weight_g) === 0
    || String(existing.notes ?? '').includes(WEIGHT_PLACEHOLDER_MARKER)
  );

  // Category resolution (create-if-missing, unless dry-run)
  let categoryId: number | null = existing?.category_id ?? null;
  const wcCat = p.categories?.[0];
  if (wcCat) {
    const found = await q.queryOne<any>(
      `SELECT id FROM categories WHERE code = $1 OR name_en ILIKE $2 OR name_ar ILIKE $2`,
      [slugify(wcCat.name), wcCat.name]);
    if (found) {
      categoryId = found.id;
    } else if (!dryRun) {
      const created = await q.queryOne<any>(
        `INSERT INTO categories (code, name_ar, name_en) VALUES ($1,$2,$3) RETURNING *`,
        [slugify(wcCat.name), wcCat.name, wcCat.name]);
      categoryId = created.id;
    }
  }

  const quantity = manageStock
    ? Math.max(0, Math.floor(p.stock_quantity!))
    : (existing?.quantity ?? 1);

  if (!existing) {
    if (dryRun) return 'created';
    // The SKU/code is already owned by a different WC product — inserting
    // would violate the unique code constraint and silently mis-link.
    const clash = await q.queryOne<any>(
      `SELECT id FROM items WHERE code = $1 AND wc_product_id IS DISTINCT FROM $2`, [code, p.id]);
    if (clash) throw httpError(409, `products.skip:${p.id}:code.in_use`);
    const location = await q.queryOne<any>(`SELECT id FROM locations WHERE is_active ORDER BY code LIMIT 1`);
    const status = quantity > 0 ? 'available' : 'sold';
    const notesFinal = weightPlaceholder
      ? [notes, WEIGHT_PLACEHOLDER_MARKER].filter(Boolean).join(' | ')
      : notes;
    const r = await q.queryOne<any>(
      `INSERT INTO items
         (code, barcode, name, description, photo_url, category_id, metal_type, carat, weight_g,
          craftsmanship_type, craftsmanship_value, status, notes, quantity, current_location_id,
          created_by, wc_product_id, wc_last_synced_at, product_kind, sale_price)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'fixed',0,$10,$11,$12,$13,$14,$15,now(),$16,$17)
       RETURNING *`,
      [code, barcode, name, description, await productPhoto(p, dryRun), categoryId,
       isGeneral ? null : metal, carat, finalWeight, status, notesFinal, quantity,
       location?.id ?? null, ranBy, p.id, isGeneral ? 'general' : 'jewelry', salePrice],
    );
    if (r.status !== 'available') {
      await q.query(`INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
        VALUES ($1,NULL,$2,$3,$4)`, [r.id, r.status, 'Imported from WooCommerce', ranBy]);
    }
    await audit(q, 'items', r.id, 'create', ranBy ?? undefined, null, { source: 'woocommerce', productId: p.id });
    return 'created';
  }

  if (dryRun) return 'updated';

  // Re-imports must not clobber the placeholder marker (a re-import would
  // otherwise overwrite notes with just the permalink and hide the alert).
  const notesFinal = String(existing.notes ?? '').includes(WEIGHT_PLACEHOLDER_MARKER)
    ? [notes, WEIGHT_PLACEHOLDER_MARKER].filter(Boolean).join(' | ')
    : notes;

  // SKU/code edits made in WooCommerce flow back into the POS — but never
  // clobber a code another item holds (items.code is unique).
  let syncedCode = existing.code;
  if (hasRealSku && code !== existing.code) {
    const clash = await q.queryOne<any>(
      `SELECT id FROM items WHERE code = $1 AND id <> $2`, [code, existing.id]);
    if (clash) throw httpError(409, `products.skip:${p.id}:code.in_use`);
    syncedCode = code;
  }

  const newQty = manageStock ? quantity : existing.quantity;
  const newStatus = deriveStatus(newQty, Number(existing.reserved_qty ?? 0), Number(existing.in_transit_qty ?? 0));
  const photo = existing.photo_url ? null : await productPhoto(p, dryRun);
  const r = await q.queryOne<any>(
    `UPDATE items SET
       code = COALESCE($14, code), barcode = COALESCE($2,barcode), name = COALESCE($3,name),
       description = COALESCE($4,description), category_id = COALESCE($5,category_id),
       metal_type = $6, carat = COALESCE($7,carat), weight_g = COALESCE($8,weight_g),
       notes = COALESCE($9,notes), photo_url = COALESCE($10,photo_url),
       quantity = $11, status = $12, wc_product_id = $13,
       sale_price = COALESCE($15, sale_price),
       wc_last_synced_at = now(), updated_at = now()
     WHERE id = $1 RETURNING *`,
    [existing.id, barcode, name, description, categoryId,
     metal ?? existing.metal_type, carat, applyWeight ? round2(weight) : null,
     notesFinal, photo, newQty, newStatus, p.id, syncedCode,
     existing.product_kind === 'general' && salePrice != null ? round2(salePrice) : null],
  );
  if (newQty !== Number(existing.quantity)) {
    await q.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [existing.id, existing.status, newStatus, `WooCommerce stock sync (${newQty})`, ranBy]);
  }
  await audit(q, 'items', existing.id, 'update', ranBy ?? undefined, { qty: existing.quantity }, {
    source: 'woocommerce', productId: p.id, qty: newQty, metal, carat, weight,
  });
  return 'updated';
}

async function productPhoto(p: WcProduct, dryRun: boolean): Promise<string | null> {
  if (dryRun) return null;
  const src = p.images?.[0]?.src;
  return src ? downloadImage(src, 'wc-item') : null;
}

/* ------------------------------------------------------------------ */
/* Products — export (local is source of truth for stock + price)       */
/* ------------------------------------------------------------------ */
async function exportProducts(ranBy: number | null): Promise<SyncResult> {
  const res: SyncResult = { op: 'stock.push', direction: 'out', imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const client = await wcClient();
  const settings = await readAutoSyncSettings();
  const items = await query(
    `SELECT * FROM items WHERE wc_product_id IS NOT NULL AND is_active`);
  const vatPct = Number((await queryOne<any>(`SELECT value FROM app_settings WHERE key='vat_percent'`))?.value ?? 0);

  for (const item of items) {
    try {
      const stock = Math.max(0, Number(item.quantity) - Number(item.reserved_qty ?? 0) - Number(item.in_transit_qty ?? 0));
      const metalPrice = await todayMetalPrice(poolAsQueryable(), item.metal_type, item.carat);
      const placeholderWeight = String(item.notes ?? '').includes(WEIGHT_PLACEHOLDER_MARKER);
      const body: Record<string, any> = { manage_stock: true, stock_quantity: stock };

      if (item.product_kind === 'general') {
        // Fixed-price products (watches…): the POS sale price is the source of truth.
        const sp = Number(item.sale_price);
        if (sp > 0) body.regular_price = String(round2(sp));
      } else if (metalPrice && !placeholderWeight) {
        const metalValue = Number(item.weight_g) * metalPrice;
        const craft = item.craftsmanship_type === 'percent'
          ? metalValue * (Number(item.craftsmanship_value) / 100)
          : Number(item.craftsmanship_value);
        const vat = vatPct > 0 ? (metalValue + craft) * vatPct / 100 : 0;
        const price = round2(metalValue + craft + vat);
        if (price > 0) body.regular_price = String(price);
      }

      // SKU/code changes made in the POS always flow to WooCommerce. WC rejects
      // a duplicate SKU, which surfaces a conflict instead of creating a second
      // product. Only when the WC product has no SKU do we leave it empty.
      if (item.code) body.sku = item.code;

      // Weight pushes on every export (a corrected weight set in the POS must
      // reach WC). Skip while the item still carries the 1g placeholder or has
      // no weight at all (general products).
      if (!placeholderWeight && item.weight_g != null) {
        const kg = settings.weightKg ? Number(item.weight_g) / 1000 : Number(item.weight_g);
        if (kg > 0) body.weight = String(round2(kg));
      }

      // Push full product data only on the first export (no prior sync marker).
      if (!item.wc_last_synced_at) {
        if (item.name) body.name = item.name;
        const desc = stripHtml(item.description) || undefined;
        if (desc) body.description = desc;
        if (item.barcode) body.meta_data = [{ key: '_barcode', value: item.barcode }];
      }

      await client.put(`/products/${item.wc_product_id}`, body);
      await query(`UPDATE items SET wc_last_synced_at = now(), updated_at = now() WHERE id = $1`, [item.id]);
      await audit(poolAsQueryable(), 'items', item.id, 'woocommerce_export', ranBy ?? undefined, null, body);
      res.updated += 1;
    } catch (e: any) {
      res.failed += 1;
      res.errors.push({ ref: item.id, reason: e?.response?.data?.message || e?.message || String(e) });
    }
  }
  await logSync(poolAsQueryable(), res, ranBy);
  return res;
}

/* ------------------------------------------------------------------ */
/* Customers — two-way sync                                            */
/* ------------------------------------------------------------------ */
async function importCustomers(ranBy: number | null): Promise<SyncResult> {
  const res: SyncResult = { op: 'customers.in', direction: 'in', imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const client = await wcClient();
  const customers = await client.getAll<WcCustomer>('/customers');

  for (const c of customers) {
    try {
      const name = [c.first_name, c.last_name].filter(Boolean).join(' ').trim()
        || c.username || c.billing?.first_name || `عميل متجر ${c.id}`;
      const email = String(c.email || '').trim().toLowerCase() || null;
      const phone = c.billing?.phone?.trim() || null;
      const address = [c.billing?.address_1, c.billing?.city].filter(Boolean).join('، ') || null;

      let local = await queryOne<any>(`SELECT * FROM customers WHERE wc_customer_id = $1`, [c.id]);
      if (!local && email) local = await queryOne<any>(`SELECT * FROM customers WHERE LOWER(email) = $1`, [email]);

      if (!local) {
        const r = await tx(async (q) => {
          const row = await q.queryOne<any>(
            `INSERT INTO customers (name, phone, email, address, notes, created_by, wc_customer_id, wc_last_synced_at)
             VALUES ($1,$2,$3,$4,'Imported from WooCommerce',$5,$6,now()) RETURNING *`,
            [name, phone, email, address, ranBy, c.id],
          );
          await audit(q, 'customers', row.id, 'create', ranBy ?? undefined, null, { source: 'woocommerce', wcId: c.id });
          return row;
        });
        res.imported += 1;
      } else {
        await tx(async (q) => {
          const r = await q.queryOne<any>(
            `UPDATE customers SET name = $2, phone = COALESCE($3, phone), email = COALESCE($4, email),
                    address = COALESCE($5, address), wc_customer_id = $6, wc_last_synced_at = now(), updated_at = now()
             WHERE id = $1 RETURNING *`,
            [local.id, name, phone, email, address, c.id],
          );
          await audit(q, 'customers', local.id, 'update', ranBy ?? undefined, null, { source: 'woocommerce', wcId: c.id });
          return r;
        });
        res.updated += 1;
      }
    } catch (e: any) {
      res.failed += 1;
      res.errors.push({ ref: c.id, reason: e?.message || String(e) });
    }
  }
  await logSync(poolAsQueryable(), res, ranBy);
  return res;
}

async function exportCustomers(ranBy: number | null): Promise<SyncResult> {
  const res: SyncResult = { op: 'customers.out', direction: 'out', imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const client = await wcClient();
  const customers = await query(`SELECT * FROM customers WHERE is_active`);

  for (const c of customers) {
    try {
      const [first, ...rest] = String(c.name || '').trim().split(' ');
      const last = rest.join(' ') || undefined;
      const email = String(c.email || '').trim().toLowerCase();
      const payload = {
        first_name: first || c.name,
        last_name: last,
        email: email || undefined,
        billing: {
          first_name: first || c.name,
          last_name: last,
          email: email || undefined,
          phone: c.phone || undefined,
          address_1: c.address || undefined,
        },
      };

      if (c.wc_customer_id) {
        await client.put(`/customers/${c.wc_customer_id}`, payload);
      } else {
        if (!email) { res.skipped += 1; continue; }
        const found = await client.get<WcCustomer[]>('/customers', { email, per_page: 1 });
        if (found[0]) {
          await client.put(`/customers/${found[0].id}`, payload);
          await query(`UPDATE customers SET wc_customer_id = $1 WHERE id = $2`, [found[0].id, c.id]);
        } else {
          const created = await client.post<WcCustomer>('/customers', payload);
          await query(`UPDATE customers SET wc_customer_id = $1 WHERE id = $2`, [created.id, c.id]);
        }
      }
      await query(`UPDATE customers SET wc_last_synced_at = now(), updated_at = now() WHERE id = $1`, [c.id]);
      await audit(poolAsQueryable(), 'customers', c.id, 'woocommerce_export', ranBy ?? undefined, null, payload);
      res.updated += 1;
    } catch (e: any) {
      res.failed += 1;
      res.errors.push({ ref: c.id, reason: e?.response?.data?.message || e?.message || String(e) });
    }
  }
  await logSync(poolAsQueryable(), res, ranBy);
  return res;
}

/* ------------------------------------------------------------------ */
/* Orders — import only (WC -> local invoice)                           */
/* ------------------------------------------------------------------ */
async function importOrders(ranBy: number | null, days = 30): Promise<SyncResult> {
  const res: SyncResult = { op: 'orders.in', direction: 'in', imported: 0, updated: 0, skipped: 0, failed: 0, errors: [] };
  const client = await wcClient();
  const after = new Date(Date.now() - Math.max(1, Math.min(365, days)) * 86400_000).toISOString();
  const orders = await client.getAll<WcOrder>('/orders', { after, orderby: 'date', order: 'desc' });

  const operator = await resolveOperator(ranBy);
  if (!operator && orders.length > 0) {
    res.failed = orders.length;
    res.errors.push({ ref: 'system', reason: 'No active cashier/manager employee found for order entry' });
    await logSync(poolAsQueryable(), res, ranBy);
    return res;
  }

  for (const o of orders) {
    if (!IMPORTABLE_ORDER_STATUSES.includes(o.status)) { res.skipped += 1; continue; }
    try {
      const linked = await queryOne<any>(`SELECT invoice_id FROM wc_order_links WHERE wc_order_id = $1`, [o.id]);
      if (linked) { res.skipped += 1; continue; }

      const lines: { itemId: number; quantity: number }[] = [];
      for (const li of o.line_items ?? []) {
        const item = await queryOne<any>(
          `SELECT * FROM items WHERE wc_product_id = $1 OR code = $2 LIMIT 1`, [li.product_id, li.sku]);
        if (!item) throw httpError(422, `orders.skip:${o.id}:missing item ${li.sku || li.product_id}`);
        lines.push({ itemId: item.id, quantity: Math.floor(li.quantity || 1) });
      }

      const email = String(o.billing?.email || '').trim().toLowerCase() || null;
      let customerId: number | null = null;
      if (email || o.billing?.phone) {
        let cust = email
          ? await queryOne<any>(`SELECT * FROM customers WHERE LOWER(email) = $1`, [email])
          : null;
        if (!cust && o.customer_id) {
          cust = await queryOne<any>(`SELECT * FROM customers WHERE wc_customer_id = $1`, [o.customer_id]);
        }
        if (!cust) {
          const name = [o.billing?.first_name, o.billing?.last_name].filter(Boolean).join(' ').trim() || 'عميل متجر';
          const r = await queryOne<any>(
            `INSERT INTO customers (name, phone, email, address, notes, created_by, wc_customer_id)
             VALUES ($1,$2,$3,$4,'Created from WooCommerce order',$5,$6) RETURNING *`,
            [name, o.billing?.phone?.trim() || null, email,
             [o.billing?.address_1, o.billing?.city].filter(Boolean).join('، ') || null,
             operator!.employee.id, o.customer_id || null],
          );
          customerId = r.id;
        } else {
          customerId = cust.id;
          if (o.customer_id && !cust.wc_customer_id) {
            await query(`UPDATE customers SET wc_customer_id = $1 WHERE id = $2`, [o.customer_id, cust.id]);
          }
        }
      }

      const paymentMethod = await resolvePaymentMethod(poolAsQueryable(), o.payment_method_title);
      const paid = Number(o.total);
      const inv = await tx(async (q) =>
        buildInvoice(q, {
          items: lines,
          paymentMethod,
          paidAmount: paid > 0 ? paid : undefined,
          customerId,
        }, operator!.employee.id, operator!.cashier, false));

      await query(`INSERT INTO wc_order_links (wc_order_id, invoice_id) VALUES ($1,$2)`, [o.id, inv.id]);
      await audit(poolAsQueryable(), 'invoices', inv.id, 'create', operator!.employee.id, null, { source: 'woocommerce', orderId: o.id, orderNumber: o.number });
      res.imported += 1;
    } catch (e: any) {
      res.failed += 1;
      res.errors.push({ ref: o.number || o.id, reason: (e?.message || String(e)).slice(0, 300) });
    }
  }
  await logSync(poolAsQueryable(), res, ranBy);
  return res;
}

async function resolveOperator(ranBy: number | null): Promise<{ employee: any; cashier: any } | null> {
  if (ranBy) {
    const emp = await queryOne<any>(`SELECT * FROM employees WHERE id = $1 AND status = 'active'`, [ranBy]);
    if (emp) return { employee: emp, cashier: emp };
    return null;
  }
  const emp = await queryOne<any>(
    `SELECT e.* FROM employees e JOIN roles r ON r.id = e.role_id
      WHERE e.status = 'active' AND r.code IN ('manager','cashier') ORDER BY e.id LIMIT 1`);
  return emp ? { employee: emp, cashier: emp } : null;
}

/* ------------------------------------------------------------------ */
/* Logs + manual trigger + scheduler entry                              */
/* ------------------------------------------------------------------ */
woocommerceRouter.get('/logs', async (req, res) => {
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50)));
  const rows = await query(
    `SELECT l.*, e.full_name AS ran_by_name FROM wc_sync_log l
      LEFT JOIN employees e ON e.id = l.ran_by
     ORDER BY l.created_at DESC LIMIT $1`, [limit]);
  res.json(camelizeRows(rows));
});

let autoSyncRunning = false;
let lastAutoRun = 0;

/** Run the enabled auto-sync ops once. Returns null when disabled/busy/too soon. */
export async function runAutoSync(ranBy?: number): Promise<SyncResult[] | null> {
  const settings = await readAutoSyncSettings();
  if (!settings.enabled) return null;
  const now = Date.now();
  if (now - lastAutoRun < settings.intervalMin * 60_000) return null;
  if (autoSyncRunning) return null;
  autoSyncRunning = true;
  lastAutoRun = now;
  try {
    const results: SyncResult[] = [];
    for (const op of settings.ops) {
      if (!(AUTO_SYNC_OPS as readonly string[]).includes(op as any)) continue;
      results.push(await runSyncOp(op as any, ranBy ?? null));
    }
    return results;
  } finally {
    autoSyncRunning = false;
  }
}

export async function runSyncOp(op: string, ranBy: number | null): Promise<SyncResult> {
  switch (op) {
    case 'products.in': return importProducts(ranBy);
    case 'stock.push': return exportProducts(ranBy);
    case 'customers.in': return importCustomers(ranBy);
    case 'customers.out': return exportCustomers(ranBy);
    case 'orders.in': return importOrders(ranBy, 30);
    default: throw httpError(400, `bad.op:${op}`);
  }
}

/* ------------------------------------------------------------------ */
/* Route handlers (manual actions)                                      */
/* ------------------------------------------------------------------ */
async function runManual(handler: (ranBy: number | null) => Promise<SyncResult>, req: any, res: any) {
  try {
    const result = await handler(req.employee!.id);
    res.json(result);
  } catch (e: any) {
    const status = e.status || e.response?.status || 500;
    const detail = e.response?.data?.message || e.message || 'error';
    if (status >= 500) console.error('[wc sync]', e);
    res.status(status).json({ error: String(detail) });
  }
}

woocommerceRouter.post('/products/import', async (req, res) => {
  const dryRun = req.body?.dryRun === true;
  await runManual((id) => importProducts(id, dryRun), req, res);
});

woocommerceRouter.post('/products/export', async (req, res) => {
  await runManual((id) => exportProducts(id), req, res);
});

woocommerceRouter.post('/customers/import', async (req, res) => {
  await runManual((id) => importCustomers(id), req, res);
});

woocommerceRouter.post('/customers/export', async (req, res) => {
  await runManual((id) => exportCustomers(id), req, res);
});

woocommerceRouter.post('/orders/import', async (req, res) => {
  const days = Number(req.body?.days ?? 30);
  await runManual((id) => importOrders(id, days), req, res);
});

woocommerceRouter.post('/run-auto', async (req, res) => {
  const results = await runAutoSync(req.employee!.id);
  if (results === null) {
    return res.status(200).json({ busy: autoSyncRunning, results: [] });
  }
  res.json({ busy: false, results });
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
