ALTER TABLE reservations
  ADD COLUMN IF NOT EXISTS weight_g_snapshot NUMERIC(10,3),
  ADD COLUMN IF NOT EXISTS metal_price_snapshot NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS metal_subtotal_snapshot NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS craftsmanship_total_snapshot NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS vat_percent_snapshot NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS vat_amount_snapshot NUMERIC(12,2);

COMMENT ON COLUMN reservations.total_value IS
  'Final price locked by the server when the reservation is created.';

