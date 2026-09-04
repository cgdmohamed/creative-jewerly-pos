import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { authenticate, signToken } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, audit } from '../utils.js';

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 8 });
const pinLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { identifier, pin } = req.body ?? {};
  if (!identifier || !pin) return res.status(400).json({ error: 'auth.missing' });

  const emp = await queryOne<any>(
    `SELECT e.*, r.code AS role_code, r.name_ar AS role_name, l.name_ar AS location_name
       FROM employees e
       JOIN roles r ON r.id = e.role_id
       LEFT JOIN locations l ON l.id = e.location_id
      WHERE e.username = $1 OR e.phone = $1 OR e.employee_no = $1`,
    [identifier],
  );

  if (!emp || !bcrypt.compareSync(pin, emp.pin_hash)) {
    return res.status(401).json({ error: 'auth.invalid' });
  }
  if (emp.status !== 'active') {
    return res.status(403).json({ error: 'auth.inactive' });
  }

  await query(`UPDATE employees SET last_login_at = now() WHERE id = $1`, [emp.id]);

  const perms = await query(
    `SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = $1`,
    [emp.role_id],
  );

  const token = signToken({ id: emp.id, roleCode: emp.role_code, fullName: emp.full_name });
  res.json(
    camelize({
      token,
      employee: {
        id: emp.id,
        employee_no: emp.employee_no,
        full_name: emp.full_name,
        phone: emp.phone,
        role: emp.role_name,
        role_code: emp.role_code,
        location_id: emp.location_id,
        location_name: emp.location_name,
        discount_cap_percent: emp.discount_cap_percent,
        permissions: perms.map((p: any) => p.code),
      },
    }),
  );
});

authRouter.get('/me', authenticate, async (req, res) => {
  res.json(req.employee);
});

authRouter.post('/change-pin', authenticate, async (req, res) => {
  const { currentPin, newPin } = req.body ?? {};
  if (!currentPin || !newPin) return res.status(400).json({ error: 'auth.missing' });
  const emp = await queryOne<any>(`SELECT pin_hash FROM employees WHERE id = $1`, [req.employee!.id]);
  if (!emp || !bcrypt.compareSync(currentPin, emp.pin_hash)) {
    return res.status(401).json({ error: 'auth.invalid' });
  }
  const hash = bcrypt.hashSync(newPin, 10);
  await tx(async (q) => {
    await q.query(`UPDATE employees SET pin_hash = $1 WHERE id = $2`, [hash, req.employee!.id]);
    await audit(q, 'employees', req.employee!.id, 'change_pin', req.employee!.id);
  });
  res.json({ ok: true });
});

// Screen-lock unlock: validate the logged-in employee's PIN without issuing a new token
authRouter.post('/verify-pin', authenticate, pinLimiter, async (req, res) => {
  const { pin } = req.body ?? {};
  if (!pin) return res.status(400).json({ error: 'auth.missing' });
  const emp = await queryOne<any>(`SELECT pin_hash FROM employees WHERE id = $1`, [req.employee!.id]);
  if (!emp || !bcrypt.compareSync(String(pin), emp.pin_hash)) {
    return res.status(401).json({ error: 'auth.invalid' });
  }
  res.json({ ok: true });
});
