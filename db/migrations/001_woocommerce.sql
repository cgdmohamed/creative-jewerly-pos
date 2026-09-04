-- ============================================================
-- 001_woocommerce.sql — WooCommerce two-way sync support
-- Idempotent: safe to run on an existing database.
-- ============================================================
BEGIN;

-- Join keys + last-sync markers (partial unique indexes: many NULLs allowed)
ALTER TABLE items ADD COLUMN IF NOT EXISTS wc_product_id BIGINT;
ALTER TABLE items ADD COLUMN IF NOT EXISTS wc_last_synced_at TIMESTAMPTZ;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS wc_customer_id BIGINT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS wc_last_synced_at TIMESTAMPTZ;

CREATE UNIQUE INDEX IF NOT EXISTS uq_items_wc_product_id
  ON items (wc_product_id) WHERE wc_product_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_wc_customer_id
  ON customers (wc_customer_id) WHERE wc_customer_id IS NOT NULL;

-- Sync run history (imports/exports, counts + per-item errors)
CREATE TABLE IF NOT EXISTS wc_sync_log (
  id         BIGSERIAL PRIMARY KEY,
  op         TEXT NOT NULL,
  direction  TEXT NOT NULL,
  imported   INT NOT NULL DEFAULT 0,
  updated    INT NOT NULL DEFAULT 0,
  skipped    INT NOT NULL DEFAULT 0,
  failed     INT NOT NULL DEFAULT 0,
  errors     JSONB NOT NULL DEFAULT '[]',
  ran_by     INT REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WC order -> local invoice links (prevents double-importing an order)
CREATE TABLE IF NOT EXISTS wc_order_links (
  wc_order_id BIGINT PRIMARY KEY,
  invoice_id  INT NOT NULL REFERENCES invoices(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Permission: manager-only sync management
INSERT INTO permissions (code) VALUES ('woocommerce.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'manager' AND p.code = 'woocommerce.manage'
ON CONFLICT DO NOTHING;

COMMIT;
