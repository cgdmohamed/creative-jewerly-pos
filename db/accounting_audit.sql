\set ON_ERROR_STOP on

DO $$
DECLARE bad_count integer;
BEGIN
  SELECT COUNT(*) INTO bad_count FROM invoices
   WHERE total < 0 OR metal_subtotal < 0 OR craftsmanship_total < 0
      OR discount_amount < 0 OR vat_amount < 0
      OR total <> metal_subtotal + craftsmanship_total + vat_amount;
  IF bad_count > 0 THEN RAISE EXCEPTION '% invoice headers do not reconcile', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count FROM payments WHERE amount < 0;
  IF bad_count > 0 THEN RAISE EXCEPTION '% payments are negative', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count
    FROM invoices i
    LEFT JOIN (SELECT invoice_id, SUM(amount) amount FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id
   WHERE COALESCE(p.amount,0) > i.total;
  IF bad_count > 0 THEN RAISE EXCEPTION '% invoices are over-collected', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count FROM reservations
   WHERE down_payment < 0 OR total_value < 0 OR down_payment > total_value
      OR remaining_due <> total_value-down_payment;
  IF bad_count > 0 THEN RAISE EXCEPTION '% reservations do not reconcile', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count FROM items
   WHERE quantity < 0 OR reserved_qty < 0 OR in_transit_qty < 0
      OR reserved_qty + in_transit_qty > quantity;
  IF bad_count > 0 THEN RAISE EXCEPTION '% inventory quantity rows are inconsistent', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count
    FROM invoice_items ii
    JOIN invoices i ON i.id=ii.invoice_id
   WHERE ii.quantity <= 0 OR ii.line_discount < 0 OR ii.line_total < 0;
  IF bad_count > 0 THEN RAISE EXCEPTION '% invoice lines contain invalid values', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count FROM (
    SELECT i.id
      FROM invoices i JOIN invoice_items ii ON ii.invoice_id=i.id
     GROUP BY i.id
    HAVING SUM(ii.line_total) <> i.metal_subtotal+i.craftsmanship_total
  ) bad_lines;
  IF bad_count > 0 THEN RAISE EXCEPTION '% invoice line totals do not match headers', bad_count; END IF;

  SELECT COUNT(*) INTO bad_count FROM (
    SELECT i.id, COALESCE(p.amount,0) paid, COALESCE(r.amount,0) refunded
      FROM invoices i
      LEFT JOIN (SELECT invoice_id,SUM(amount) amount FROM payments GROUP BY invoice_id) p ON p.invoice_id=i.id
      LEFT JOIN (SELECT invoice_id,SUM(amount) amount FROM refunds GROUP BY invoice_id) r ON r.invoice_id=i.id
     WHERE i.status='returned'
       AND COALESCE(p.amount,0) <> COALESCE(r.amount,0)
  ) bad_refunds;
  IF bad_count > 0 THEN RAISE EXCEPTION '% returned invoices are not fully represented by refunds', bad_count; END IF;
END $$;

SELECT 'accounting audit passed' AS result;
