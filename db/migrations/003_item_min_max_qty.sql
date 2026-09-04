-- item_min_max_qty: per-item min/max order quantities for the B2B shop.
-- Idempotent — safe to re-run.
BEGIN;

ALTER TABLE items ADD COLUMN IF NOT EXISTS min_qty INT NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN IF NOT EXISTS max_qty INT;

COMMIT;
