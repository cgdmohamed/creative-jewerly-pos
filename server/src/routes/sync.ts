import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { audit, camelizeRows } from '../utils.js';
import { buildInvoice, poolAsQueryable, returnInvoice } from './invoices.js';
import { createReservation } from './reservations.js';
import { ITEM_SELECT } from './items.js';

export const syncRouter = Router();

syncRouter.use(authenticate);

const PERMS: Record<string, string> = {
  'invoice.create': 'invoice.create',
  'invoice.return': 'invoice.return',
  'reservation.create': 'reservation.manage',
};

// Client pushes offline operations queued while disconnected.
// Idempotent: an already-applied op (same device+opId) is not re-applied.
// Conflict = item no longer available (e.g. sold from another branch).
syncRouter.post('/outbox', async (req, res) => {
  const ops = req.body?.ops;
  if (!Array.isArray(ops) || ops.length === 0) return res.json({ results: [] });

  const results = [];
  for (const op of ops) {
    const { deviceId, opId, op: opType, payload } = op;
    try {
      if (!PERMS[opType] || !req.employee!.permissions.includes(PERMS[opType])) {
        throw Object.assign(new Error('forbidden'), { status: 403 });
      }

      const prior = await queryOne<any>(
        `SELECT payload->>'invoiceNo' AS invoice_no, payload->>'reservationId' AS reservation_id
           FROM sync_outbox
          WHERE device_id=$1 AND op=$2 AND payload->>'opId'=$3 AND status='applied'
          LIMIT 1`,
        [deviceId, opType, opId],
      );
      if (prior) {
        results.push({
          opId, status: 'applied',
          ...(prior.invoice_no ? { invoiceNo: prior.invoice_no } : {}),
          ...(prior.reservation_id ? { reservationId: Number(prior.reservation_id) } : {}),
        });
        continue;
      }

      let outcome: Record<string, any> = { status: 'applied' };
      if (opType === 'invoice.create') {
        const cashier = await queryOne<any>(`SELECT * FROM employees WHERE id = $1`, [req.employee!.id]);
        const inv = await tx(async (q) => buildInvoice(q, payload, req.employee!.id, cashier,
          req.employee!.permissions.includes('invoice.discount_override')));
        await audit(poolAsQueryable(), 'invoices', inv.id, 'sync_offline', req.employee!.id, null, payload);
        outcome.invoiceNo = inv.invoice_no;
      } else if (opType === 'invoice.return') {
        const inv = await tx(async (q) =>
          returnInvoice(q, Number(payload.invoiceId), req.employee!.id, payload.reason));
        outcome.invoiceNo = inv.invoice_no;
      } else if (opType === 'reservation.create') {
        const r = await tx(async (q) => createReservation(q, payload, req.employee!.id));
        outcome.reservationId = r.id;
      }

      await query(
        `INSERT INTO sync_outbox (device_id, op, payload, status, applied_at)
         VALUES ($1,$2,$3,'applied',now())`,
        [deviceId, opType, { ...payload, opId, ...outcome }],
      );
      results.push({ opId, ...outcome });
    } catch (e: any) {
      const status = e.message?.startsWith('items.not_available') ? 'conflict' : 'rejected';
      await query(
        `INSERT INTO sync_outbox (device_id, op, payload, status, conflict_note)
         VALUES ($1,$2,$3,$4,$5)`,
        [deviceId, opType, { ...(payload ?? {}), opId }, status, e.message || String(e)]);
      results.push({ opId, status, error: e.message || String(e) });
    }
  }
  res.json({ results });
});

// Client pulls the minimum dataset to cache for offline POS operation.
// Returns the same shapes as the live endpoints so the cache is a drop-in fallback.
syncRouter.get('/pull', async (_req, res) => {
  const [items, prices, locations, settings, customers] = await Promise.all([
    query(`${ITEM_SELECT} WHERE i.is_active = TRUE ORDER BY i.code`),
    query(`SELECT * FROM price_history WHERE end_date IS NULL ORDER BY metal_type, carat`),
    query(`SELECT * FROM locations WHERE is_active`),
    query(`SELECT key, value FROM app_settings`),
    query(`SELECT id, name, phone, email, address, notes, is_active, created_at
             FROM customers WHERE is_active = TRUE ORDER BY name`),
  ]);
  res.json({
    items: camelizeRows(items),
    prices: camelizeRows(prices),
    locations: camelizeRows(locations),
    settings: Object.fromEntries(settings.map((s: any) => [s.key, s.value])),
    customers: camelizeRows(customers),
    syncedAt: new Date().toISOString(),
  });
});
