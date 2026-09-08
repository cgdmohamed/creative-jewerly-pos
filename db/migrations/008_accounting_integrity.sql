ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS affects_shift BOOLEAN NOT NULL DEFAULT TRUE;

CREATE TABLE IF NOT EXISTS refunds (
  id            SERIAL PRIMARY KEY,
  payment_id    INT UNIQUE NOT NULL REFERENCES payments(id),
  invoice_id    INT NOT NULL REFERENCES invoices(id),
  method        TEXT NOT NULL,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  shift_id      INT,
  refunded_by   INT REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Allocate legacy invoice-level discounts across their lines, preserving cents.
WITH base AS (
  SELECT ii.id, ii.invoice_id, i.discount_amount,
         ROUND(ii.quantity*ii.craftsmanship_snapshot,2) AS line_craft,
         SUM(ROUND(ii.quantity*ii.craftsmanship_snapshot,2)) OVER (PARTITION BY ii.invoice_id) AS total_craft,
         ROW_NUMBER() OVER (PARTITION BY ii.invoice_id ORDER BY ii.id DESC) AS last_line
    FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
), shares AS (
  SELECT *, CASE WHEN total_craft>0
    THEN ROUND(discount_amount*line_craft/total_craft,2) ELSE 0 END AS share
    FROM base
), allocated AS (
  SELECT id, CASE WHEN last_line=1
    THEN share + discount_amount-SUM(share) OVER (PARTITION BY invoice_id)
    ELSE share END AS amount
    FROM shares
)
UPDATE invoice_items ii SET line_discount=a.amount FROM allocated a WHERE a.id=ii.id;

UPDATE invoice_items SET line_total=ROUND(
  quantity*weight_g_snapshot*COALESCE(metal_price_snapshot,0)
  + quantity*craftsmanship_snapshot-line_discount,2);

WITH differences AS (
  SELECT i.id AS invoice_id,
         (i.metal_subtotal+i.craftsmanship_total)-SUM(ii.line_total) AS difference,
         MAX(ii.id) AS last_line_id
    FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id
   GROUP BY i.id
)
UPDATE invoice_items ii SET line_total=ii.line_total+d.difference
  FROM differences d WHERE ii.id=d.last_line_id AND d.difference<>0;

INSERT INTO refunds (payment_id,invoice_id,method,amount,shift_id,refunded_by,created_at)
SELECT p.id,p.invoice_id,p.method,p.amount,NULL,i.returned_by,COALESCE(i.returned_at,i.created_at)
  FROM payments p JOIN invoices i ON i.id=p.invoice_id
 WHERE i.status='returned' AND p.amount>0
ON CONFLICT (payment_id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payments_amount_nonnegative') THEN
    ALTER TABLE payments ADD CONSTRAINT payments_amount_nonnegative CHECK (amount >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_values_nonnegative') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_values_nonnegative
      CHECK (down_payment >= 0 AND total_value >= 0 AND remaining_due >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_payment_not_over_total') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_payment_not_over_total
      CHECK (down_payment <= total_value);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='reservations_balance_reconciles') THEN
    ALTER TABLE reservations ADD CONSTRAINT reservations_balance_reconciles
      CHECK (remaining_due = total_value - down_payment);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='items_allocated_not_over_quantity') THEN
    ALTER TABLE items ADD CONSTRAINT items_allocated_not_over_quantity
      CHECK (reserved_qty + in_transit_qty <= quantity);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_values_nonnegative') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_values_nonnegative
      CHECK (metal_subtotal >= 0 AND craftsmanship_total >= 0 AND discount_amount >= 0
        AND vat_amount >= 0 AND total >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoices_total_reconciles') THEN
    ALTER TABLE invoices ADD CONSTRAINT invoices_total_reconciles
      CHECK (total = metal_subtotal + craftsmanship_total + vat_amount);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='invoice_items_values_nonnegative') THEN
    ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_values_nonnegative
      CHECK (line_discount >= 0 AND line_total >= 0);
  END IF;
END $$;
