import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus, todayLocal } from '../utils.js';

export const stockCountsRouter = Router();

stockCountsRouter.use(authenticate);

// List stock count sessions
stockCountsRouter.get('/', async (req, res) => {
  const rows = await query(
    `SELECT sc.*, l.name_ar AS location_name, e.full_name AS started_by_name
       FROM stock_counts sc
       JOIN locations l ON l.id = sc.location_id
       LEFT JOIN employees e ON e.id = sc.started_by
      ORDER BY sc.started_at DESC LIMIT 200`,
  );
  res.json(camelizeRows(rows));
});

// Start a count: snapshot the expected list for a location
stockCountsRouter.post('/', requirePermission('stockcount.manage'), async (req, res) => {
  const { locationId, notes } = req.body ?? {};
  if (!locationId) return res.status(400).json({ error: 'missing:locationId' });

  try {
   const row = await tx(async (q) => {
    await q.query(`SELECT pg_advisory_xact_lock($1)`, [Number(locationId)]);
    const open = await q.queryOne<any>(
      `SELECT id FROM stock_counts WHERE location_id=$1 AND status='in_progress' FOR UPDATE`, [locationId]);
    if (open) throw Object.assign(new Error(`stockcount.already_open:${open.id}`), { status: 409 });
    const r = await q.queryOne<any>(
      `INSERT INTO stock_counts (location_id, started_by, notes)
       VALUES ($1,$2,$3) RETURNING *`,
      [locationId, req.employee!.id, notes || null],
    );
    const expected = await q.query<any>(
      `INSERT INTO stock_count_items (stock_count_id, item_id, expected_qty, counted_status, counted_at)
       SELECT $1, id, available_qty, 'unscanned', NULL
         FROM items
        WHERE current_location_id = $2 AND is_active AND status = 'available'
       RETURNING item_id`,
      [r.id, locationId],
    );
    await audit(q, 'stock_counts', r.id, 'create', req.employee!.id, null, { locationId, expected: expected.length });
    return r;
   });
   res.status(201).json(camelize(row));
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

// Expected list + current tallies
stockCountsRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const sc = await queryOne<any>(
    `SELECT sc.*, l.name_ar AS location_name, e.full_name AS started_by_name
       FROM stock_counts sc
       JOIN locations l ON l.id = sc.location_id
       LEFT JOIN employees e ON e.id = sc.started_by
      WHERE sc.id = $1`, [id]);
  if (!sc) return res.status(404).json({ error: 'notfound' });

  const expected = await query(
    `SELECT i.*, c.name_ar AS category_name,
            sci.expected_qty, sci.counted_qty,
            COALESCE(sci.counted_status, 'unscanned') AS counted_status,
            sci.counted_by, sci.counted_at
       FROM stock_count_items sci
       JOIN items i ON i.id = sci.item_id
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE sci.stock_count_id = $1
      ORDER BY i.code`, [id]);
  const extra = await query(
    `SELECT i.*, c.name_ar AS category_name, 'unexpected' AS counted_status
       FROM items i
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.current_location_id = $1 AND i.is_active AND i.status = 'available'
        AND i.id NOT IN (SELECT item_id FROM stock_count_items WHERE stock_count_id = $2)
      ORDER BY i.code`, [sc.location_id, id]);
  res.json({ ...camelize(sc), expected: camelizeRows(expected), extra: camelizeRows(extra) });
});

// Mark an item found / missing (or confirm an unexpected item). Accepts countedQty.
stockCountsRouter.post('/:id/items', requirePermission('stockcount.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const { itemId, countedStatus, countedQty } = req.body ?? {};
  if (!itemId) return res.status(400).json({ error: 'bad.request' });

  const cq = countedQty != null ? Number(countedQty) : countedStatus === 'missing' ? 0 : 1;
  if (!Number.isInteger(cq) || cq < 0) return res.status(400).json({ error: 'bad.countedQty' });
  try {
    await tx(async (q) => {
      const sc = await q.queryOne<any>(`SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE`, [id]);
      if (!sc) throw Object.assign(new Error('notfound'), { status: 404 });
      if (sc.status !== 'in_progress') throw Object.assign(new Error('stockcount.not_open'), { status: 409 });
      const item = await q.queryOne<any>(
        `SELECT * FROM items WHERE id=$1 AND is_active AND current_location_id=$2 FOR UPDATE`, [itemId, sc.location_id]);
      if (!item) throw Object.assign(new Error('stockcount.item_wrong_location'), { status: 409 });
      const existing = await q.queryOne<any>(
        `SELECT id, expected_qty FROM stock_count_items WHERE stock_count_id=$1 AND item_id=$2 FOR UPDATE`, [id, itemId]);
      if (existing) {
        const st = cq < Number(existing.expected_qty) ? 'missing' : cq > Number(existing.expected_qty) ? 'unexpected' : 'found';
        await q.query(`UPDATE stock_count_items SET counted_qty=$1,counted_status=$2,counted_by=$3,counted_at=now() WHERE id=$4`,
          [cq, st, req.employee!.id, existing.id]);
      } else {
        if (cq < 1) throw Object.assign(new Error('bad.countedQty'), { status: 400 });
        await q.query(`INSERT INTO stock_count_items
          (stock_count_id,item_id,expected_qty,counted_qty,counted_status,counted_by,counted_at)
          VALUES ($1,$2,0,$3,'unexpected',$4,now())`, [id, itemId, cq, req.employee!.id]);
      }
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

// Complete the count and generate the discrepancy report
stockCountsRouter.post('/:id/complete', requirePermission('stockcount.manage'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await tx(async (q) => {
      const sc = await q.queryOne<any>(`SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE`, [id]);
      if (!sc) throw Object.assign(new Error('notfound'), { status: 404 });
      if (sc.status !== 'in_progress') throw Object.assign(new Error('stockcount.not_open'), { status: 409 });
      const unscanned = await q.queryOne<any>(
        `SELECT count(*)::int AS n FROM stock_count_items WHERE stock_count_id=$1 AND counted_status='unscanned'`, [id]);
      if (Number(unscanned?.n) > 0) {
        throw Object.assign(new Error(`stockcount.unscanned:${unscanned.n}`), { status: 409 });
      }
      await q.query(`UPDATE stock_counts SET status='completed',completed_at=now(),completed_by=$1 WHERE id=$2`,
        [req.employee!.id, id]);
      await audit(q, 'stock_counts', id, 'complete', req.employee!.id, sc, {});
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

stockCountsRouter.post('/:id/cancel', requirePermission('stockcount.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'stockcount.cancel_reason_required' });
  try {
    await tx(async (q) => {
      const sc = await q.queryOne<any>(`SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE`, [id]);
      if (!sc) throw Object.assign(new Error('notfound'), { status: 404 });
      if (sc.status !== 'in_progress') throw Object.assign(new Error('stockcount.not_open'), { status: 409 });
      await q.query(`UPDATE stock_counts SET status='cancelled',completed_at=now(),completed_by=$1,
        notes=CONCAT_WS(' | ',notes,$2) WHERE id=$3`, [req.employee!.id, `Cancelled: ${reason}`, id]);
      await audit(q, 'stock_counts', id, 'cancel', req.employee!.id, sc, { reason });
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

stockCountsRouter.post('/:id/apply', requirePermission('stockcount.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const reason = String(req.body?.reason || '').trim();
  if (!reason) return res.status(400).json({ error: 'stockcount.apply_reason_required' });
  try {
    await tx(async (q) => {
      const sc = await q.queryOne<any>(`SELECT * FROM stock_counts WHERE id=$1 FOR UPDATE`, [id]);
      if (!sc) throw Object.assign(new Error('notfound'), { status: 404 });
      if (sc.status !== 'completed') throw Object.assign(new Error('stockcount.not_completed'), { status: 409 });
      const rows = await q.query<any>(`SELECT * FROM stock_count_items WHERE stock_count_id=$1 AND counted_qty<>expected_qty ORDER BY item_id FOR UPDATE`, [id]);
      for (const row of rows) {
        const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1 FOR UPDATE`, [row.item_id]);
        if (!item || Number(item.reserved_qty) > 0 || Number(item.in_transit_qty) > 0 || item.current_location_id !== sc.location_id) {
          throw Object.assign(new Error(`stockcount.item_changed:${row.item_id}`), { status: 409 });
        }
        const before = Number(item.quantity);
        if (before !== Number(row.expected_qty)) {
          throw Object.assign(new Error(`stockcount.item_changed:${row.item_id}`), { status: 409 });
        }
        const after = Number(row.counted_qty);
        const status = deriveStatus(after, 0, 0);
        await q.query(`UPDATE items SET quantity=$1,status=$2,updated_at=now() WHERE id=$3`, [after, status, item.id]);
        await q.query(`INSERT INTO inventory_adjustments
          (item_id,stock_count_id,quantity_before,quantity_delta,quantity_after,reason,created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [item.id, id, before, after-before, after, reason, req.employee!.id]);
        await q.query(`INSERT INTO item_status_history (item_id,from_status,to_status,reason,changed_by)
          VALUES ($1,$2,$3,$4,$5)`, [item.id, item.status, status, `Stock count #${id}: ${reason}`, req.employee!.id]);
      }
      await q.query(`UPDATE stock_counts SET status='applied',applied_at=now(),applied_by=$1 WHERE id=$2`, [req.employee!.id, id]);
      await audit(q, 'stock_counts', id, 'apply', req.employee!.id, sc, { reason, adjustments: rows.length });
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

// Discrepancy report (missing/unexpected) valued at today's price
stockCountsRouter.get('/:id/report', async (req, res) => {
  const id = Number(req.params.id);
  const sc = await queryOne<any>(
    `SELECT sc.*, l.name_ar AS location_name FROM stock_counts sc
      JOIN locations l ON l.id = sc.location_id WHERE sc.id = $1`, [id]);
  if (!sc) return res.status(404).json({ error: 'notfound' });

  const today = todayLocal();
  const diffRows = await query(
    `SELECT i.code, i.name, i.metal_type, i.carat, i.weight_g,
            sci.expected_qty, sci.counted_qty,
            (sci.counted_qty - sci.expected_qty) AS diff_qty,
            COALESCE(ph.price_per_gram,0) AS price_per_gram,
            ROUND((sci.counted_qty - sci.expected_qty) * i.weight_g * COALESCE(ph.price_per_gram,0), 2) AS metal_value
       FROM stock_count_items sci
       JOIN items i ON i.id = sci.item_id
       LEFT JOIN price_history ph ON ph.metal_type = i.metal_type
         AND COALESCE(ph.carat,'') = COALESCE(i.carat,'')
         AND ph.effective_date = $2 AND ph.end_date IS NULL
      WHERE sci.stock_count_id = $1 AND (sci.counted_qty - sci.expected_qty) <> 0
      ORDER BY i.code`, [id, today]);
  const missing = diffRows
    .filter((r: any) => Number(r.diff_qty) < 0)
    .map((r: any) => ({ ...r, countedStatus: 'missing' }));
  const extra = diffRows
    .filter((r: any) => Number(r.diff_qty) > 0)
    .map((r: any) => ({ ...r, countedStatus: 'unexpected' }));
  const totals = await query(
    `SELECT CASE WHEN (sci.counted_qty - sci.expected_qty) < 0 THEN 'missing' ELSE 'unexpected' END AS counted_status,
            SUM(ABS(sci.counted_qty - sci.expected_qty)) AS count,
            ROUND(SUM((sci.counted_qty - sci.expected_qty) * i.weight_g * COALESCE(ph.price_per_gram,0)), 2) AS total_value
       FROM stock_count_items sci
       JOIN items i ON i.id = sci.item_id
       LEFT JOIN price_history ph ON ph.metal_type = i.metal_type
         AND COALESCE(ph.carat,'') = COALESCE(i.carat,'')
         AND ph.effective_date = $2 AND ph.end_date IS NULL
      WHERE sci.stock_count_id = $1 AND (sci.counted_qty - sci.expected_qty) <> 0
      GROUP BY 1`, [id, today]);
  res.json({
    ...camelize(sc),
    missing: camelizeRows(missing),
    extra: camelizeRows(extra),
    totals: camelizeRows(totals),
  });
});
