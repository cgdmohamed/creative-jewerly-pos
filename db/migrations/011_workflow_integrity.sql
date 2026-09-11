BEGIN;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM shifts WHERE status='open' GROUP BY employee_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate open shifts must be reconciled before migration';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_shifts_one_open_per_employee
  ON shifts(employee_id) WHERE status = 'open';

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_invoices_external_ref
  ON invoices(external_ref) WHERE external_ref IS NOT NULL;
ALTER TABLE reservations ADD COLUMN IF NOT EXISTS external_ref TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS uq_reservations_external_ref
  ON reservations(external_ref) WHERE external_ref IS NOT NULL;

UPDATE items SET status = CASE
  WHEN quantity-reserved_qty-in_transit_qty > 0 THEN 'available'
  WHEN in_transit_qty > 0 THEN 'in_transit'
  WHEN reserved_qty > 0 THEN 'reserved'
  ELSE 'sold' END;

ALTER TABLE stock_count_items DROP CONSTRAINT IF EXISTS stock_count_items_counted_status_check;
ALTER TABLE stock_count_items ALTER COLUMN counted_at DROP NOT NULL;
ALTER TABLE stock_count_items ALTER COLUMN counted_at DROP DEFAULT;
UPDATE stock_count_items sci SET counted_status = 'unscanned', counted_at = NULL
  FROM stock_counts sc
 WHERE sci.stock_count_id=sc.id AND sc.status='in_progress'
   AND sci.counted_by IS NULL AND sci.counted_qty = 0;
ALTER TABLE stock_count_items ADD CONSTRAINT stock_count_items_counted_status_check
  CHECK (counted_status IN ('unscanned','found','missing','unexpected'));

ALTER TABLE stock_counts DROP CONSTRAINT IF EXISTS stock_counts_status_check;
ALTER TABLE stock_counts ADD CONSTRAINT stock_counts_status_check
  CHECK (status IN ('in_progress','completed','applied','cancelled'));
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS applied_by INT REFERENCES employees(id);
ALTER TABLE stock_counts ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM stock_counts WHERE status='in_progress' GROUP BY location_id HAVING count(*)>1) THEN
    RAISE EXCEPTION 'Duplicate open stock counts must be resolved before migration';
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS uq_stock_counts_one_open_per_location
  ON stock_counts(location_id) WHERE status = 'in_progress';

CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id BIGSERIAL PRIMARY KEY,
  item_id INT NOT NULL REFERENCES items(id),
  stock_count_id INT REFERENCES stock_counts(id),
  quantity_before INT NOT NULL,
  quantity_delta INT NOT NULL,
  quantity_after INT NOT NULL CHECK (quantity_after >= 0),
  reason TEXT NOT NULL,
  created_by INT REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stock_count_id, item_id)
);

ALTER TABLE wholesale_ledger_entries ADD COLUMN IF NOT EXISTS shift_id INT REFERENCES shifts(id);
CREATE INDEX IF NOT EXISTS idx_wholesale_ledger_shift ON wholesale_ledger_entries(shift_id)
  WHERE shift_id IS NOT NULL;

ALTER TABLE wholesale_weight_orders DROP CONSTRAINT IF EXISTS wholesale_weight_orders_status_check;
ALTER TABLE wholesale_weight_orders ADD CONSTRAINT wholesale_weight_orders_status_check
  CHECK (status IN ('draft','preparing','ready','partial','completed','returned','cancelled'));

COMMIT;
