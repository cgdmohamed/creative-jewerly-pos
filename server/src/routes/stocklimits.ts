import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { camelize, camelizeRows } from '../utils.js';

export const stockLimitsRouter = Router();

stockLimitsRouter.use(authenticate);

stockLimitsRouter.get('/', async (_req, res) => {
  res.json(camelizeRows(await query(`SELECT * FROM stock_limits ORDER BY location_id, metal_type, carat`)));
});

stockLimitsRouter.post('/', requirePermission('stockcount.manage'), async (req, res) => {
  const { locationId, metalType, carat, minQty, maxQty } = req.body ?? {};
  if (!locationId || !metalType) return res.status(400).json({ error: 'missing' });
  const row = await query(
    `INSERT INTO stock_limits (location_id, metal_type, carat, min_qty, max_qty)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (location_id, metal_type, carat)
     DO UPDATE SET min_qty = EXCLUDED.min_qty, max_qty = EXCLUDED.max_qty
     RETURNING *`,
    [locationId, metalType, carat || null, Number(minQty ?? 0), maxQty != null ? Number(maxQty) : null],
  );
  res.json(camelize(row[0]));
});

stockLimitsRouter.delete('/:id', requirePermission('stockcount.manage'), async (req, res) => {
  await query(`DELETE FROM stock_limits WHERE id = $1`, [Number(req.params.id)]);
  res.json({ ok: true });
});
