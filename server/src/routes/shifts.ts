import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { camelize, camelizeRows, audit } from '../utils.js';

export const shiftsRouter = Router();

shiftsRouter.use(authenticate);

shiftsRouter.get('/', async (req, res) => {
  const rows = await query(
    `SELECT s.*, e.full_name AS employee_name, l.name_ar AS location_name,
            sr.expected_cash, sr.counted_cash, sr.difference, sr.reconciled_at, sr.methods,
            CASE WHEN sr.methods IS NOT NULL AND jsonb_array_length(sr.methods) > 0
              THEN (SELECT COALESCE(SUM((m->>'expected')::numeric),0) FROM jsonb_array_elements(sr.methods) m)
              ELSE sr.expected_cash END AS expected_total,
            CASE WHEN sr.methods IS NOT NULL AND jsonb_array_length(sr.methods) > 0
              THEN (SELECT COALESCE(SUM((m->>'counted')::numeric),0) FROM jsonb_array_elements(sr.methods) m)
              ELSE sr.counted_cash END AS counted_total,
            CASE WHEN sr.methods IS NOT NULL AND jsonb_array_length(sr.methods) > 0
              THEN (SELECT COALESCE(SUM((m->>'difference')::numeric),0) FROM jsonb_array_elements(sr.methods) m)
              ELSE sr.difference END AS difference_total
       FROM shifts s
       JOIN employees e ON e.id = s.employee_id
       JOIN locations l ON l.id = s.location_id
       LEFT JOIN shift_reconciliations sr ON sr.shift_id = s.id
      ORDER BY s.opened_at DESC LIMIT 300`,
  );
  res.json(camelizeRows(rows));
});

shiftsRouter.get('/current', async (req, res) => {
  const row = await queryOne<any>(
    `SELECT s.*, l.name_ar AS location_name
       FROM shifts s JOIN locations l ON l.id = s.location_id
      WHERE s.employee_id = $1 AND s.status = 'open' ORDER BY s.opened_at DESC LIMIT 1`,
    [req.employee!.id]);
  if (!row) return res.json(null);

  const totals = await query<any>(
    `SELECT p.method, COALESCE(SUM(p.amount),0) AS expected
       FROM payments p JOIN invoices inv ON inv.id = p.invoice_id
      WHERE inv.shift_id = $1 AND inv.status = 'active'
      GROUP BY p.method`,
    [row.id],
  );
  const names = await query<any>(`SELECT code, name_ar FROM payment_methods`);
  const nameByCode: Record<string, string> = {};
  for (const n of names) nameByCode[n.code] = n.name_ar;

  const out: any = camelize(row);
  out.methodTotals = totals.map((t: any) => ({
    code: t.method,
    name: nameByCode[t.method] ?? t.method,
    expected: Number(t.expected),
  }));
  res.json(out);
});

shiftsRouter.post('/open', async (req, res) => {
  const { locationId } = req.body ?? {};
  const open = await queryOne<any>(
    `SELECT id FROM shifts WHERE employee_id=$1 AND status='open'`, [req.employee!.id]);
  if (open) return res.json(camelize(open));

  const row = await queryOne<any>(
    `INSERT INTO shifts (employee_id, location_id) VALUES ($1,$2) RETURNING *`,
    [req.employee!.id, locationId || req.employee!.locationId || 1]);
  res.status(201).json(camelize(row));
});

// Mandatory shift closing with per-method reconciliation (cash + all payment methods)
shiftsRouter.post('/:id/close', requirePermission('shift.close'), async (req, res) => {
  const id = Number(req.params.id);
  const { countedCash, counted, notes } = req.body ?? {};
  if (countedCash == null && !counted) return res.status(400).json({ error: 'missing:counted' });

  const shift = await queryOne<any>(`SELECT * FROM shifts WHERE id = $1`, [id]);
  if (!shift) return res.status(404).json({ error: 'notfound' });
  if (shift.status !== 'open') return res.status(409).json({ error: 'shifts.closed' });

  const row = await tx(async (q) => {
    const totals = await q.query<any>(
      `SELECT p.method, COALESCE(SUM(p.amount),0) AS expected
         FROM payments p JOIN invoices inv ON inv.id = p.invoice_id
        WHERE inv.shift_id = $1 AND inv.status = 'active'
        GROUP BY p.method`, [id]);
    const expectedByMethod: Record<string, number> = {};
    for (const t of totals) expectedByMethod[t.method] = Number(t.expected);

    const names = await q.query<any>(`SELECT code, name_ar FROM payment_methods`);
    const nameByCode: Record<string, string> = {};
    for (const n of names) nameByCode[n.code] = n.name_ar;

    const countedMap: Record<string, number> = {};
    if (counted && typeof counted === 'object') {
      for (const [code, v] of Object.entries(counted)) {
        if (v != null && v !== '') countedMap[code] = round2(Number(v));
      }
    }
    if (countedCash != null && countedCash !== '') countedMap.cash = round2(Number(countedCash));

    const codes = Array.from(new Set([...Object.keys(expectedByMethod), ...Object.keys(countedMap)]));
    const methodsArr = codes
      .sort()
      .map((code) => {
        const expected = round2(expectedByMethod[code] ?? 0);
        const counted = round2(countedMap[code] ?? 0);
        return { code, name: nameByCode[code] ?? code, expected, counted, difference: round2(counted - expected) };
      });
    const totalDifference = round2(methodsArr.reduce((s, m) => s + m.difference, 0));

    const cash = methodsArr.find((m) => m.code === 'cash');
    const expectedCash = cash?.expected ?? 0;
    const countedCashVal = cash?.counted ?? 0;
    const diff = round2(countedCashVal - expectedCash);

    await q.query(`UPDATE shifts SET status='closed', closed_at=now(), closed_by=$1, notes=$2 WHERE id=$3`,
      [req.employee!.id, notes || null, id]);
    const sr = await q.queryOne<any>(
      `INSERT INTO shift_reconciliations (shift_id, expected_cash, counted_cash, difference, methods, notes, reconciled_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [id, expectedCash, countedCashVal, diff, JSON.stringify(methodsArr), notes || null, req.employee!.id]);
    await audit(q, 'shifts', id, 'close', req.employee!.id, shift,
      { expectedCash, countedCash: countedCashVal, difference: diff, methods: methodsArr });
    return {
      shiftId: id,
      expectedCash, countedCash: countedCashVal, difference: diff,
      totalDifference, methods: methodsArr,
    };
  });
  res.json(camelize(row));
});

function round2(n: number) {
  return Math.round(n * 100) / 100;
}
