import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query } from '../db.js';
import { audit } from '../utils.js';
import { poolAsQueryable } from './invoices.js';

export const settingsRouter = Router();

settingsRouter.get('/public', async (_req, res) => {
  const rows = await query(`SELECT key, value FROM app_settings WHERE key = 'store_name'`);
  res.json({ store_name: rows[0]?.value ?? '' });
});

settingsRouter.use(authenticate);

const SETTINGS: Record<string, 'bool' | 'number' | 'text'> = {
  store_name: 'text',
  cashier_discount_enabled: 'bool',
  cashier_cap_override_enabled: 'bool',
  vat_percent: 'number',
};

settingsRouter.get('/', async (_req, res) => {
  const rows = await query(`SELECT key, value FROM app_settings`);
  const settings: Record<string, string> = {};
  for (const r of rows) settings[r.key] = r.value;
  res.json(settings);
});

// Update feature settings (currently: cashier discount toggles + VAT percent)
settingsRouter.put('/', requirePermission('settings.manage'), async (req, res) => {
  const body = req.body ?? {};
  const updates: Record<string, string> = {};
  for (const [key, type] of Object.entries(SETTINGS)) {
    if (body[key] == null) continue;
    if (type === 'bool') {
      updates[key] = body[key] ? 'true' : 'false';
    } else if (type === 'number') {
      const n = Number(body[key]);
      if (Number.isNaN(n)) return res.status(400).json({ error: `bad.${key}` });
      updates[key] = String(Math.min(100, Math.max(0, n)));
    } else {
      const value = String(body[key]).trim();
      if (!value || value.length > 120) return res.status(400).json({ error: `bad.${key}` });
      updates[key] = value;
    }
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'missing:settings' });
  }
  for (const [key, value] of Object.entries(updates)) {
    await query(
      `INSERT INTO app_settings (key, value) VALUES ($1,$2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, value]);
  }
  await audit(poolAsQueryable(), 'app_settings', 'settings', 'update', req.employee!.id, null, updates);
  res.json(updates);
});
