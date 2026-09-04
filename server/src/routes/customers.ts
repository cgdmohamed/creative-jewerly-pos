import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit } from '../utils.js';

export const customersRouter = Router();

customersRouter.use(authenticate);

const CUSTOMER_STATS = `
  SELECT c.*,
         (SELECT COUNT(*) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'active') AS total_invoices,
         (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'active') AS total_spent,
         (SELECT MAX(i.created_at) FROM invoices i WHERE i.customer_id = c.id AND i.status = 'active') AS last_purchase_at,
         (SELECT COUNT(*) FROM reservations r WHERE r.customer_id = c.id AND r.status = 'active') AS active_reservations
    FROM customers c`;

// Any authenticated employee may look up customers (needed at POS to attach one).
customersRouter.get('/', async (req, res) => {
  const { search } = req.query;
  const params: any[] = [];
  let where = `c.is_active = TRUE`;
  if (search) {
    params.push(`%${search}%`);
    where += ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length}
                    OR COALESCE(c.email,'') ILIKE $${params.length})`;
  }
  const rows = await query(
    `${CUSTOMER_STATS} WHERE ${where} ORDER BY last_purchase_at DESC NULLS LAST, c.name LIMIT 200`, params);
  res.json(camelizeRows(rows));
});

customersRouter.get('/:id', async (req, res) => {
  const id = Number(req.params.id);
  const row = await queryOne<any>(`${CUSTOMER_STATS} WHERE c.id = $1`, [id]);
  if (!row) return res.status(404).json({ error: 'notfound' });
  res.json(camelize(row));
});

customersRouter.get('/:id/invoices', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(
    `SELECT inv.*, e.full_name AS cashier_name, l.name_ar AS location_name
       FROM invoices inv
       LEFT JOIN employees e ON e.id = inv.employee_id
       LEFT JOIN locations l ON l.id = inv.location_id
      WHERE inv.customer_id = $1
      ORDER BY inv.created_at DESC LIMIT 100`, [id]);
  res.json(camelizeRows(rows));
});

customersRouter.get('/:id/reservations', async (req, res) => {
  const id = Number(req.params.id);
  const rows = await query(
    `SELECT r.*, i.code AS item_code, i.name AS item_name
       FROM reservations r
       LEFT JOIN items i ON i.id = r.item_id
      WHERE r.customer_id = $1
      ORDER BY r.reserved_at DESC LIMIT 100`, [id]);
  res.json(camelizeRows(rows));
});

function missing(b: any): string[] {
  return ['name', 'phone'].filter((k) => !String(b[k] ?? '').trim());
}

customersRouter.post('/', requirePermission('customers.manage'), async (req, res) => {
  const b = req.body ?? {};
  const miss = missing(b);
  if (miss.length === 2) return res.status(400).json({ error: `missing:name.or.phone` });
  const name = String(b.name ?? '').trim() || `عميل ${String(b.phone ?? '').trim()}`;
  try {
    const row = await tx(async (q) => {
      const r = await q.queryOne<any>(
        `INSERT INTO customers (name, phone, email, address, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [name, b.phone ? String(b.phone).trim() : null, b.email || null,
         b.address || null, b.notes || null, req.employee!.id],
      );
      await audit(q, 'customers', r.id, 'create', req.employee!.id, null, b);
      return r;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

customersRouter.put('/:id', requirePermission('customers.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM customers WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });
  const b = req.body ?? {};
  const updated = await tx(async (q) => {
    const r = await q.queryOne<any>(
      `UPDATE customers SET
         name = COALESCE($2, name),
         phone = COALESCE($3, phone),
         email = COALESCE($4, email),
         address = COALESCE($5, address),
         notes = COALESCE($6, notes),
         is_active = COALESCE($7, is_active),
         updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id, b.name ?? null, b.phone ?? null, b.email ?? null, b.address ?? null,
       b.notes ?? null, b.isActive ?? null],
    );
    await audit(q, 'customers', id, 'update', req.employee!.id, old, r);
    return r;
  });
  res.json(camelize(updated));
});
