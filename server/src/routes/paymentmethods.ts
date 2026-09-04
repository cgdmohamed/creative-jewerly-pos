import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne } from '../db.js';
import { camelize, camelizeRows } from '../utils.js';

export const paymentMethodsRouter = Router();

paymentMethodsRouter.use(authenticate);

const slug = (s: string) =>
  String(s ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);

// القائمة: النشط أولًا مع إحصاء الاستخدام خلال آخر 30 يومًا
paymentMethodsRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT pm.*,
            (SELECT COUNT(*) FROM invoices i WHERE i.payment_method = pm.code AND i.created_at >= CURRENT_DATE - interval '30 days') AS invoices_30d,
            (SELECT COALESCE(ROUND(SUM(i.total),2),0) FROM invoices i WHERE i.payment_method = pm.code AND i.created_at >= CURRENT_DATE - interval '30 days') AS total_30d
       FROM payment_methods pm
      ORDER BY pm.is_active DESC, pm.sort_order, pm.id`);
  res.json(camelizeRows(rows));
});

// إضافة طريقة دفع جديدة
paymentMethodsRouter.post('/', requirePermission('settings.manage'), async (req, res) => {
  const { nameAr, nameEn, color, code } = req.body ?? {};
  if (!nameAr) return res.status(400).json({ error: 'missing:nameAr' });
  const methodCode = slug(code || nameAr) || `method_${Date.now().toString(36)}`;
  const exists = await queryOne<any>(`SELECT id FROM payment_methods WHERE code = $1`, [methodCode]);
  if (exists) return res.status(409).json({ error: 'payment_methods.duplicate' });
  const row = await query(
    `INSERT INTO payment_methods (code, name_ar, name_en, color)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [methodCode, nameAr, nameEn || null, color || '#64748b'],
  );
  res.status(201).json(camelize(row[0]));
});

// تعديل / إيقاف طريقة دفع (لا يُحذف نهائيًا ليبقى التاريخ سليمًا)
paymentMethodsRouter.patch('/:id', requirePermission('settings.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const cur = await queryOne<any>(`SELECT * FROM payment_methods WHERE id = $1`, [id]);
  if (!cur) return res.status(404).json({ error: 'notfound' });
  const { nameAr, nameEn, color, isActive, sortOrder } = req.body ?? {};
  const row = await query(
    `UPDATE payment_methods SET
       name_ar = $2, name_en = $3, color = $4, is_active = $5, sort_order = $6
     WHERE id = $1 RETURNING *`,
    [
      id,
      nameAr ?? cur.name_ar,
      nameEn !== undefined ? nameEn : cur.name_en,
      color ?? cur.color,
      isActive !== undefined ? !!isActive : cur.is_active,
      sortOrder !== undefined ? Number(sortOrder) : cur.sort_order,
    ],
  );
  res.json(camelize(row[0]));
});
