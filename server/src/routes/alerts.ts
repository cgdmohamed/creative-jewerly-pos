import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { camelizeRows } from '../utils.js';

export const alertsRouter = Router();
alertsRouter.use(authenticate);

// System alerts for the dashboard: things the manager should review.
alertsRouter.get('/', async (_req, res) => {
  const alerts: any[] = [];

  // 1. Open (not-yet-ended) shifts
  const openShifts = await query(
    `SELECT s.id, s.opened_at, e.full_name AS employee_name, l.name_ar AS location_name
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
       JOIN locations l ON l.id = s.location_id
      WHERE s.status = 'open' ORDER BY s.opened_at`);
  if (openShifts.length) {
    alerts.push({ key: 'open_shifts', severity: 'warning', count: openShifts.length, link: '/shifts', detail: camelizeRows(openShifts) });
  }

  // 2. Stock counts started but never completed
  const openCounts = await query(
    `SELECT sc.id, sc.started_at, l.name_ar AS location_name, e.full_name AS started_by_name
       FROM stock_counts sc
       JOIN locations l ON l.id = sc.location_id
       LEFT JOIN employees e ON e.id = sc.started_by
      WHERE sc.status = 'in_progress' ORDER BY sc.started_at`);
  if (openCounts.length) {
    alerts.push({ key: 'open_stock_counts', severity: 'warning', count: openCounts.length, link: '/stock-counts', detail: camelizeRows(openCounts) });
  }

  // 3. Items imported with a placeholder weight — must set the real weight
  //    before they can be sold at the correct price.
  const placeholderCount = await queryOne<{ n: string }>(
    `SELECT count(*) AS n FROM items
      WHERE is_active AND notes LIKE '%' || (SELECT 'الوزن الافتراضي') || '%'`);
  const placeholder = await query(
    `SELECT id, code, name, weight_g, carat, quantity
       FROM items
      WHERE is_active AND notes LIKE '%' || (SELECT 'الوزن الافتراضي') || '%'
      ORDER BY id LIMIT 50`);
  if (placeholderCount?.n) {
    alerts.push({ key: 'placeholder_weight', severity: 'high', count: Number(placeholderCount.n), link: '/items', detail: camelizeRows(placeholder) });
  }

  // 4. Available items with no today's price — cannot be sold in the POS.
  const noPriceCount = await queryOne<{ n: string }>(
    `SELECT count(*) AS n
       FROM items i
      WHERE i.is_active AND i.status = 'available' AND i.available_qty > 0
        AND NOT EXISTS (
          SELECT 1 FROM price_history p
           WHERE p.metal_type = i.metal_type
             AND COALESCE(p.carat,'') = COALESCE(i.carat,'')
             AND p.effective_date = CURRENT_DATE AND p.end_date IS NULL
        )`);
  const noPrice = await query(
    `SELECT i.id, i.code, i.name, i.metal_type, i.carat, i.available_qty
       FROM items i
      WHERE i.is_active AND i.status = 'available' AND i.available_qty > 0
        AND NOT EXISTS (
          SELECT 1 FROM price_history p
           WHERE p.metal_type = i.metal_type
             AND COALESCE(p.carat,'') = COALESCE(i.carat,'')
             AND p.effective_date = CURRENT_DATE AND p.end_date IS NULL
        )
      ORDER BY i.id LIMIT 50`);
  if (noPriceCount?.n) {
    alerts.push({ key: 'no_price_today', severity: 'high', count: Number(noPriceCount.n), link: '/pricing', detail: camelizeRows(noPrice) });
  }

  res.json({ alerts, updatedAt: new Date().toISOString() });
});
