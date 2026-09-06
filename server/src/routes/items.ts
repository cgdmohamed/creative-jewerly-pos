import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus } from '../utils.js';
import { config } from '../config.js';

export const itemsRouter = Router();

// Marker used by the WooCommerce importer for weight-less products imported
// with a 1g placeholder. Cleared here once a real weight is set.
const PLACEHOLDER_MARKER = 'الوزن الافتراضي';

fs.mkdirSync(config.uploadDir, { recursive: true });
const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _f, cb) => cb(null, config.uploadDir),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `item-${Date.now()}-${Math.round(Math.random() * 1e6)}${ext}`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const okMime = ['image/jpeg', 'image/png', 'image/webp'];
    const okExt = /\.(jpe?g|png|webp)$/i.test(path.extname(file.originalname) || '');
    if (!okMime.includes(file.mimetype) || !okExt) {
      const err: any = new Error('file.type');
      err.status = 400;
      err.expose = true;
      return cb(err);
    }
    cb(null, true);
  },
});

itemsRouter.use(authenticate);

export const ITEM_SELECT = `
  SELECT i.*, c.code AS category_code, c.name_ar AS category_name,
         l.code AS location_code, l.name_ar AS location_name,
         e.full_name AS created_by_name,
         ('99' || LPAD(i.id::text, 6, '0')) AS label_code,
         (i.notes IS NOT NULL AND i.notes LIKE '%' || '${PLACEHOLDER_MARKER}' || '%') AS needs_review
    FROM items i
    LEFT JOIN categories c ON c.id = i.category_id
    LEFT JOIN locations l ON l.id = i.current_location_id
    LEFT JOIN employees e ON e.id = i.created_by`;

itemsRouter.get('/', async (req, res) => {
  const { locationId, status, metalType, search, includeInactive, categoryId, needsReview } = req.query;
  const conds: string[] = [`i.is_active = TRUE`];
  const params: any[] = [];
  if (locationId) { params.push(Number(locationId)); conds.push(`i.current_location_id = $${params.length}`); }
  if (status) { params.push(String(status)); conds.push(`i.status = $${params.length}`); }
  if (metalType) { params.push(String(metalType)); conds.push(`i.metal_type = $${params.length}`); }
  if (categoryId) { params.push(Number(categoryId)); conds.push(`i.category_id = $${params.length}`); }
  if (needsReview === 'true') {
    conds.push(`i.notes ILIKE '%' || '${PLACEHOLDER_MARKER}' || '%'`);
  }
  if (search) {
    const value = String(search).trim();
    params.push(`%${value}%`);
    const textParam = params.length;
    const labelMatch = /^99(\d{6,})$/.exec(value);
    const labelItemId = labelMatch ? Number(labelMatch[1]) : NaN;
    if (Number.isInteger(labelItemId) && labelItemId > 0 && labelItemId <= 2_147_483_647) {
      params.push(labelItemId);
      conds.push(`(i.code ILIKE $${textParam} OR i.barcode ILIKE $${textParam} OR i.name ILIKE $${textParam} OR i.description ILIKE $${textParam} OR i.id = $${params.length})`);
    } else {
      conds.push(`(i.code ILIKE $${textParam} OR i.barcode ILIKE $${textParam} OR i.name ILIKE $${textParam} OR i.description ILIKE $${textParam})`);
    }
  }
  if (includeInactive === 'true') conds[0] = `TRUE`;
  const rows = await query(
    `${ITEM_SELECT} WHERE ${conds.join(' AND ')} ORDER BY i.code`, params);
  res.json(camelizeRows(rows));
});

itemsRouter.get('/:id', async (req, res) => {
  const row = await queryOne<any>(`${ITEM_SELECT} WHERE i.id = $1`, [Number(req.params.id)]);
  if (!row) return res.status(404).json({ error: 'notfound' });
  res.json(camelize(row));
});

// Full audit trail for a single piece (its "life story")
itemsRouter.get('/:id/audit', async (req, res) => {
  const id = Number(req.params.id);
  const statuses = await query(
    `SELECT sh.*, e.full_name AS changed_by_name
       FROM item_status_history sh LEFT JOIN employees e ON e.id = sh.changed_by
      WHERE sh.item_id = $1 ORDER BY sh.changed_at`, [id]);
  const movements = await query(
    `SELECT m.*, fl.name_ar AS from_location, tl.name_ar AS to_location,
            em.full_name AS moved_by_name, er.full_name AS received_by_name
       FROM item_movements m
       LEFT JOIN locations fl ON fl.id = m.from_location_id
       LEFT JOIN locations tl ON tl.id = m.to_location_id
       LEFT JOIN employees em ON em.id = m.moved_by
       LEFT JOIN employees er ON er.id = m.received_by
      WHERE m.item_id = $1 ORDER BY m.moved_at`, [id]);
  const sales = await query(
    `SELECT ii.invoice_id, inv.invoice_no, ii.metal_price_snapshot, ii.line_total,
            inv.created_at, e.full_name AS cashier_name, inv.status AS invoice_status
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN employees e ON e.id = inv.employee_id
      WHERE ii.item_id = $1 ORDER BY inv.created_at`, [id]);
  const reservations = await query(
    `SELECT r.*, e.full_name AS reserved_by_name
       FROM reservations r LEFT JOIN employees e ON e.id = r.reserved_by
      WHERE r.item_id = $1 ORDER BY r.reserved_at`, [id]);
  res.json({
    statuses: camelizeRows(statuses),
    movements: camelizeRows(movements),
    sales: camelizeRows(sales),
    reservations: camelizeRows(reservations),
  });
});

itemsRouter.post('/', requirePermission('inventory.manage'), async (req, res) => {
  const b = req.body ?? {};
  const kind = b.productKind === 'general' ? 'general' : 'jewelry';
  // Jewelry is priced from weight × daily metal price; general products
  // (watches, gifts…) carry a fixed sale price instead.
  const required = kind === 'jewelry' ? ['code', 'metalType', 'weightG'] : ['code', 'salePrice'];
  const missing = required.filter((k) => b[k] === undefined || b[k] === '' || b[k] === null);
  if (missing.length) return res.status(400).json({ error: `missing:${missing.join(',')}` });

  try {
    const row = await tx(async (q) => {
      const quantity = Number(b.quantity ?? 1);
      const status = quantity <= 0 ? 'sold' : b.status ?? 'available';
      const locationId = b.locationId ?? b.currentLocationId ?? null;
      const minQty = Math.max(0, Math.round(Number(b.minQty ?? 0)));
      const maxQty = b.maxQty != null ? Math.max(minQty, Math.round(Number(b.maxQty))) : null;
      const r = await q.queryOne<any>(
        `INSERT INTO items
           (code, barcode, name, description, photo_url, category_id, size,
            metal_type, carat, weight_g, stone_weight_g,
            craftsmanship_type, craftsmanship_value, cost, metal_price_at_add,
            source_supplier, source_origin, status, physical_status, notes,
            manufacturing_variance_g, quantity, current_location_id, created_by,
            min_qty, max_qty, product_kind, sale_price)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
         RETURNING *`,
        [
          b.code, b.barcode || null, b.name || null, b.description || null, b.photoUrl || null,
          b.categoryId || null, b.size || null,
          kind === 'jewelry' ? b.metalType : null, kind === 'jewelry' ? b.carat || null : null,
          kind === 'jewelry' ? b.weightG : null, b.stoneWeightG ?? 0,
          b.craftsmanshipType ?? 'fixed', b.craftsmanshipValue ?? 0,
          b.cost ?? null, b.metalPriceAtAdd ?? null, b.sourceSupplier || null,
          b.sourceOrigin || null, status, b.physicalStatus ?? 'new',
          b.notes || null, b.manufacturingVarianceG ?? 0, quantity, locationId, req.employee!.id,
          minQty, maxQty, kind,
          kind === 'general' && Number(b.salePrice) > 0 ? Number(b.salePrice) : null,
        ],
      );
      if (r.status !== 'available') {
        await q.query(
          `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
           VALUES ($1,NULL,$2,$3,$4)`,
          [r.id, r.status, 'Initial state', req.employee!.id]);
      }
      await audit(q, 'items', r.id, 'create', req.employee!.id, null, { ...b, quantity });
      return r;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

itemsRouter.put('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM items WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });
  const b = req.body ?? {};

  // A real weight from the manager clears the importer's placeholder marker
  // so the "needs review" alert disappears and price push is re-enabled.
  let notesValue = b.notes != null ? String(b.notes) : (old.notes ?? null);
  if (b.weightG != null && notesValue && notesValue.includes(PLACEHOLDER_MARKER)) {
    const stripped = notesValue
      .replace(new RegExp(`\\s*\\|\\s*${PLACEHOLDER_MARKER}\\s*`, 'g'), ' | ')
      .replace(/\s*\|\s*$/, '')
      .trim();
    notesValue = stripped || null;
  }

  const updated = await tx(async (q) => {
    const locationId = b.locationId ?? b.currentLocationId ?? null;
    const minQty = b.minQty != null ? Math.max(0, Math.round(Number(b.minQty))) : null;
    const maxQty = b.maxQty != null ? Math.max(minQty ?? 0, Math.round(Number(b.maxQty))) : null;
    const r = await q.queryOne<any>(
      `UPDATE items SET
         barcode = COALESCE($2, barcode), name = COALESCE($3, name),
         description = COALESCE($4, description), category_id = COALESCE($5, category_id),
         size = COALESCE($6, size), carat = COALESCE($7, carat),
         weight_g = COALESCE($8, weight_g), stone_weight_g = COALESCE($9, stone_weight_g),
         craftsmanship_type = COALESCE($10, craftsmanship_type),
         craftsmanship_value = COALESCE($11, craftsmanship_value),
         cost = COALESCE($12, cost), metal_price_at_add = COALESCE($13, metal_price_at_add),
         source_supplier = COALESCE($14, source_supplier),
         physical_status = COALESCE($15, physical_status),
         notes = COALESCE($16, notes),
         manufacturing_variance_g = COALESCE($17, manufacturing_variance_g),
         current_location_id = COALESCE($18, current_location_id),
         min_qty = COALESCE($19, min_qty), max_qty = COALESCE($20, max_qty),
         product_kind = COALESCE($21, product_kind),
         sale_price = COALESCE($22, sale_price),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, b.barcode ?? null, b.name ?? null, b.description ?? null, b.categoryId ?? null,
       b.size ?? null, b.carat ?? null, b.weightG ?? null, b.stoneWeightG ?? null,
       b.craftsmanshipType ?? null, b.craftsmanshipValue ?? null, b.cost ?? null,
       b.metalPriceAtAdd ?? null, b.sourceSupplier ?? null, b.physicalStatus ?? null,
       notesValue, b.manufacturingVarianceG ?? null, locationId, minQty, maxQty,
       b.productKind ?? null, Number(b.salePrice) > 0 ? Number(b.salePrice) : null],
    );

    if (b.quantity != null) {
      const quantity = Number(b.quantity);
      const status = deriveStatus(quantity, Number(old.reserved_qty ?? 0), Number(old.in_transit_qty ?? 0));
      await q.query(
        `UPDATE items SET quantity = $1, status = $2, updated_at = now() WHERE id = $3`,
        [quantity, status, id]);
      await q.query(
        `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
         VALUES ($1,$2,$3,$4,$5)`,
        [id, r.status, status, `Qty adjustment to ${quantity}`, req.employee!.id]);
    }

    const final = await q.queryOne<any>(`SELECT * FROM items WHERE id = $1`, [id]);
    await audit(q, 'items', id, 'update', req.employee!.id, old, final);
    return final;
  });
  res.json(camelize(updated));
});

itemsRouter.post('/:id/photo', requirePermission('inventory.manage'), upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'missing:file' });
  const id = Number(req.params.id);
  const url = `/uploads/${req.file.filename}`;
  await query(`UPDATE items SET photo_url = $1, updated_at = now() WHERE id = $2`, [url, id]);
  res.json({ photoUrl: url });
});

// Archive (soft-delete) / restore a piece — it disappears from POS & lists
// but keeps its history. active=false archives, active=true restores.
itemsRouter.post('/:id/archive', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const active = (req.body ?? {}).active !== false;
  const old = await queryOne<any>(`SELECT * FROM items WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });

  const r = await tx(async (q) => {
    const updated = await q.queryOne<any>(
      `UPDATE items SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *`, [id, active]);
    await q.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, old.status, old.status, active ? 'Restored from archive' : 'Archived', req.employee!.id]);
    await audit(q, 'items', id, active ? 'restore' : 'archive', req.employee!.id,
      { is_active: old.is_active }, { is_active: active });
    return updated;
  });
  res.json(camelize(r));
});

// Hard-delete only safe pieces: nothing may reference the item in invoices,
// reservations, stock movements or stock counts.
itemsRouter.delete('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM items WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });

  const refs = await queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM invoice_items   WHERE item_id = $1) AS invoices,
       (SELECT count(*)::int FROM reservations    WHERE item_id = $1) AS reservations,
       (SELECT count(*)::int FROM item_movements  WHERE item_id = $1) AS movements,
       (SELECT count(*)::int FROM stock_count_items WHERE item_id = $1) AS stock_counts`,
    [id]);
  if (refs && (refs.invoices + refs.reservations + refs.movements + refs.stock_counts) > 0) {
    return res.status(409).json({
      error: 'items.in_use',
      message: `لا يمكن حذف القطعة — مرتبطة بفواتير/حجوزات/حركات (${refs.invoices} فواتير، ${refs.reservations} حجوزات). يمكن أرشفتها بدلاً من ذلك.`,
      refs,
    });
  }

  await tx(async (q) => {
    await q.query(`DELETE FROM items WHERE id = $1`, [id]);
    await audit(q, 'items', id, 'delete', req.employee!.id, old, null);
  });
  res.json({ ok: true });
});

// Change item status with audit reason (e.g. reserved/sold/available)
itemsRouter.post('/:id/status', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const { status, reason } = req.body ?? {};
  const allowed = ['available', 'reserved', 'sold', 'in_transit'];
  if (!allowed.includes(status)) return res.status(400).json({ error: 'bad.status' });
  const item = await queryOne<any>(`SELECT status FROM items WHERE id = $1`, [id]);
  if (!item) return res.status(404).json({ error: 'notfound' });
  if (item.status === status) return res.json({ ok: true });

  await tx(async (q) => {
    await q.query(`UPDATE items SET status = $1, updated_at = now() WHERE id = $2`, [status, id]);
    await q.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [id, item.status, status, reason || null, req.employee!.id]);
    await audit(q, 'items', id, 'status_change', req.employee!.id, item, { status, reason });
  });
  res.json({ ok: true });
});
