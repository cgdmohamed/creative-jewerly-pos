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

type SettingRule =
  | { type: 'bool' }
  | { type: 'number'; min: number; max: number }
  | { type: 'text'; maxLength: number; allowEmpty?: boolean }
  | { type: 'enum'; values: string[] }
  | { type: 'logo' };

const SETTINGS: Record<string, SettingRule> = {
  store_name: { type: 'text', maxLength: 120 },
  cashier_discount_enabled: { type: 'bool' },
  cashier_cap_override_enabled: { type: 'bool' },
  vat_percent: { type: 'number', min: 0, max: 100 },
  label_template: {
    type: 'enum',
    values: ['basic', 'classic', 'modern', 'arabic-focus', 'slogan', 'metal-first', 'simple-arabic', 'premium-text', 'clean-bold'],
  },
  label_logo_data_url: { type: 'logo' },
  label_logo_enabled: { type: 'bool' },
  label_brand_name: { type: 'text', maxLength: 80 },
  label_printer_name: { type: 'text', maxLength: 120 },
  label_offset_x_mm: { type: 'number', min: -5, max: 5 },
  label_offset_y_mm: { type: 'number', min: -5, max: 5 },
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
  for (const [key, rule] of Object.entries(SETTINGS)) {
    if (body[key] == null) continue;
    if (rule.type === 'bool') {
      updates[key] = body[key] === true || body[key] === 'true' ? 'true' : 'false';
    } else if (rule.type === 'number') {
      const n = Number(body[key]);
      if (Number.isNaN(n)) return res.status(400).json({ error: `bad.${key}` });
      updates[key] = String(Math.min(rule.max, Math.max(rule.min, n)));
    } else if (rule.type === 'enum') {
      const value = String(body[key]);
      if (!rule.values.includes(value)) return res.status(400).json({ error: `bad.${key}` });
      updates[key] = value;
    } else if (rule.type === 'logo') {
      const value = String(body[key]);
      if (value && (!/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(value) || value.length > 750_000)) {
        return res.status(400).json({ error: `bad.${key}` });
      }
      updates[key] = value;
    } else {
      const value = String(body[key]).trim();
      if ((!value && !rule.allowEmpty) || value.length > rule.maxLength) {
        return res.status(400).json({ error: `bad.${key}` });
      }
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
  const auditUpdates = { ...updates };
  if (auditUpdates.label_logo_data_url) {
    auditUpdates.label_logo_data_url = `[thermal logo: ${auditUpdates.label_logo_data_url.length} bytes]`;
  }
  await audit(poolAsQueryable(), 'app_settings', 'settings', 'update', req.employee!.id, null, auditUpdates);
  res.json(updates);
});
