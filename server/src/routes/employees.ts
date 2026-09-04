import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit } from '../utils.js';

export const employeesRouter = Router();

employeesRouter.use(authenticate);

employeesRouter.get('/', requirePermission('employees.manage'), async (_req, res) => {
  const rows = await query(
    `SELECT e.*, r.code AS role_code, r.name_ar AS role_name, l.name_ar AS location_name
       FROM employees e
       JOIN roles r ON r.id = e.role_id
       LEFT JOIN locations l ON l.id = e.location_id
      ORDER BY e.status = 'active' DESC, e.full_name`,
  );
  res.json(camelizeRows(rows));
});

employeesRouter.get('/roles', async (_req, res) => {
  res.json(camelizeRows(await query(`SELECT * FROM roles ORDER BY id`)));
});

employeesRouter.post('/', requirePermission('employees.manage'), async (req, res) => {
  const b = req.body ?? {};
  const missing = ['employeeNo', 'fullName', 'username', 'pin'].filter((k) => !b[k]);
  if (missing.length) return res.status(400).json({ error: `missing:${missing.join(',')}` });

  const pinHash = bcrypt.hashSync(String(b.pin), 10);
  try {
    const row = await tx(async (q) => {
      const r = await q.queryOne<any>(
        `INSERT INTO employees (employee_no, full_name, phone, hire_date, status, role_id, location_id,
                                discount_cap_percent, username, pin_hash, notes)
         VALUES ($1,$2,$3,COALESCE($4::date,CURRENT_DATE),$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, employee_no, full_name, username`,
        [
          b.employeeNo, b.fullName, b.phone || null,
          b.hireDate || null, b.status || 'active', b.roleId,
          b.locationId || null, b.discountCapPercent ?? 0,
          b.username, pinHash, b.notes || null,
        ],
      );
      await audit(q, 'employees', r.id, 'create', req.employee!.id, null, b);
      return r;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

employeesRouter.put('/:id', requirePermission('employees.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM employees WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });
  const b = req.body ?? {};
  const updated = await tx(async (q) => {
    const r = await q.queryOne<any>(
      `UPDATE employees SET
         full_name = COALESCE($2, full_name),
         phone = COALESCE($3, phone),
         status = COALESCE($4, status),
         role_id = COALESCE($5, role_id),
         location_id = COALESCE($6, location_id),
         discount_cap_percent = COALESCE($7, discount_cap_percent),
         notes = COALESCE($8, notes)
       WHERE id = $1 RETURNING *`,
      [id, b.fullName ?? null, b.phone ?? null, b.status ?? null, b.roleId ?? null,
       b.locationId ?? null, b.discountCapPercent ?? null, b.notes ?? null],
    );
    await audit(q, 'employees', id, 'update', req.employee!.id, old, r);
    return r;
  });
  res.json(camelize(updated));
});

employeesRouter.post('/:id/reset-pin', requirePermission('employees.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const { pin } = req.body ?? {};
  if (!pin) return res.status(400).json({ error: 'missing:pin' });
  const hash = bcrypt.hashSync(String(pin), 10);
  await tx(async (q) => {
    await q.query(`UPDATE employees SET pin_hash = $1 WHERE id = $2`, [hash, id]);
    await audit(q, 'employees', id, 'reset_pin', req.employee!.id);
  });
  res.json({ ok: true });
});
