import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit, todayLocal } from '../utils.js';

export const pricesRouter = Router();

pricesRouter.use(authenticate);

// Active prices for a given date (today by default)
pricesRouter.get('/active', async (req, res) => {
  const date = (req.query.date as string) || todayLocal();
  const rows = await query(
    `SELECT ph.*, e.full_name AS entered_by_name
       FROM price_history ph
       LEFT JOIN employees e ON e.id = ph.entered_by
      WHERE ph.effective_date = $1 AND ph.end_date IS NULL
      ORDER BY ph.metal_type, ph.carat`,
    [date],
  );
  res.json(camelizeRows(rows));
});

pricesRouter.get('/history', async (req, res) => {
  const rows = await query(
    `SELECT ph.*, e.full_name AS entered_by_name
       FROM price_history ph
       LEFT JOIN employees e ON e.id = ph.entered_by
      ORDER BY ph.effective_date DESC, ph.created_at DESC
      LIMIT 500`,
  );
  res.json(camelizeRows(rows));
});

// Set today's price (append-only): close the previous active row, open a new one
pricesRouter.post('/', requirePermission('pricing.set'), async (req, res) => {
  const { metalType, carat, pricePerGram } = req.body ?? {};
  if (!metalType || !['gold', 'silver'].includes(metalType) || pricePerGram == null) {
    return res.status(400).json({ error: 'missing' });
  }
  const today = todayLocal();

  const row = await tx(async (q) => {
    const existing = await q.queryOne<any>(
      `SELECT id FROM price_history
        WHERE metal_type = $1 AND COALESCE(carat,'') = COALESCE($2,'')
          AND effective_date = $3 AND end_date IS NULL`,
      [metalType, carat || null, today],
    );
    if (existing) {
      await q.query(
        `UPDATE price_history SET end_date = $1
          WHERE id = $2`,
        [today, existing.id],
      );
    }
    const r = await q.queryOne<any>(
      `INSERT INTO price_history (metal_type, carat, price_per_gram, effective_date, entered_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [metalType, carat || null, pricePerGram, today, req.employee!.id],
    );
    await audit(q, 'price_history', r.id, 'set', req.employee!.id, null, r);
    return r;
  });
  res.status(201).json(camelize(row));
});
