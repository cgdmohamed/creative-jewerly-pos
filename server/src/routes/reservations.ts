import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx, Queryable } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus } from '../utils.js';

export const reservationsRouter = Router();

reservationsRouter.use(authenticate);

reservationsRouter.get('/', async (req, res) => {
  const { status } = req.query;
  const rows = await query(
    `SELECT r.*, i.code AS item_code, i.name AS item_name, i.weight_g, i.metal_type, i.carat,
            e.full_name AS reserved_by_name
       FROM reservations r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN employees e ON e.id = r.reserved_by
       ${status ? 'WHERE r.status = $1' : ''}
      ORDER BY r.reserved_at DESC LIMIT 300`,
    status ? [String(status)] : [],
  );
  res.json(camelizeRows(rows));
});

function badRequest(message: string): never {
  const e: any = new Error(message);
  e.status = 400;
  throw e;
}

// Reserve quantity of an item with down payment (عربون). Holds reserved_qty.
export async function createReservation(db: Queryable, b: any, employeeId: number) {
  const { itemId, customerName, customerPhone, customerId, downPayment, totalValue, notes, quantity } = b ?? {};
  if (!itemId || (!customerName && !customerId) || downPayment == null || totalValue == null) badRequest('missing');
  const qty = Number(quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1) badRequest('bad.quantity');
  const item = await db.queryOne<any>(`SELECT * FROM items WHERE id = $1 AND is_active`, [itemId]);
  if (!item) {
    const e: any = new Error('notfound');
    e.status = 404;
    throw e;
  }
  const available = Number(item.quantity) - Number(item.reserved_qty ?? 0) - Number(item.in_transit_qty ?? 0);
  if (item.status !== 'available' || available < qty) {
    const e: any = new Error(`items.not_available:${item.code}`);
    e.status = 409;
    throw e;
  }

  // Optional customer link: use the record's name/phone as the snapshot source.
  let cid: number | null = null;
  let name = customerName;
  let phone = customerPhone || null;
  if (customerId) {
    const customer = await db.queryOne<any>(`SELECT * FROM customers WHERE id = $1`, [Number(customerId)]);
    if (!customer) {
      const e: any = new Error('customers.notfound');
      e.status = 404;
      throw e;
    }
    cid = customer.id;
    name = customer.name;
    phone = customer.phone || phone;
  }

  const r = await db.queryOne<any>(
    `INSERT INTO reservations (item_id, quantity, customer_id, customer_name, customer_phone, down_payment, total_value,
                               remaining_due, reserved_by, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [itemId, qty, cid, name, phone, downPayment, totalValue,
     Math.max(0, totalValue - downPayment), employeeId, notes || null],
  );
  const reservedQty = Number(item.reserved_qty ?? 0) + qty;
  const status = deriveStatus(Number(item.quantity), reservedQty, Number(item.in_transit_qty ?? 0));
  await db.query(
    `UPDATE items SET reserved_qty=$1, status=$2, updated_at=now() WHERE id=$3`,
    [reservedQty, status, itemId]);
  await db.query(
    `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
     VALUES ($1,$2,$3,$4,$5)`,
    [itemId, item.status, status, 'Reserved with down payment', employeeId]);
  await audit(db, 'reservations', r.id, 'create', employeeId, null, r);
  return r;
}

reservationsRouter.post('/', requirePermission('reservation.manage'), async (req, res) => {
  try {
    const r = await tx(async (q) => createReservation(q, req.body ?? {}, req.employee!.id));
    res.status(201).json(camelize(r));
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

reservationsRouter.post('/:id/cancel', requirePermission('reservation.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const r = await queryOne<any>(`SELECT * FROM reservations WHERE id = $1`, [id]);
  if (!r) return res.status(404).json({ error: 'notfound' });
  if (r.status !== 'active') return res.status(409).json({ error: 'reservation.not_active' });

  await tx(async (q) => {
    await q.query(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [id]);
    const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1`, [r.item_id]);
    if (item) {
      const reservedQty = Math.max(0, Number(item.reserved_qty ?? 0) - Number(r.quantity));
      const status = deriveStatus(
        Number(item.quantity), reservedQty, Number(item.in_transit_qty ?? 0));
      await q.query(
        `UPDATE items SET reserved_qty=$1, status=$2, updated_at=now() WHERE id=$3`,
        [reservedQty, status, r.item_id]);
      await q.query(
        `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
         VALUES ($1,$2,$3,'Reservation cancelled',$4)`,
        [r.item_id, item.status, status, req.employee!.id]);
    }
    await audit(q, 'reservations', id, 'cancel', req.employee!.id, r, {});
  });
  res.json({ ok: true });
});
