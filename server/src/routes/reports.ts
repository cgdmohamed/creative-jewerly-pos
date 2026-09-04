import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query } from '../db.js';
import { camelize, camelizeRows, todayLocal } from '../utils.js';
import { getSalesOverview, getInventoryValue } from '../reportQueries.js';

export const reportsRouter = Router();

reportsRouter.use(authenticate, requirePermission('reports.view'));

const today = todayLocal;

// قيمة المخزون الإجمالية: (وزن × سعر اليوم) + المصنعية لكل قطعة متاحة، مقسّم حسب الفرع
reportsRouter.get('/inventory-value', async (_req, res) => {
  res.json(camelize(await getInventoryValue()));
});

// إحصاءات لوحة التحكم: مبيعات يومية (آخر 14 يومًا)، توزيع حسب المعدن وطريقة الدفع
reportsRouter.get('/sales-overview', async (_req, res) => {
  res.json(camelize(await getSalesOverview(14)));
});

// تقرير المدفوعات حسب طريقة الدفع مع فلاتر (تاريخ / طريقة / فرع)
reportsRouter.get('/payments', async (req, res) => {
  const { from, to, method, locationId } = req.query;
  const params: any[] = [];
  const conds: string[] = [`i.status = 'active'`];
  if (from) { params.push(String(from)); conds.push(`i.created_at >= $${params.length}::date`); }
  if (to) { params.push(String(to)); conds.push(`i.created_at < ($${params.length}::date + 1)`); }
  if (method) { params.push(String(method)); conds.push(`i.payment_method = $${params.length}`); }
  if (locationId) { params.push(Number(locationId)); conds.push(`i.location_id = $${params.length}`); }
  const where = conds.join(' AND ');

  const byMethod = await query(
    `SELECT pm.code, pm.name_ar, pm.color, pm.is_active,
            COUNT(i.id) AS count,
            COALESCE(ROUND(SUM(i.total),2),0) AS total,
            COALESCE(ROUND(SUM(i.total),2),0) AS collected
       FROM payment_methods pm
       LEFT JOIN invoices i ON i.payment_method = pm.code AND ${where}
      GROUP BY pm.code, pm.name_ar, pm.color, pm.is_active, pm.sort_order, pm.id
      ORDER BY pm.is_active DESC, pm.sort_order, pm.id`, params);
  const rows = await query(
    `SELECT i.id, i.invoice_no, i.created_at, i.payment_method, pm.name_ar AS payment_method_name,
            pm.color AS payment_method_color,
            i.metal_subtotal, i.craftsmanship_total, i.discount_amount, i.total,
            i.status, l.name_ar AS location_name, e.full_name AS cashier_name
       FROM invoices i
       LEFT JOIN payment_methods pm ON pm.code = i.payment_method
       LEFT JOIN locations l ON l.id = i.location_id
       LEFT JOIN employees e ON e.id = i.employee_id
      WHERE ${where}
      ORDER BY i.created_at DESC LIMIT 1000`, params);
  const summary = await query(
    `SELECT COALESCE(ROUND(SUM(total),2),0) AS total, COUNT(*) AS count,
            COALESCE(ROUND(SUM(total)/NULLIF(COUNT(*),0),2),0) AS avg_invoice
       FROM invoices i WHERE ${where}`, params);
  res.json({ byMethod: camelizeRows(byMethod), rows: camelizeRows(rows), summary: camelizeRows(summary)[0] });
});

// الربحية الحقيقية: (سعر بيع المعدن − سعر المعدن عند الإضافة) × الوزن + المصنعية المحصلة − التكلفة
reportsRouter.get('/profitability', async (req, res) => {
  const { from, to } = req.query;
  const params = [from || '1970-01-01', to || '2999-12-31'];
  const rows = await query(
    `SELECT inv.invoice_no, inv.created_at, e.full_name AS cashier_name,
            ii.item_code_snapshot, ii.item_name_snapshot, ii.metal_type_snapshot, ii.carat_snapshot,
            ii.weight_g_snapshot, ii.metal_price_snapshot, ii.metal_cost_price,
            ROUND(ii.weight_g_snapshot * (COALESCE(ii.metal_price_snapshot,0) - COALESCE(ii.metal_cost_price,0)), 2) AS metal_profit,
            ii.craftsmanship_snapshot AS craftsmanship_charged,
            COALESCE(ii.cost_snapshot,0) AS cost,
            ROUND(
              ii.weight_g_snapshot * (COALESCE(ii.metal_price_snapshot,0) - COALESCE(ii.metal_cost_price,0))
              + ii.craftsmanship_snapshot - COALESCE(ii.cost_snapshot,0), 2) AS profit,
            inv.status AS invoice_status
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
       LEFT JOIN employees e ON e.id = inv.employee_id
      WHERE inv.created_at::date >= $1::date AND inv.created_at::date <= $2::date
      ORDER BY inv.created_at DESC`, params);
  const summary = await query(
    `SELECT COALESCE(SUM(
              ii.weight_g_snapshot * (COALESCE(ii.metal_price_snapshot,0) - COALESCE(ii.metal_cost_price,0))
              + ii.craftsmanship_snapshot - COALESCE(ii.cost_snapshot,0)), 0) AS total_profit,
            COUNT(DISTINCT inv.id) AS invoice_count
       FROM invoice_items ii
       JOIN invoices inv ON inv.id = ii.invoice_id
      WHERE inv.created_at::date >= $1::date AND inv.created_at::date <= $2::date
        AND inv.status='active'`, params);
  res.json({ rows: camelizeRows(rows), summary: camelizeRows(summary)[0] });
});

// المخزون الراكد: قطع متاحة لم تُبع منذ N يوم (من الإعدادات)
reportsRouter.get('/slow-stock', async (req, res) => {
  const days = Number(req.query.days) || Number(
    (await query(`SELECT value FROM app_settings WHERE key='slow_stock_days'`))[0]?.value || 90);
  const rows = await query(
    `SELECT i.*, l.name_ar AS location_name, c.name_ar AS category_name,
            EXTRACT(DAY FROM (now() - i.created_at))::int AS days_in_stock
       FROM items i
       JOIN locations l ON l.id = i.current_location_id
       LEFT JOIN categories c ON c.id = i.category_id
      WHERE i.is_active AND i.status IN ('available','reserved')
        AND i.created_at < now() - make_interval(days => $1)
      ORDER BY i.created_at`, [days]);
  res.json({ days, rows: camelizeRows(rows) });
});

// حدود المخزون: كم قطعة متاحة لكل (فرع، معدن، عيار) مقابل الحدود الدنيا/القصوى
reportsRouter.get('/stock-limits', async (req, res) => {
  const rows = await query(
    `SELECT l.name_ar AS location_name, i.metal_type, i.carat,
            SUM(i.quantity) AS current_qty,
            COALESCE(sl.min_qty, 0) AS min_qty, sl.max_qty,
            CASE WHEN SUM(i.quantity) < COALESCE(sl.min_qty,0) THEN 'below'
                 WHEN sl.max_qty IS NOT NULL AND SUM(i.quantity) > sl.max_qty THEN 'above'
                 ELSE 'ok' END AS status
       FROM items i
       JOIN locations l ON l.id = i.current_location_id
       LEFT JOIN stock_limits sl ON sl.location_id = i.current_location_id
         AND sl.metal_type = i.metal_type AND COALESCE(sl.carat,'') = COALESCE(i.carat,'')
      WHERE i.is_active AND i.status = 'available'
      GROUP BY l.name_ar, i.metal_type, i.carat, sl.min_qty, sl.max_qty
      ORDER BY status DESC, l.name_ar`);
  res.json(camelizeRows(rows));
});

// فروقات الجرد من الجولات المكتملة (بالكميات)
reportsRouter.get('/discrepancies', async (req, res) => {
  const rows = await query(
    `SELECT sc.id AS stock_count_id, sc.started_at, l.name_ar AS location_name,
            e.full_name AS started_by_name,
            COALESCE(SUM(CASE WHEN sci.counted_qty < sci.expected_qty
                              THEN sci.expected_qty - sci.counted_qty END),0) AS missing_count,
            COALESCE(SUM(CASE WHEN sci.counted_qty > sci.expected_qty
                              THEN sci.counted_qty - sci.expected_qty END),0) AS extra_count,
            ROUND(COALESCE(SUM(CASE WHEN sci.counted_qty <> sci.expected_qty
                 THEN (sci.counted_qty - sci.expected_qty) * i.weight_g * COALESCE(ph.price_per_gram,0) END),0), 2) AS net_value
       FROM stock_counts sc
       JOIN locations l ON l.id = sc.location_id
       LEFT JOIN employees e ON e.id = sc.started_by
       LEFT JOIN stock_count_items sci ON sci.stock_count_id = sc.id
       LEFT JOIN items i ON i.id = sci.item_id
       LEFT JOIN price_history ph ON ph.metal_type = i.metal_type
         AND COALESCE(ph.carat,'') = COALESCE(i.carat,'')
         AND ph.effective_date = CURRENT_DATE AND ph.end_date IS NULL
      WHERE sc.status = 'completed'
      GROUP BY sc.id, sc.started_at, l.name_ar, e.full_name
      ORDER BY sc.started_at DESC`, []);
  res.json(camelizeRows(rows));
});

// تسوية الشيفت
reportsRouter.get('/shift-reconciliation', async (req, res) => {
  const rows = await query(
    `SELECT sr.*, s.opened_at, s.closed_at, e.full_name AS employee_name,
            l.name_ar AS location_name, er.full_name AS reconciled_by_name
       FROM shift_reconciliations sr
       JOIN shifts s ON s.id = sr.shift_id
       JOIN employees e ON e.id = s.employee_id
       JOIN locations l ON l.id = s.location_id
       LEFT JOIN employees er ON er.id = sr.reconciled_by
      ORDER BY s.closed_at DESC LIMIT 300`);
  res.json(camelizeRows(rows));
});

// سعر اليوم الحالي (مصدر واحد للواجهات)
reportsRouter.get('/today-prices', async (_req, res) => {
  const rows = await query(
    `SELECT ph.metal_type, ph.carat, ph.price_per_gram
       FROM price_history ph
      WHERE ph.effective_date = $1 AND ph.end_date IS NULL
      ORDER BY ph.metal_type, ph.carat`, [today()]);
  res.json(camelizeRows(rows));
});
