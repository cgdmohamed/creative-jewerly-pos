BEGIN;

INSERT INTO employees
  (employee_no, full_name, phone, hire_date, status, role_id, location_id,
   discount_cap_percent, username, pin_hash, notes)
SELECT 'B2B', 'حساب المتجر B2B', NULL, CURRENT_DATE, 'active',
       (SELECT id FROM roles WHERE code = 'social'),
       (SELECT id FROM locations WHERE code = 'MAIN'),
       0, 'b2b', '$2b$10$PHmBSThHkw88UZDlddFyxOcd.hCOdJ1nq4xffS5z5lr6JKZEZIlNm',
       'Dedicated service account for the B2B wholesale shop'
WHERE NOT EXISTS (SELECT 1 FROM employees WHERE username = 'b2b');

COMMIT;
