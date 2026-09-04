-- Seed: default manager + demo data
-- Login: username=manager / pin=1234
BEGIN;

INSERT INTO employees
  (employee_no, full_name, phone, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash, notes)
SELECT 'EMP-001', 'المدير العام', '01000000001', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='manager'),
       (SELECT id FROM locations WHERE code='MAIN'),
       5, 'manager', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm',
       'الحساب الافتراضي للمدير'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='manager');

INSERT INTO employees
  (employee_no, full_name, phone, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash)
SELECT 'EMP-002', 'كاشير رئيسي', '01000000002', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='cashier'),
       (SELECT id FROM locations WHERE code='MAIN'),
       2, 'cashier', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='cashier');

INSERT INTO employees
  (employee_no, full_name, phone, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash)
SELECT 'EMP-003', 'مسؤول سوشيال', '01000000003', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='social'),
       (SELECT id FROM locations WHERE code='MAIN'),
       0, 'social', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='social');

-- Today's prices (gold 21/24, silver 925) so POS works out of the box
INSERT INTO price_history (metal_type, carat, price_per_gram, effective_date, entered_by)
SELECT 'gold', '21', 9500, CURRENT_DATE, (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM price_history WHERE metal_type='gold' AND carat='21' AND effective_date=CURRENT_DATE);

INSERT INTO price_history (metal_type, carat, price_per_gram, effective_date, entered_by)
SELECT 'gold', '24', 10800, CURRENT_DATE, (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM price_history WHERE metal_type='gold' AND carat='24' AND effective_date=CURRENT_DATE);

INSERT INTO price_history (metal_type, carat, price_per_gram, effective_date, entered_by)
SELECT 'silver', '925', 60, CURRENT_DATE, (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM price_history WHERE metal_type='silver' AND carat='925' AND effective_date=CURRENT_DATE);

-- Demo pieces
INSERT INTO items
  (code, barcode, name, description, category_id, metal_type, carat, weight_g,
   craftsmanship_type, craftsmanship_value, cost, metal_price_at_add, source_supplier,
   quantity, status, current_location_id, created_by)
SELECT 'BAR-24-001', '1000001', 'سبيكة ذهب 24', 'سبيكة 24 قيراط', (SELECT id FROM categories WHERE code='BAR'),
       'gold', '24', 10, 'fixed', 250, 100000, 10750, 'الورشة الرئيسية',
       3, 'available', (SELECT id FROM locations WHERE code='MAIN'), (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM items WHERE code='BAR-24-001');

INSERT INTO items
  (code, barcode, name, description, category_id, metal_type, carat, weight_g,
   craftsmanship_type, craftsmanship_value, cost, metal_price_at_add, source_supplier,
   quantity, status, current_location_id, created_by)
SELECT 'RING-21-001', '1000002', 'خاتم رجالي', 'خاتم رجالي 21 قيراط', (SELECT id FROM categories WHERE code='RING'),
       'gold', '21', 6.5, 'percent', 8, 50000, 9450, 'الورشة الرئيسية',
       2, 'available', (SELECT id FROM locations WHERE code='MAIN'), (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM items WHERE code='RING-21-001');

INSERT INTO items
  (code, barcode, name, description, category_id, metal_type, carat, weight_g,
   craftsmanship_type, craftsmanship_value, cost, metal_price_at_add, source_supplier,
   quantity, status, current_location_id, created_by)
SELECT 'CHAIN-S-001', '1000003', 'سلسلة فضة', 'سلسلة فضة 925', (SELECT id FROM categories WHERE code='CHAIN'),
       'silver', '925', 15, 'fixed', 150, 700, 58, 'الورشة الرئيسية',
       1, 'available', (SELECT id FROM locations WHERE code='MAIN'), (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM items WHERE code='CHAIN-S-001');

-- Payment methods (طرق الدفع)
INSERT INTO payment_methods (code, name_ar, name_en, color, sort_order) VALUES
  ('cash', 'نقدي', 'Cash', '#10b981', 1),
  ('transfer', 'تحويل بنكي', 'Bank transfer', '#0ea5e9', 2),
  ('card', 'كارت بنكي', 'Bank card', '#8b5cf6', 3),
  ('wallet', 'محفظة إلكترونية', 'E-wallet', '#f59e0b', 4)
ON CONFLICT (code) DO NOTHING;

-- settings.manage و locations.manage للمدير فقط
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN ('settings.manage','locations.manage')
WHERE r.code = 'manager'
ON CONFLICT DO NOTHING;

-- Demo customers
INSERT INTO customers (name, phone, email, address, notes, created_by)
SELECT 'أحمد محمد', '01012345678', 'ahmed@example.com', 'المعادي، القاهرة', 'عميل دائم', (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='01012345678');

INSERT INTO customers (name, phone, notes, created_by)
SELECT 'سارة علي', '01123456789', 'فضلت سبيكة 24', (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='01123456789');

INSERT INTO customers (name, phone, notes, created_by)
SELECT 'مصطفى حسن', '01234567890', 'تواصل عبر الواتساب', (SELECT id FROM employees WHERE username='manager')
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE phone='01234567890');

COMMIT;
