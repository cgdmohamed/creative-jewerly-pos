import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit, deriveStatus } from '../utils.js';

export const movementsRouter = Router();

movementsRouter.use(authenticate);

movementsRouter.get('/', async (req, res) => {
  const { itemId, status } = req.query;
  const params: any[] = [];
  const conds: string[] = [];
  if (itemId) { params.push(Number(itemId)); conds.push(`m.item_id = $${params.length}`); }
  if (status) { params.push(String(status)); conds.push(`m.status = $${params.length}`); }
  const rows = await query(
    `SELECT m.*, i.code AS item_code, i.name AS item_name,
            fl.name_ar AS from_location, tl.name_ar AS to_location,
            em.full_name AS moved_by_name, er.full_name AS received_by_name
       FROM item_movements m
       JOIN items i ON i.id = m.item_id
       LEFT JOIN locations fl ON fl.id = m.from_location_id
       LEFT JOIN locations tl ON tl.id = m.to_location_id
       LEFT JOIN employees em ON em.id = m.moved_by
       LEFT JOIN employees er ON er.id = m.received_by
       ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
      ORDER BY m.moved_at DESC
      LIMIT 500`,
    params,
  );
  res.json(camelizeRows(rows));
});

// Create a transfer: quantity leaves the source as in_transit until received
movementsRouter.post('/', requirePermission('movement.create'), async (req, res) => {
  const { itemId, toLocationId, reason, quantity } = req.body ?? {};
  if (!itemId || !toLocationId) return res.status(400).json({ error: 'missing' });
  const qty = Number(quantity ?? 1);
  if (!Number.isInteger(qty) || qty < 1) return res.status(400).json({ error: 'bad.quantity' });
  const item = await queryOne<any>(`SELECT * FROM items WHERE id = $1 AND is_active`, [itemId]);
  if (!item) return res.status(404).json({ error: 'notfound' });
  const available = Number(item.quantity) - Number(item.reserved_qty ?? 0) - Number(item.in_transit_qty ?? 0);
  if (item.status !== 'available' || available < qty) {
    return res.status(409).json({ error: 'items.not_available' });
  }
  if (item.current_location_id === Number(toLocationId)) {
    return res.status(400).json({ error: 'movements.same_location' });
  }

  const row = await tx(async (q) => {
    const m = await q.queryOne<any>(
      `INSERT INTO item_movements (item_id, quantity, from_location_id, to_location_id, moved_by, reason)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [itemId, qty, item.current_location_id, toLocationId, req.employee!.id, reason || null],
    );
    const inTransit = Number(item.in_transit_qty ?? 0) + qty;
    const status = deriveStatus(Number(item.quantity), Number(item.reserved_qty ?? 0), inTransit);
    await q.query(
      `UPDATE items SET in_transit_qty = $1, status = $2, updated_at = now() WHERE id = $3`,
      [inTransit, status, itemId]);
    await q.query(
      `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
       VALUES ($1,$2,$3,$4,$5)`,
      [itemId, item.status, status, reason || 'Transfer', req.employee!.id]);
    await audit(q, 'item_movements', m.id, 'create', req.employee!.id, item, m);
    return m;
  });
  res.status(201).json(camelize(row));
});

// Mandatory receive confirmation to complete a transfer
movementsRouter.post('/:id/receive', requirePermission('movement.receive'), async (req, res) => {
  const id = Number(req.params.id);
  const m = await queryOne<any>(`SELECT * FROM item_movements WHERE id = $1`, [id]);
  if (!m) return res.status(404).json({ error: 'notfound' });
  if (m.status !== 'in_transit') return res.status(409).json({ error: 'movements.not_in_transit' });

  const row = await tx(async (q) => {
    const r = await q.queryOne<any>(
      `UPDATE item_movements SET status = 'received', received_by = $1, received_at = now()
        WHERE id = $2 RETURNING *`,
      [req.employee!.id, id]);
    const item = await q.queryOne<any>(`SELECT * FROM items WHERE id=$1`, [m.item_id]);
    if (item) {
      const inTransit = Math.max(0, Number(item.in_transit_qty ?? 0) - Number(m.quantity));
      const status = deriveStatus(Number(item.quantity), Number(item.reserved_qty ?? 0), inTransit);
      await q.query(
        `UPDATE items SET in_transit_qty=$1, current_location_id=$2, status=$3, updated_at=now() WHERE id=$4`,
        [inTransit, m.to_location_id, status, m.item_id]);
      await q.query(
        `INSERT INTO item_status_history (item_id, from_status, to_status, reason, changed_by)
         VALUES ($1,$2,$3,'Transfer received',$4)`,
        [m.item_id, item.status, status, req.employee!.id]);
    }
    await audit(q, 'item_movements', id, 'receive', req.employee!.id, m, r);
    return r;
  });
  res.json(camelize(row));
});
