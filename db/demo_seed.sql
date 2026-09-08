-- Local demo data only. This file is never executed by the production migrator.
-- It is idempotent: re-running it updates the demo records without duplicating them.
BEGIN;

INSERT INTO customers (name, phone, email, address, notes, created_by)
SELECT v.name, v.phone, v.email, v.address, 'DEMO LOCAL - بيانات عرض محلية', e.id
FROM (VALUES
  ('أحمد محمود', '01010001001', 'ahmed.demo@example.test', 'القاهرة - مدينة نصر'),
  ('سارة علي', '01010001002', 'sara.demo@example.test', 'القاهرة - المعادي'),
  ('محمد حسن', '01010001003', 'mohamed.demo@example.test', 'الجيزة - الدقي'),
  ('نور خالد', '01010001004', 'nour.demo@example.test', 'الإسكندرية - سموحة'),
  ('كريم إبراهيم', '01010001005', 'karim.demo@example.test', 'القاهرة - التجمع'),
  ('مريم سامح', '01010001006', 'mariam.demo@example.test', 'الجيزة - الشيخ زايد'),
  ('عمر ياسر', '01010001007', 'omar.demo@example.test', 'القاهرة - مصر الجديدة'),
  ('دينا وائل', '01010001008', 'dina.demo@example.test', 'القاهرة - الزمالك')
) AS v(name, phone, email, address)
CROSS JOIN LATERAL (
  SELECT id FROM employees WHERE username = 'manager' LIMIT 1
) e
WHERE NOT EXISTS (SELECT 1 FROM customers c WHERE c.phone = v.phone);

INSERT INTO categories (code, name_ar, name_en)
VALUES
  ('DEMO-RING', 'خواتم تجريبية', 'Demo rings'),
  ('DEMO-CHAIN', 'سلاسل تجريبية', 'Demo chains'),
  ('DEMO-BRACELET', 'أساور تجريبية', 'Demo bracelets'),
  ('DEMO-EARRINGS', 'أقراط تجريبية', 'Demo earrings'),
  ('DEMO-NECKLACE', 'قلادات تجريبية', 'Demo necklaces'),
  ('DEMO-BAR', 'سبائك تجريبية', 'Demo bullion')
ON CONFLICT (code) DO UPDATE SET
  name_ar = EXCLUDED.name_ar,
  name_en = EXCLUDED.name_en,
  is_active = TRUE;

INSERT INTO items
  (code, barcode, name, category_id, product_kind, metal_type, carat, weight_g,
   craftsmanship_type, craftsmanship_value, cost, metal_price_at_add,
   source_supplier, source_origin, quantity, current_location_id, created_by, notes)
SELECT v.code, v.barcode, v.name, cat.id, v.product_kind, v.metal_type, v.carat,
       v.weight_g, 'fixed', v.craft, v.cost, v.metal_cost, 'مورد تجريبي',
       'purchase', v.quantity, loc.id, emp.id, 'DEMO LOCAL - منتج عرض'
FROM (VALUES
  ('DEMO-RING-001',  '290000000001', 'خاتم ذهب كلاسيك',  'DEMO-RING',     'jewelry', 'gold',   '21',  4.200::numeric,  850::numeric, 20500::numeric, 4700::numeric, 12),
  ('DEMO-CHAIN-001', '290000000002', 'سلسلة ذهب رفيعة',  'DEMO-CHAIN',    'jewelry', 'gold',   '21',  8.750::numeric, 1250::numeric, 42500::numeric, 4700::numeric, 8),
  ('DEMO-BRAC-001',  '290000000003', 'أسورة ذهب',         'DEMO-BRACELET', 'jewelry', 'gold',   '21', 12.400::numeric, 1850::numeric, 60200::numeric, 4700::numeric, 6),
  ('DEMO-EAR-001',   '290000000004', 'حلق ذهب ناعم',      'DEMO-EARRINGS', 'jewelry', 'gold',   '21',  3.100::numeric,  700::numeric, 15100::numeric, 4700::numeric, 15),
  ('DEMO-NECK-001',  '290000000005', 'قلادة ذهب',          'DEMO-NECKLACE', 'jewelry', 'gold',   '21', 15.800::numeric, 1850::numeric, 76800::numeric, 4700::numeric, 4),
  ('DEMO-BAR-005',   '290000000006', 'سبيكة ذهب 5 جرام',  'DEMO-BAR',      'jewelry', 'gold',   '24',  5.000::numeric,  150::numeric, 29100::numeric, 5800::numeric, 10),
  ('DEMO-SILV-001',  '290000000007', 'خاتم فضة 925',      'DEMO-RING',     'jewelry', 'silver', '925', 7.500::numeric,  400::numeric,   650::numeric,   52::numeric, 20),
  ('DEMO-SILV-002',  '290000000008', 'سلسلة فضة 925',     'DEMO-CHAIN',    'jewelry', 'silver', '925',18.000::numeric,  450::numeric,  1450::numeric,   52::numeric, 14)
) AS v(code, barcode, name, category_code, product_kind, metal_type, carat, weight_g, craft, cost, metal_cost, quantity)
JOIN categories cat ON cat.code = v.category_code
CROSS JOIN LATERAL (SELECT id FROM locations WHERE code = 'MAIN' LIMIT 1) loc
CROSS JOIN LATERAL (SELECT id FROM employees WHERE username = 'manager' LIMIT 1) emp
ON CONFLICT (code) DO UPDATE SET
  barcode = EXCLUDED.barcode,
  name = EXCLUDED.name,
  quantity = GREATEST(items.quantity, EXCLUDED.quantity),
  is_active = TRUE,
  updated_at = now();

INSERT INTO price_history (metal_type, carat, price_per_gram, effective_date, entered_by)
SELECT v.metal_type, v.carat, v.price, CURRENT_DATE, e.id
FROM (VALUES
  ('gold', '21', 5400::numeric),
  ('gold', '24', 6200::numeric),
  ('silver', '925', 65::numeric)
) AS v(metal_type, carat, price)
CROSS JOIN LATERAL (SELECT id FROM employees WHERE username = 'manager' LIMIT 1) e
WHERE NOT EXISTS (
  SELECT 1 FROM price_history p
  WHERE p.metal_type = v.metal_type AND p.carat = v.carat
    AND p.effective_date = CURRENT_DATE AND p.end_date IS NULL
);

CREATE TEMP TABLE demo_invoice_lines (
  invoice_no TEXT,
  days_ago INT,
  customer_phone TEXT,
  payment_method TEXT,
  status TEXT,
  item_code TEXT,
  quantity INT,
  metal_price NUMERIC(12,2),
  craftsmanship NUMERIC(12,2)
) ON COMMIT DROP;

INSERT INTO demo_invoice_lines VALUES
  ('INV-DEMO-001',  0, '01010001001', 'cash',     'active',   'DEMO-RING-001',  1, 5400,  850),
  ('INV-DEMO-002',  0, '01010001002', 'card',     'active',   'DEMO-SILV-002',  1,   65,  450),
  ('INV-DEMO-003',  1, '01010001003', 'transfer', 'active',   'DEMO-BAR-005',   1, 6200,  150),
  ('INV-DEMO-004',  2, '01010001004', 'wallet',   'active',   'DEMO-EAR-001',   1, 5400,  700),
  ('INV-DEMO-005',  3, '01010001005', 'cash',     'active',   'DEMO-CHAIN-001', 1, 5400, 1250),
  ('INV-DEMO-005',  3, '01010001005', 'cash',     'active',   'DEMO-SILV-001',  1,   65,  400),
  ('INV-DEMO-006',  5, '01010001006', 'card',     'active',   'DEMO-BRAC-001',  1, 5400, 1850),
  ('INV-DEMO-007',  7, '01010001007', 'cash',     'returned', 'DEMO-RING-001',  1, 5350,  850),
  ('INV-DEMO-008',  9, '01010001008', 'transfer', 'active',   'DEMO-NECK-001',  1, 5350, 1850),
  ('INV-DEMO-009', 12, '01010001001', 'cash',     'active',   'DEMO-SILV-001',  2,   64,  400),
  ('INV-DEMO-010', 15, '01010001002', 'wallet',   'active',   'DEMO-EAR-001',   1, 5300,  700),
  ('INV-DEMO-011', 18, '01010001003', 'card',     'active',   'DEMO-RING-001',  1, 5250,  850),
  ('INV-DEMO-012', 22, '01010001004', 'cash',     'active',   'DEMO-CHAIN-001', 1, 5200, 1250),
  ('INV-DEMO-013', 27, '01010001005', 'transfer', 'active',   'DEMO-BAR-005',   1, 6000,  150),
  ('INV-DEMO-014', 34, '01010001006', 'cash',     'active',   'DEMO-SILV-002',  1,   62,  450);

WITH totals AS (
  SELECT l.invoice_no, l.days_ago, l.customer_phone, l.payment_method, l.status,
         round(sum(COALESCE(i.weight_g, 0) * l.metal_price * l.quantity), 2) AS metal_subtotal,
         round(sum(l.craftsmanship * l.quantity), 2) AS craftsmanship_total
  FROM demo_invoice_lines l
  JOIN items i ON i.code = l.item_code
  GROUP BY l.invoice_no, l.days_ago, l.customer_phone, l.payment_method, l.status
)
INSERT INTO invoices
  (invoice_no, employee_id, location_id, customer_id, customer_phone,
   metal_subtotal, craftsmanship_total, total, payment_method, status,
   return_reason, returned_at, returned_by, created_at)
SELECT t.invoice_no, e.id, loc.id, c.id, c.phone,
       t.metal_subtotal, t.craftsmanship_total,
       t.metal_subtotal + t.craftsmanship_total,
       t.payment_method, t.status,
       CASE WHEN t.status = 'returned' THEN 'مرتجع تجريبي' END,
       CASE WHEN t.status = 'returned' THEN now() - (t.days_ago - 1) * interval '1 day' END,
       CASE WHEN t.status = 'returned' THEN e.id END,
       now() - t.days_ago * interval '1 day'
FROM totals t
JOIN customers c ON c.phone = t.customer_phone
CROSS JOIN LATERAL (SELECT id FROM employees WHERE username = 'manager' LIMIT 1) e
CROSS JOIN LATERAL (SELECT id FROM locations WHERE code = 'MAIN' LIMIT 1) loc
ON CONFLICT (invoice_no) DO UPDATE SET
  customer_id = EXCLUDED.customer_id,
  customer_phone = EXCLUDED.customer_phone,
  metal_subtotal = EXCLUDED.metal_subtotal,
  craftsmanship_total = EXCLUDED.craftsmanship_total,
  total = EXCLUDED.total,
  payment_method = EXCLUDED.payment_method,
  status = EXCLUDED.status,
  return_reason = EXCLUDED.return_reason,
  returned_at = EXCLUDED.returned_at,
  returned_by = EXCLUDED.returned_by,
  created_at = EXCLUDED.created_at;

DELETE FROM invoice_items
WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'INV-DEMO-%');

INSERT INTO invoice_items
  (invoice_id, item_id, quantity, item_code_snapshot, item_name_snapshot,
   metal_type_snapshot, carat_snapshot, weight_g_snapshot, metal_price_snapshot,
   metal_cost_price, craftsmanship_snapshot, line_discount, cost_snapshot, line_total)
SELECT inv.id, i.id, l.quantity, i.code, i.name, i.metal_type, i.carat,
       COALESCE(i.weight_g, 0), l.metal_price, i.metal_price_at_add,
       l.craftsmanship, 0, i.cost,
       round((COALESCE(i.weight_g, 0) * l.metal_price + l.craftsmanship) * l.quantity, 2)
FROM demo_invoice_lines l
JOIN invoices inv ON inv.invoice_no = l.invoice_no
JOIN items i ON i.code = l.item_code;

DELETE FROM payments
WHERE invoice_id IN (SELECT id FROM invoices WHERE invoice_no LIKE 'INV-DEMO-%');

INSERT INTO payments (invoice_id, method, amount, received_by, created_at)
SELECT inv.id, inv.payment_method, inv.total, inv.employee_id, inv.created_at
FROM invoices inv
WHERE inv.invoice_no LIKE 'INV-DEMO-%';

COMMIT;
