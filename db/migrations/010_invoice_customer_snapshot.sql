BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_name TEXT;

UPDATE invoices inv
   SET customer_name = c.name
  FROM customers c
 WHERE inv.customer_id = c.id
   AND inv.customer_name IS NULL;

COMMIT;
