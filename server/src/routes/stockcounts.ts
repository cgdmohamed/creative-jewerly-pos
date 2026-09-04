import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit, todayLocal } from '../utils.js';

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

  const row = await tx(async (q) => {
    const r = await q.queryOne<any>(
      `INSERT INTO stock_counts (location_id, started_by, notes)
       VALUES ($1,$2,$3) RETURNING *`,
      [locationId, req.employee!.id, notes || null],
    );
    const expected = await q.query<any>(
      `INSERT INTO stock_count_items (stock_count_id, item_id, expected_qty, counted_status)
       SELECT $1, id, available_qty, 'missing'
         FROM items
        WHERE current_location_id = $2 AND is_active AND status = 'available'
       RETURNING item_id`,
      [r.id, locationId],
    );
    await audit(q, 'stock_counts', r.id, 'create', req.employee!.id, null, { locationId, expected: expected.length });
    return r;
  });
  res.status(201).json(camelize(row));
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
            COALESCE(sci.counted_status, 'missing') AS counted_status,
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

  const existing = await queryOne<any>(
    `SELECT id, expected_qty FROM stock_count_items
      WHERE stock_count_id = $1 AND item_id = $2`, [id, itemId]);

  if (existing) {
    const cq = countedQty != null ? Number(countedQty) : countedStatus === 'missing' ? 0 : existing.expected_qty;
    const st = cq < existing.expected_qty ? 'missing' : cq > existing.expected_qty ? 'unexpected' : 'found';
    await query(
      `UPDATE stock_count_items
          SET counted_qty = $1, counted_status = $2, counted_by = $3, counted_at = now()
        WHERE id = $4`,
      [cq, st, req.employee!.id, existing.id]);
  } else {
    // Unexpected: physically present but not in the expected list
    const cq = countedQty != null ? Number(countedQty) : 1;
    await query(
      `INSERT INTO stock_count_items (stock_count_id, item_id, expected_qty, counted_qty, counted_status, counted_by)
       VALUES ($1,$2,0,$3,'unexpected',$4)`,
      [id, itemId, cq, req.employee!.id]);
  }
  res.json({ ok: true });
});

// Complete the count and generate the discrepancy report
stockCountsRouter.post('/:id/complete', requirePermission('stockcount.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const sc = await queryOne<any>(`SELECT * FROM stock_counts WHERE id = $1`, [id]);
  if (!sc) return res.status(404).json({ error: 'notfound' });
  if (sc.status !== 'in_progress') return res.status(409).json({ error: 'stockcount.not_open' });

  await tx(async (q) => {
    await q.query(
      `UPDATE stock_counts SET status='completed', completed_at=now(), completed_by=$1 WHERE id=$2`,
      [req.employee!.id, id]);
    await audit(q, 'stock_counts', id, 'complete', req.employee!.id, sc, {});
  });
  res.json({ ok: true });
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
