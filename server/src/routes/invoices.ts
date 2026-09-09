import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { allocateDiscount, calculateInvoiceTotals, calculateLockedInvoiceTotals, computeUnitCraftsmanship, normalizePayment, roundMoney } from '../accounting.js';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx, Queryable, pool } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus, todayLocal } from '../utils.js';

export const invoicesRouter = Router();

invoicesRouter.use(authenticate);

const INVOICE_SELECT = `
  SELECT inv.*, e.full_name AS cashier_name, l.name_ar AS location_name,
         am.full_name AS approved_by_name, le.full_name AS returned_by_name,
         pm.name_ar AS payment_method_name, pm.color AS payment_method_color,
         c.name AS customer_name,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=inv.id),0) AS paid_amount,
         GREATEST(inv.total-COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=inv.id),0),0) AS remaining_due
    FROM invoices inv
    LEFT JOIN employees e ON e.id = inv.employee_id
    LEFT JOIN locations l ON l.id = inv.location_id
    LEFT JOIN employees am ON am.id = inv.discount_approved_by
    LEFT JOIN employees le ON le.id = inv.returned_by
    LEFT JOIN payment_methods pm ON pm.code = inv.payment_method
    LEFT JOIN customers c ON c.id = inv.customer_id`;

invoicesRouter.get('/', async (req, res) => {
  const { status, locationId, employeeId, from, to, search, method } = req.query;
  const params: any[] = [];
  const conds: string[] = [];
  if (status) { params.push(String(status)); conds.push(`inv.status = $${params.length}`); }
  if (locationId) { params.push(Number(locationId)); conds.push(`inv.location_id = $${params.length}`); }
  if (employeeId) { params.push(Number(employeeId)); conds.push(`inv.employee_id = $${params.length}`); }
  if (from) { params.push(String(from)); conds.push(`inv.created_at >= $${params.length}::date`); }
  if (to) { params.push(String(to)); conds.push(`inv.created_at < ($${params.length}::date + 1)`); }
  if (search) { params.push(`%${search}%`); conds.push(`inv.invoice_no ILIKE $${params.length}`); }
  if (method) { params.push(String(method)); conds.push(`inv.payment_method = $${params.length}`); }

  const rows = await query(
    `${INVOICE_SELECT}
      ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
     ORDER BY inv.created_at DESC LIMIT 300`, params);
  res.json(camelizeRows(rows));
});

invoicesRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const inv = await queryOne<any>(`${INVOICE_SELECT} WHERE inv.id = $1`, [id]);
  if (!inv) return res.status(404).json({ error: 'notfound' });
  const items = await query(
    `SELECT ii.* FROM invoice_items ii WHERE ii.invoice_id = $1 ORDER BY ii.id`, [id]);
  const payments = await query(
    `SELECT p.*, e.full_name AS received_by_name FROM payments p
       LEFT JOIN employees e ON e.id = p.received_by WHERE p.invoice_id = $1`, [id]);
  res.json({ ...camelize(inv), items: camelizeRows(items), payments: camelizeRows(payments) });
});

function validateManagerPin(db: Queryable, pin: string): Promise<boolean> {
  return db
    .queryOne<any>(
      `SELECT pin_hash FROM employees e JOIN roles r ON r.id = e.role_id
        WHERE r.code = 'manager' AND e.status = 'active' AND e.pin_hash IS NOT NULL LIMIT 1`)
    .then((m) => !!m && bcrypt.compareSync(pin, m.pin_hash));
}

export async function buildInvoice(db: Queryable, b: any, employeeId: number, cashier: any, hasDiscountOverride = false) {
  const items: any[] = b.items;
  if (!Array.isArray(items) || items.length === 0) throw httpError(400, 'missing:items');
  if (!b.customerId) throw httpError(400, 'customers.required');

  const customer = await db.queryOne<any>(`SELECT * FROM customers WHERE id = $1 AND is_active`, [Number(b.customerId)]);
  if (!customer) throw httpError(404, 'customers.notfound');
  const customerPhone = String(customer.phone || b.customerPhone || '').trim();
  if (customerPhone.replace(/\D/g, '').length < 8) throw httpError(400, 'customers.phone_required');
  const customerId = customer.id;

  const combinedItems = new Map<number, number>();
  for (const line of items) {
    const itemId = Number(line.itemId);
    const quantity = Number(line.quantity ?? 1);
    if (!Number.isInteger(itemId) || itemId < 1 || !Number.isInteger(quantity) || quantity < 1) {
      throw httpError(400, `bad.quantity:${line.itemId}`);
    }
    combinedItems.set(itemId, (combinedItems.get(itemId) ?? 0) + quantity);
  }

  const reservationIds = [...new Set(
    (Array.isArray(b.reservationIds) ? b.reservationIds : [])
      .map(Number)
      .filter((id: number) => Number.isInteger(id) && id > 0),
  )];
  const reservations = reservationIds.length
    ? await db.query<any>(
      `SELECT * FROM reservations
        WHERE id = ANY($1::int[]) AND (customer_id=$2 OR customer_id IS NULL) AND status='active'
        ORDER BY id FOR UPDATE`,
      [reservationIds, customerId])
    : [];
  if (reservations.length !== reservationIds.length) throw httpError(409, 'reservations.invalid');
  for (const reservation of reservations) {
    if (reservation.customer_id == null) {
      await db.query(`UPDATE reservations SET customer_id=$1 WHERE id=$2`, [customerId, reservation.id]);
    }
  }
  const reservedForSale = new Map<number, number>();
  for (const reservation of reservations) {
    const itemId = Number(reservation.item_id);
    reservedForSale.set(itemId, (reservedForSale.get(itemId) ?? 0) + Number(reservation.quantity));
  }
  for (const itemId of reservedForSale.keys()) {
    if (!combinedItems.has(itemId)) throw httpError(409, 'reservations.item_mismatch');
  }
  if (reservations.length) {
    if (combinedItems.size !== reservedForSale.size) throw httpError(409, 'reservations.items_only');
    for (const [itemId, quantity] of combinedItems) {
      if (reservedForSale.get(itemId) !== quantity) throw httpError(409, 'reservations.quantity_mismatch');
    }
  }

  const today = todayLocal();

  // Load each item + today's active price
  const lines = [];
  for (const [itemId, quantity] of [...combinedItems].sort((a, z) => a[0] - z[0])) {
    const item = await db.queryOne<any>(
      `SELECT * FROM items WHERE id = $1 AND is_active FOR UPDATE`, [itemId]);
    if (!item) throw httpError(404, `items.notfound:${itemId}`);
    const ownReserved = reservedForSale.get(itemId) ?? 0;
    if (ownReserved > quantity) throw httpError(409, `reservations.quantity_mismatch:${item.code}`);
    const available = Number(item.quantity) - Number(item.reserved_qty ?? 0)
      - Number(item.in_transit_qty ?? 0) + ownReserved;
    if ((item.status !== 'available' && ownReserved === 0) || available < quantity) {
      throw httpError(409, `items.not_available:${item.code}`);
    }

    // General products (watches, gifts…) have a fixed sale price — no metal
    // pricing. Their price lands in the craftsmanship bucket so discounts
    // and VAT keep working for mixed carts.
    if (item.product_kind === 'general') {
      const salePrice = Number(item.sale_price);
      if (!(salePrice > 0)) throw httpError(409, `items.no_sale_price:${item.code}`);
      lines.push({
        item, quantity,
        metalTotal: 0, craft: salePrice * quantity, unitMetalPrice: 0,
      });
      continue;
    }

    const price = await db.queryOne<any>(
      `SELECT price_per_gram FROM price_history
        WHERE metal_type = $1 AND COALESCE(carat,'') = COALESCE($2,'')
          AND effective_date = $3 AND end_date IS NULL`,
      [item.metal_type, item.carat || null, today]);
    if (!price) throw httpError(409, `prices.missing_today:${item.metal_type}:${item.carat || '-'}`);

    const unitMetalTotal = Number(item.weight_g) * Number(price.price_per_gram);
    const craft = computeUnitCraftsmanship(
      item.craftsmanship_type,
      Number(item.craftsmanship_value),
      Number(item.weight_g),
      unitMetalTotal,
    );

    lines.push({
      item, quantity,
      metalTotal: unitMetalTotal * quantity,
      craft: craft * quantity,
      unitMetalPrice: Number(price.price_per_gram),
    });
  }

  const metalSubtotalRaw = lines.reduce((s, l) => s + l.metalTotal, 0);
  let craftsmanshipSubtotalRaw = lines.reduce((s, l) => s + l.craft, 0);

  // Discount: percentage OR fixed amount, applied against craftsmanship only.
  // Cashier role can be blocked entirely (cashier_discount_enabled) and the
  // cap PIN-override can be disabled (cashier_cap_override_enabled).
  let discountAmount = 0;
  let discountReason: string | null = null;
  let approvedBy: number | null = null;
  const discountType = b.discountType === 'fixed' ? 'fixed' : 'percent';
  const discountPercent = Number(b.discountPercent ?? 0);
  const discountValue = Number(b.discountValue ?? 0);
  const wantsDiscount = discountType === 'fixed' ? discountValue > 0 : discountPercent > 0;
  if (reservations.length && wantsDiscount) throw httpError(409, 'reservations.price_locked');
  if (wantsDiscount) {
    const getSetting = async (key: string) =>
      (await db.queryOne<any>(`SELECT value FROM app_settings WHERE key = $1`, [key]))?.value;

    const cashierDiscountEnabled = (await getSetting('cashier_discount_enabled')) !== 'false';
    if (!cashierDiscountEnabled && !hasDiscountOverride) {
      throw httpError(403, 'discount.disabled_for_cashier');
    }

    // Cap enforcement applies to cashiers only; managers (invoice.discount_override) are free
    if (!hasDiscountOverride && craftsmanshipSubtotalRaw > 0) {
      const cap = Number(cashier.discount_cap_percent ?? 0);
      const requestedDiscount = discountType === 'fixed'
        ? Math.min(discountValue, craftsmanshipSubtotalRaw)
        : craftsmanshipSubtotalRaw * discountPercent / 100;
      const effectiveRate = (requestedDiscount / craftsmanshipSubtotalRaw) * 100;
      if (effectiveRate > cap) {
        const capOverrideEnabled = (await getSetting('cashier_cap_override_enabled')) !== 'false';
        if (!capOverrideEnabled) throw httpError(403, 'discount.exceeds_cap');
        const managerPin = String(b.managerPin ?? '');
        if (!managerPin || !(await validateManagerPin(db, managerPin))) {
          throw httpError(403, 'discount.requires_manager');
        }
        approvedBy = (await db.queryOne<any>(
          `SELECT e.id FROM employees e JOIN roles r ON r.id = e.role_id
            WHERE r.code = 'manager' AND e.status='active' LIMIT 1`))?.id ?? null;
      }
    }

  }

  // VAT is applied after the craftsmanship discount.
  const vatPercent = Number((await db.queryOne<any>(
    `SELECT value FROM app_settings WHERE key = 'vat_percent'`))?.value ?? 0);
  let totals;
  try {
    if (reservations.length) {
      const agreedTotal = roundMoney(reservations.reduce(
        (sum, reservation) => sum + Number(reservation.total_value || 0), 0));
      totals = calculateLockedInvoiceTotals(metalSubtotalRaw, agreedTotal, vatPercent);
      craftsmanshipSubtotalRaw = totals.rawCraftsmanship;

      const targetCents = Math.round(craftsmanshipSubtotalRaw * 100);
      const reservationTotals = new Map<number, number>();
      for (const reservation of reservations) {
        const itemId = Number(reservation.item_id);
        reservationTotals.set(itemId, (reservationTotals.get(itemId) ?? 0) + Number(reservation.total_value));
      }
      const weightTotal = [...reservationTotals.values()].reduce((sum, value) => sum + value, 0) || 1;
      let allocatedCents = 0;
      lines.forEach((line, index) => {
        const cents = index === lines.length - 1
          ? targetCents - allocatedCents
          : Math.floor(targetCents * (reservationTotals.get(Number(line.item.id)) ?? 0) / weightTotal);
        allocatedCents += cents;
        line.craft = cents / 100;
      });
    } else {
      totals = calculateInvoiceTotals({
        metalSubtotal: metalSubtotalRaw,
        craftsmanshipSubtotal: craftsmanshipSubtotalRaw,
        discountType,
        discountValue: discountType === 'fixed' ? discountValue : discountPercent,
        vatPercent,
      });
    }
  } catch (error: any) {
    throw httpError(400, error?.message || 'bad.accounting');
  }
  discountAmount = totals.discountAmount;
  if (discountAmount > 0) {
    discountReason = discountType === 'fixed'
      ? `خصم ${discountAmount} على المصنعية`
      : `خصم ${discountPercent}% على المصنعية`;
  }

  await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`invoice-number:${today}`]);
  const invoiceNo = `INV-${today.replaceAll('-', '')}-${String(
    (await db.queryOne<any>(`SELECT COUNT(*)::int + 1 AS n FROM invoices WHERE created_at::date = CURRENT_DATE`))?.n ?? 1,
  ).padStart(4, '0')}`;

  const inv = await db.queryOne<any>(
    `INSERT INTO invoices
       (invoice_no, employee_id, location_id, customer_id, customer_phone, metal_subtotal,
        craftsmanship_total, discount_amount, discount_reason, discount_approved_by,
        vat_percent, vat_amount, total, payment_method, shift_id, is_offline, device_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,
             (SELECT id FROM shifts WHERE employee_id=$2 AND status='open' ORDER BY opened_at DESC LIMIT 1),
             $15,$16)
     RETURNING *`,
    [
      invoiceNo, employeeId, Number(b.locationId) || cashier.location_id || 1,
      customerId, customerPhone, totals.metalSubtotal, totals.craftsmanshipTotal,
      totals.discountAmount, discountReason, approvedBy, totals.vatPercent, totals.vatAmount, totals.total,
      b.paymentMethod || 'cash', !!b.isOffline, b.deviceId || null,
    ],
  );

  const lineDiscounts = allocateDiscount(lines.map((line) => line.craft), totals.discountAmount);
  const lineTotals = lines.map((line, index) =>
    roundMoney(line.metalTotal + line.craft - lineDiscounts[index]));
  if (lineTotals.length) {
    const targetPreTax = roundMoney(totals.metalSubtotal + totals.craftsmanshipTotal);
    const linesPreTax = roundMoney(lineTotals.reduce((sum, value) => sum + value, 0));
    lineTotals[lineTotals.length - 1] = roundMoney(
      lineTotals[lineTotals.length - 1] + targetPreTax - linesPreTax);
  }
  for (const [index, l] of lines.entries()) {
    const lineDiscount = lineDiscounts[index];
    await db.query(
      `INSERT INTO invoice_items
         (invoice_id, item_id, quantity, item_code_snapshot, item_name_snapshot, metal_type_snapshot,
          carat_snapshot, weight_g_snapshot, metal_price_snapshot, metal_cost_price,
          craftsmanship_snapshot, line_discount, cost_snapshot, line_total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        inv.id, l.item.id, l.quantity, l.item.code, l.item.name, l.item.metal_type, l.item.carat,
        l.item.weight_g ?? 0, l.unitMetalPrice, l.item.metal_price_at_add,
        roundMoney(l.craft / l.quantity), lineDiscount, l.item.cost, lineTotals[index],
      ],
    );

    const releasedReservationQty = reservedForSale.get(Number(l.item.id)) ?? 0;
    const reservedQty = Math.max(0, Number(l.item.reserved_qty ?? 0) - releasedReservationQty);
    const inTransitQty = Number(l.item.in_transit_qty ?? 0);
    const newQty = Number(l.item.quantity) - l.quantity;
    const newStatus = deriveStatus(newQty, reservedQty, inTransitQty);
    await db.query(
      `UPDATE items SET quantity=$1, reserved_qty=$2, status=$3, updated_at=now() WHERE id=$4`,
      [newQty, reservedQty, newStatus, l.item.id]);
    await db.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,'available',$2,'Sold - invoice '||$3,$4)`,
      [l.item.id, newStatus === 'available' ? 'sold' : newStatus, invoiceNo, employeeId]);
  }

  const reservationDeposit = roundMoney(reservations.reduce(
    (sum, reservation) => sum + Number(reservation.down_payment || 0), 0));
  const appliedDeposit = Math.min(reservationDeposit, totals.total);
  let payment;
  try {
    const dueNow = roundMoney(totals.total - appliedDeposit);
    payment = normalizePayment(b.paidAmount, dueNow);
  } catch (error: any) {
    throw httpError(400, error?.message || 'bad.payment');
  }
  if (appliedDeposit > 0) {
    await db.query(
      `INSERT INTO payments (invoice_id, method, amount, received_by, affects_shift)
       VALUES ($1,$2,$3,$4,false)`,
      [inv.id, b.paymentMethod || 'cash', appliedDeposit, employeeId]);
  }
  if (payment.collected > 0) {
    await db.query(
      `INSERT INTO payments (invoice_id, method, amount, received_by, affects_shift)
       VALUES ($1,$2,$3,$4,true)`,
      [inv.id, b.paymentMethod || 'cash', payment.collected, employeeId]);
  }

  if (reservationIds.length) {
    await db.query(
      `UPDATE reservations SET status='completed', invoice_id=$1
        WHERE id = ANY($2::int[]) AND status='active'`,
      [inv.id, reservationIds]);
  }

  return inv;
}

function round2(n: number) {
  return Math.round(n * 100) / 100;
}

function httpError(status: number, message: string) {
  const e: any = new Error(message);
  e.status = status;
  return e;
}

// Create sale (POS). Supports optional managerPin to exceed discount cap.
invoicesRouter.post('/', requirePermission('invoice.create'), async (req, res) => {
  const cashier = await queryOne<any>(`SELECT * FROM employees WHERE id = $1`, [req.employee!.id]);
  if (!cashier) return res.status(404).json({ error: 'notfound' });
  try {
    const inv = await tx(async (q) =>
      buildInvoice(q, req.body ?? {}, req.employee!.id, cashier,
        req.employee!.permissions.includes('invoice.discount_override')));
    await audit(poolAsQueryable(), 'invoices', inv.id, 'create', req.employee!.id, null, req.body);
    const full = await queryOne<any>(`${INVOICE_SELECT} WHERE inv.id = $1`, [inv.id]);
    const [items, payments] = await Promise.all([
      query(`SELECT ii.* FROM invoice_items ii WHERE ii.invoice_id = $1 ORDER BY ii.id`, [inv.id]),
      query(
        `SELECT p.*, e.full_name AS received_by_name FROM payments p
           LEFT JOIN employees e ON e.id = p.received_by WHERE p.invoice_id = $1`,
        [inv.id],
      ),
    ]);
    res.status(201).json({ ...camelize(full), items: camelizeRows(items), payments: camelizeRows(payments) });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

// Return / cancel an invoice: items go back to 'available' with reason + cashier.
// Idempotent: an already-returned invoice is returned as-is (safe for offline sync retries).
export async function returnInvoice(db: Queryable, invoiceId: number, employeeId: number, reason?: string) {
  const inv = await db.queryOne<any>(`SELECT * FROM invoices WHERE id = $1 FOR UPDATE`, [invoiceId]);
  if (!inv) throw httpError(404, 'notfound');
  if (inv.status !== 'active') return inv;

  const paid = await db.queryOne<any>(
    `SELECT COALESCE(SUM(amount),0) AS amount FROM payments WHERE invoice_id=$1`, [invoiceId]);
  const refundShift = Number(paid?.amount || 0) > 0
    ? await db.queryOne<any>(
      `SELECT id FROM shifts WHERE employee_id=$1 AND status='open' ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
      [employeeId])
    : null;
  if (Number(paid?.amount || 0) > 0 && !refundShift) throw httpError(409, 'shifts.open_required');

  await db.query(
    `UPDATE invoices SET status='returned', return_reason=$1, returned_at=now(), returned_by=$2
      WHERE id=$3`,
    [reason || 'Return', employeeId, invoiceId],
  );
  const soldItems = await db.query<any>(
    `SELECT item_id, quantity FROM invoice_items WHERE invoice_id=$1`, [invoiceId]);
  for (const si of soldItems) {
    const it = await db.queryOne<any>(`SELECT * FROM items WHERE id=$1 FOR UPDATE`, [si.item_id]);
    if (!it) continue;
    const newQty = Number(it.quantity) + Number(si.quantity);
    const newStatus = deriveStatus(
      newQty, Number(it.reserved_qty ?? 0), Number(it.in_transit_qty ?? 0));
    await db.query(
      `UPDATE items SET quantity=$1, status=$2, updated_at=now() WHERE id=$3`,
      [newQty, newStatus, si.item_id]);
    await db.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,'sold',$2,$3,$4)`,
      [si.item_id, newStatus, 'Invoice ' + inv.invoice_no + ' returned: ' + (reason || ''), employeeId]);
  }
  await db.query(
    `INSERT INTO refunds (payment_id,invoice_id,method,amount,shift_id,refunded_by)
     SELECT p.id,p.invoice_id,p.method,p.amount,
            $3,$2
       FROM payments p WHERE p.invoice_id=$1 AND p.amount>0
     ON CONFLICT (payment_id) DO NOTHING`,
    [invoiceId, employeeId, refundShift?.id ?? null]);
  await audit(db, 'invoices', invoiceId, 'return', employeeId, inv, { reason });
  return inv;
}

invoicesRouter.post('/:id/return', requirePermission('invoice.return'), async (req, res) => {
  const id = Number(req.params.id);
  const { reason } = req.body ?? {};
  try {
    const inv = await tx(async (q) => returnInvoice(q, id, req.employee!.id, reason));
    res.json({ id: inv.id });
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

// Helper: reuse the same pool for audit outside a transaction
export function poolAsQueryable(): Queryable {
  return {
    query: <T = any>(t: string, p?: any[]) => pool.query(t, p).then((r) => r.rows as T[]),
    queryOne: <T = any>(t: string, p?: any[]) => pool.query(t, p).then((r) => (r.rows[0] as T) ?? null),
  };
}
