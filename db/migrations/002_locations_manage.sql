-- locations.manage: only the manager may add/edit branches & locations.
-- Idempotent — safe to re-run.
BEGIN;

INSERT INTO permissions (code) VALUES ('locations.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.code = 'locations.manage'
WHERE r.code = 'manager'
  AND NOT EXISTS (
    SELECT 1 FROM role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

COMMIT;
