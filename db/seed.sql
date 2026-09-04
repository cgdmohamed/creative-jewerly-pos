-- Seed: initial staff accounts only
BEGIN;

INSERT INTO employees
  (employee_no, full_name, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash, notes)
SELECT 'EMP-001', 'المدير العام', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='manager'),
       (SELECT id FROM locations WHERE code='MAIN'),
       5, 'manager', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm',
       'الحساب الافتراضي للمدير'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='manager');

INSERT INTO employees
  (employee_no, full_name, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash)
SELECT 'EMP-002', 'كاشير رئيسي', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='cashier'),
       (SELECT id FROM locations WHERE code='MAIN'),
       2, 'cashier', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='cashier');

INSERT INTO employees
  (employee_no, full_name, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash)
SELECT 'EMP-003', 'مسؤول سوشيال', CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code='social'),
       (SELECT id FROM locations WHERE code='MAIN'),
       0, 'social', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username='social');

COMMIT;
