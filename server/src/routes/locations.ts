import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit } from '../utils.js';

export const locationsRouter = Router();

locationsRouter.use(authenticate);

locationsRouter.get('/', async (_req, res) => {
  res.json(camelizeRows(await query(`SELECT * FROM locations ORDER BY code`)));
});

locationsRouter.post('/', requirePermission('locations.manage'), async (req, res) => {
  const b = req.body ?? {};
  if (!b.code || !b.nameAr) return res.status(400).json({ error: 'missing' });
  const code = String(b.code).trim().toUpperCase();
  const nameAr = String(b.nameAr).trim();
  try {
    const row = await tx(async (q) => {
      const r = await q.queryOne<any>(
        `INSERT INTO locations (code, name_ar, name_en) VALUES ($1,$2,$3) RETURNING *`,
        [code, nameAr, b.nameEn || null]);
      await audit(q, 'locations', r.id, 'create', req.employee!.id, null, { ...b, code, nameAr });
      return r;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

locationsRouter.put('/:id', requirePermission('locations.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM locations WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });
  const b = req.body ?? {};
  const row = await tx(async (q) => {
    const r = await q.queryOne<any>(
      `UPDATE locations SET code = COALESCE($2,code), name_ar = COALESCE($3,name_ar),
         name_en = COALESCE($4,name_en), is_active = COALESCE($5,is_active)
       WHERE id = $1 RETURNING *`,
      [id, b.code ? String(b.code).trim().toUpperCase() : null, b.nameAr ?? null, b.nameEn ?? null, b.isActive ?? null]);
    await audit(q, 'locations', id, 'update', req.employee!.id, old, b);
    return r;
  });
  res.json(camelize(row));
});

locationsRouter.delete('/:id', requirePermission('locations.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const loc = await queryOne<any>(`SELECT * FROM locations WHERE id = $1`, [id]);
  if (!loc) return res.status(404).json({ error: 'notfound' });

  const refs = await queryOne<any>(
    `SELECT
       (SELECT count(*)::int FROM items           WHERE current_location_id = $1) AS items,
       (SELECT count(*)::int FROM employees       WHERE location_id = $1)          AS employees,
       (SELECT count(*)::int FROM invoices        WHERE location_id = $1)          AS invoices,
       (SELECT count(*)::int FROM shifts          WHERE location_id = $1)          AS shifts,
       (SELECT count(*)::int FROM stock_counts    WHERE location_id = $1)          AS stock_counts,
       (SELECT count(*)::int FROM item_movements  WHERE from_location_id = $1 OR to_location_id = $1) AS movements`,
    [id]);

  if (refs.employees > 0) {
    return res.status(409).json({ error: 'locations.in_use', message: `لا يمكن الحذف — انقل الموظفين من هذا الفرع أولاً (${refs.employees} موظف)` });
  }
  if (refs.invoices > 0) {
    return res.status(409).json({ error: 'locations.in_use', message: `لا يمكن حذف فرع عليه فواتير سابقة (${refs.invoices} فاتورة)` });
  }
  if (refs.shifts > 0) {
    return res.status(409).json({ error: 'locations.in_use', message: `لا يمكن الحذف — للفرع شيفتات مسجلة (${refs.shifts})` });
  }
  if (refs.stock_counts > 0) {
    return res.status(409).json({ error: 'locations.in_use', message: `لا يمكن الحذف — للفرع جرد سابق (${refs.stock_counts})` });
  }

  // Movements reference this branch via FKs (to_location_id NOT NULL), so they
  // are redirected to the target branch like the items — they track physical
  // goods, not history. A target branch is therefore required whenever the
  // location has items OR movements.
  const moveTo = Number(req.body?.moveToLocationId) || null;
  if (refs.items > 0 || refs.movements > 0) {
    if (!moveTo) return res.status(400).json({ error: 'moveTo.required', message: 'اختر الفرع الذي تنتقل إليه المنتجات قبل الحذف' });
    if (moveTo === id) return res.status(400).json({ error: 'moveTo.same' });
    const target = await queryOne<any>(`SELECT id FROM locations WHERE id = $1 AND is_active`, [moveTo]);
    if (!target) return res.status(400).json({ error: 'moveTo.notfound', message: 'الفرع المستهدف غير موجود أو غير نشط' });
  }

  await tx(async (q) => {
    if (refs.items > 0) {
      const moved = await q.query<any>(
        `UPDATE items SET current_location_id = $1, updated_at = now()
          WHERE current_location_id = $2 RETURNING id`, [moveTo, id]);
      for (const r of moved) {
        await audit(q, 'items', r.id, 'update', req.employee!.id,
          { current_location_id: id }, { current_location_id: moveTo, reason: 'location_deleted' });
      }
    }
    let movedMovements = 0;
    if (refs.movements > 0) {
      const res2 = await q.query<any>(
        `UPDATE item_movements SET to_location_id = $1 WHERE to_location_id = $2 RETURNING id`, [moveTo, id]);
      movedMovements += res2.length;
      const res3 = await q.query<any>(
        `UPDATE item_movements SET from_location_id = $1 WHERE from_location_id = $2 RETURNING id`, [moveTo, id]);
      movedMovements += res3.length;
      await audit(q, 'item_movements', `${id}`, 'update', req.employee!.id,
        { from_location_id: id, to_location_id: id }, { from_location_id: moveTo, to_location_id: moveTo, reason: 'location_deleted' });
    }
    await q.query(`DELETE FROM locations WHERE id = $1`, [id]);
    await audit(q, 'locations', id, 'delete', req.employee!.id, loc, { ...req.body, movedItems: refs.items, movedMovements });
  });
  res.json({ ok: true, movedItems: refs.items, movedMovements: refs.movements });
});

export const categoriesRouter = Router();
categoriesRouter.use(authenticate);

categoriesRouter.get('/', async (_req, res) => {
  const rows = await query(
    `SELECT c.*, (SELECT count(*)::int FROM items i WHERE i.category_id = c.id) AS item_count
       FROM categories c ORDER BY c.code`,
  );
  res.json(camelizeRows(rows));
});

categoriesRouter.post('/', requirePermission('inventory.manage'), async (req, res) => {
  const b = req.body ?? {};
  if (!b.code || !b.nameAr) return res.status(400).json({ error: 'missing' });
  const code = String(b.code).trim().toUpperCase();
  const nameAr = String(b.nameAr).trim();
  try {
    const row = await tx(async (q) => {
      const r = await q.queryOne<any>(
        `INSERT INTO categories (code, name_ar, name_en) VALUES ($1,$2,$3) RETURNING *`,
        [code, nameAr, b.nameEn || null],
      );
      await audit(q, 'categories', r.id, 'create', req.employee!.id, null, { ...b, code, nameAr });
      return r;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

categoriesRouter.put('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const old = await queryOne<any>(`SELECT * FROM categories WHERE id = $1`, [id]);
  if (!old) return res.status(404).json({ error: 'notfound' });
  const b = req.body ?? {};
  try {
    const updated = await tx(async (q) => {
      const r = await q.queryOne<any>(
        `UPDATE categories SET code = COALESCE($2, code), name_ar = COALESCE($3, name_ar),
                name_en = COALESCE($4, name_en), is_active = COALESCE($5, is_active)
          WHERE id = $1 RETURNING *`,
        [
          id,
          b.code ? String(b.code).trim().toUpperCase() : null,
          b.nameAr ?? null,
          b.nameEn ?? null,
          b.isActive ?? null,
        ],
      );
      await audit(q, 'categories', id, 'update', req.employee!.id, old, b);
      return r;
    });
    res.json(camelize(updated));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'duplicate' });
    throw e;
  }
});

categoriesRouter.delete('/:id', requirePermission('inventory.manage'), async (req, res) => {
  const id = Number(req.params.id);
  const cat = await queryOne<any>(`SELECT * FROM categories WHERE id = $1`, [id]);
  if (!cat) return res.status(404).json({ error: 'notfound' });

  const used = await queryOne<any>(
    `SELECT count(*)::int AS n FROM items WHERE category_id = $1`, [id]);
  if (used.n > 0) {
    return res.status(409).json({
      error: 'categories.in_use',
      message: `لا يمكن حذف فئة عليها قطع (${used.n}) — انقل القطع إلى فئة أخرى أولاً`,
    });
  }

  await tx(async (q) => {
    await q.query(`DELETE FROM categories WHERE id = $1`, [id]);
    await audit(q, 'categories', id, 'delete', req.employee!.id, cat, {});
  });
  res.json({ ok: true });
});
