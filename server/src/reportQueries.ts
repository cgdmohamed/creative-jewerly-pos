import { query } from './db.js';

export async function getSalesOverview(days = 14) {
  const daily = await query(
    `WITH series AS (
       SELECT d FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, '1 day') AS d
     )
     SELECT to_char(s.d,'YYYY-MM-DD') AS date,
            COALESCE(x.total,0)::numeric AS total,
            COALESCE(x.count,0)::int AS count
       FROM series s
       LEFT JOIN (
         SELECT created_at::date AS date, ROUND(SUM(total),2) AS total, COUNT(*) AS count
           FROM invoices WHERE status='active' AND created_at >= CURRENT_DATE - ($1::int - 1)
          GROUP BY created_at::date
       ) x ON x.date = s.d
      ORDER BY s.d`, [days]);
  const byMetal = await query(
    `WITH lines AS (
       SELECT ii.*, i.total AS invoice_total,
              SUM(ii.line_total) OVER (PARTITION BY i.id) AS invoice_lines_total
         FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
        WHERE i.status='active' AND i.created_at >= CURRENT_DATE - interval '30 days'
     )
     SELECT COALESCE(metal_type_snapshot,'general') AS metal_type, SUM(quantity) AS count,
            ROUND(SUM(CASE WHEN invoice_lines_total=0 THEN 0
              ELSE invoice_total*line_total/invoice_lines_total END),2) AS total
       FROM lines GROUP BY COALESCE(metal_type_snapshot,'general') ORDER BY total DESC`);
  const byMethod = await query(
    `SELECT payment_method AS method, COUNT(*) AS count, ROUND(SUM(total),2) AS total
       FROM invoices WHERE status='active' AND created_at >= CURRENT_DATE - interval '30 days'
      GROUP BY payment_method ORDER BY total DESC`);
  const summary = await query(
    `SELECT
       (SELECT COALESCE(ROUND(SUM(total),2),0) FROM invoices WHERE status='active' AND created_at::date = CURRENT_DATE) AS today_sales,
       (SELECT COUNT(*) FROM invoices WHERE status='active' AND created_at::date = CURRENT_DATE) AS today_invoices,
       (SELECT COALESCE(ROUND(SUM(total),2),0) FROM invoices WHERE status='active' AND created_at >= date_trunc('week', now())) AS week_sales,
       (SELECT COALESCE(ROUND(SUM(total),2),0) FROM invoices WHERE status='active' AND created_at >= date_trunc('month', now())) AS month_sales`);
  return { days, daily, byMetal, byMethod, summary: summary[0] };
}

export async function getInventoryValue() {
  const byLocation = await query(
    `SELECT l.id AS location_id, l.name_ar AS location_name,
             COALESCE(SUM(GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0)),0) AS piece_count,
             ROUND(SUM(GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0) * COALESCE(i.weight_g,0) * COALESCE(ph.price_per_gram,0)), 2) AS metal_value,
             ROUND(SUM(
               GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0) * COALESCE(i.weight_g,0) * COALESCE(ph.price_per_gram,0) +
               GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0) * (CASE
                   WHEN i.craftsmanship_type='percent' THEN COALESCE(i.weight_g,0)*COALESCE(ph.price_per_gram,0)*i.craftsmanship_value/100
                   WHEN i.craftsmanship_type='per_gram' THEN COALESCE(i.weight_g,0)*i.craftsmanship_value
                   ELSE COALESCE(i.craftsmanship_value,0) END)
            ), 2) AS total_value
       FROM locations l
       LEFT JOIN items i ON i.current_location_id = l.id
         AND i.is_active AND i.status = 'available'
       LEFT JOIN price_history ph ON ph.metal_type = i.metal_type
         AND COALESCE(ph.carat,'') = COALESCE(i.carat,'')
         AND ph.effective_date = CURRENT_DATE AND ph.end_date IS NULL
      WHERE l.is_active
      GROUP BY l.id, l.name_ar
      ORDER BY l.code`);
  const breakdown = await query(
    `SELECT l.name_ar AS location_name, i.metal_type, i.carat,
             SUM(GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0)) AS count,
             ROUND(SUM(GREATEST(i.quantity-i.reserved_qty-i.in_transit_qty,0) * i.weight_g * COALESCE(ph.price_per_gram,0)),2) AS metal_value
       FROM items i
       JOIN locations l ON l.id = i.current_location_id
       LEFT JOIN price_history ph ON ph.metal_type = i.metal_type
         AND COALESCE(ph.carat,'') = COALESCE(i.carat,'')
         AND ph.effective_date = CURRENT_DATE AND ph.end_date IS NULL
      WHERE i.is_active AND i.status = 'available'
      GROUP BY l.name_ar, i.metal_type, i.carat
      ORDER BY l.name_ar, i.metal_type, i.carat`);
  return { byLocation, breakdown };
}
