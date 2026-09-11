import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, tx, Queryable } from '../db.js';
import { calculateInvoiceTotals, computeUnitCraftsmanship } from '../accounting.js';
import { camelize, camelizeRows, audit, deriveStatus, todayLocal } from '../utils.js';

export const reservationsRouter = Router();

reservationsRouter.use(authenticate);

reservationsRouter.get('/', async (req, res) => {
  const { status } = req.query;
  const rows = await query(
    `SELECT r.*, i.code AS item_code, i.name AS item_name, i.weight_g, i.metal_type, i.carat,
            e.full_name AS reserved_by_name, inv.invoice_no
       FROM reservations r
       JOIN items i ON i.id = r.item_id
       LEFT JOIN employees e ON e.id = r.reserved_by
       LEFT JOIN invoices inv ON inv.id = r.invoice_id
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
  const { itemId, customerName, customerPhone, customerId, downPayment, notes, quantity } = b ?? {};
  const externalRef = String(b?.externalRef || '').trim() || null;
  if (externalRef) {
    const prior = await db.queryOne<any>(`SELECT * FROM reservations WHERE external_ref=$1`, [externalRef]);
    if (prior) {
      if (prior.status === 'active') return prior;
      throw Object.assign(new Error('reservations.external_ref_closed'), { status: 409 });
    }
  }
  if (!itemId || (!customerName && !customerId) || downPayment == null) badRequest('missing');
  const qty = Number(quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1) badRequest('bad.quantity');
  const down = Number(downPayment);
  if (!Number.isFinite(down) || down < 0) {
    badRequest('bad.payment');
  }
  const item = await db.queryOne<any>(`SELECT * FROM items WHERE id = $1 AND is_active FOR UPDATE`, [itemId]);
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

  const vatPercent = Number((await db.queryOne<any>(
    `SELECT value FROM app_settings WHERE key='vat_percent'`))?.value ?? 0);
  let weightSnapshot = 0;
  let metalPriceSnapshot = 0;
  let metalSubtotal = 0;
  let craftsmanshipTotal = 0;
  if (item.product_kind === 'general') {
    const salePrice = Number(item.sale_price);
    if (!(salePrice > 0)) {
      throw Object.assign(new Error(`items.no_sale_price:${item.code}`), { status: 409 });
    }
    craftsmanshipTotal = salePrice * qty;
  } else {
    weightSnapshot = Number(item.weight_g);
    const price = await db.queryOne<any>(
      `SELECT price_per_gram FROM price_history
        WHERE metal_type=$1 AND COALESCE(carat,'')=COALESCE($2,'')
          AND effective_date=$3 AND end_date IS NULL`,
      [item.metal_type, item.carat || null, todayLocal()]);
    if (!price) {
      throw Object.assign(new Error(`prices.missing_today:${item.metal_type}:${item.carat || '-'}`), { status: 409 });
    }
    metalPriceSnapshot = Number(price.price_per_gram);
    const unitMetal = weightSnapshot * metalPriceSnapshot;
    metalSubtotal = unitMetal * qty;
    craftsmanshipTotal = computeUnitCraftsmanship(
      item.craftsmanship_type,
      Number(item.craftsmanship_value),
      weightSnapshot,
      unitMetal,
    ) * qty;
  }
  const quote = calculateInvoiceTotals({ metalSubtotal, craftsmanshipSubtotal: craftsmanshipTotal, vatPercent });
  const total = quote.total;
  if (down > total) badRequest('bad.payment');

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
                               remaining_due, reserved_by, notes, external_ref, weight_g_snapshot,
                               metal_price_snapshot, metal_subtotal_snapshot, craftsmanship_total_snapshot,
                               vat_percent_snapshot, vat_amount_snapshot)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *`,
    [itemId, qty, cid, name, phone, down, total,
      Math.round((total - down) * 100) / 100, employeeId, notes || null, externalRef,
      weightSnapshot, metalPriceSnapshot, quote.metalSubtotal, quote.craftsmanshipTotal,
      quote.vatPercent, quote.vatAmount],
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

// Cross-system callers use atomic batches so an order can never hold only some
// of its requested pieces after a validation or network-visible error.
reservationsRouter.post('/batch', requirePermission('reservation.manage'), async (req, res) => {
  const rows = Array.isArray(req.body?.reservations) ? req.body.reservations : [];
  if (!rows.length) return res.status(400).json({ error: 'missing:reservations' });
  try {
    const created = await tx(async (q) => {
      const out = [];
      for (const body of rows) out.push(await createReservation(q, body, req.employee!.id));
      return out;
    });
    res.status(201).json({ reservations: camelizeRows(created) });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

reservationsRouter.post('/cancel-batch', requirePermission('reservation.manage'), async (req, res) => {
  const ids: number[] = [...new Set<number>((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return res.status(400).json({ error: 'missing:ids' });
  try {
    await tx(async (q) => {
      const rows = await q.query<any>(
        `SELECT * FROM reservations WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids]);
      if (rows.length !== ids.length || rows.some((r: any) => r.status === 'completed')) {
        throw Object.assign(new Error('reservations.not_all_active'), { status: 409 });
      }
      for (const r of rows) {
        if (r.status === 'cancelled') continue;
        const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1 FOR UPDATE`, [r.item_id]);
        if (!item || Number(item.reserved_qty) < Number(r.quantity)) {
          throw Object.assign(new Error(`reservations.inventory_mismatch:${r.id}`), { status: 409 });
        }
        const reserved = Number(item.reserved_qty) - Number(r.quantity);
        const status = deriveStatus(Number(item.quantity), reserved, Number(item.in_transit_qty));
        await q.query(`UPDATE items SET reserved_qty=$1,status=$2,updated_at=now() WHERE id=$3`, [reserved, status, item.id]);
        await q.query(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [r.id]);
        await q.query(`INSERT INTO item_status_history (item_id,from_status,to_status,reason,changed_by)
          VALUES ($1,$2,$3,'Reservation batch cancelled',$4)`, [item.id, item.status, status, req.employee!.id]);
        await audit(q, 'reservations', r.id, 'cancel', req.employee!.id, r, { batch: true });
      }
    });
    res.json({ ok: true });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

reservationsRouter.post('/replace-batch', requirePermission('reservation.manage'), async (req, res) => {
  const ids: number[] = [...new Set<number>((Array.isArray(req.body?.ids) ? req.body.ids : []).map(Number))]
    .filter((id) => Number.isInteger(id) && id > 0);
  const replacements = Array.isArray(req.body?.reservations) ? req.body.reservations : [];
  if (!ids.length || !replacements.length) return res.status(400).json({ error: 'missing:reservations' });
  try {
    const created = await tx(async (q) => {
      const rows = await q.query<any>(`SELECT * FROM reservations WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE`, [ids]);
      if (rows.length !== ids.length || rows.some((r: any) => r.status === 'completed')) {
        throw Object.assign(new Error('reservations.not_all_active'), { status: 409 });
      }
      for (const r of rows) {
        if (r.status === 'cancelled') continue;
        const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1 FOR UPDATE`, [r.item_id]);
        if (!item || Number(item.reserved_qty) < Number(r.quantity)) {
          throw Object.assign(new Error(`reservations.inventory_mismatch:${r.id}`), { status: 409 });
        }
        const reserved = Number(item.reserved_qty) - Number(r.quantity);
        await q.query(`UPDATE items SET reserved_qty=$1,status=$2,updated_at=now() WHERE id=$3`,
          [reserved, deriveStatus(Number(item.quantity), reserved, Number(item.in_transit_qty)), item.id]);
        await q.query(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [r.id]);
      }
      const out = [];
      for (const body of replacements) out.push(await createReservation(q, body, req.employee!.id));
      await audit(q, 'reservations', ids.join(','), 'replace_batch', req.employee!.id, { ids }, { created: out.map((r: any) => r.id) });
      return out;
    });
    res.status(201).json({ reservations: camelizeRows(created) });
  } catch (e: any) { res.status(e.status || 500).json({ error: e.message || 'error' }); }
});

reservationsRouter.post('/:id/cancel', requirePermission('reservation.manage'), async (req, res) => {
  const id = Number(req.params.id);
  try {
    await tx(async (q) => {
    const r = await q.queryOne<any>(`SELECT * FROM reservations WHERE id = $1 FOR UPDATE`, [id]);
    if (!r) {
      const e: any = new Error('notfound'); e.status = 404; throw e;
    }
    if (r.status === 'cancelled') return;
    if (r.status !== 'active') {
      const e: any = new Error('reservation.not_active'); e.status = 409; throw e;
    }
    await q.query(`UPDATE reservations SET status='cancelled' WHERE id=$1`, [id]);
    const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1 FOR UPDATE`, [r.item_id]);
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
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});
