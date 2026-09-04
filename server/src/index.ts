import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { config } from './config.js';
import { authenticate } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { employeesRouter } from './routes/employees.js';
import { locationsRouter, categoriesRouter } from './routes/locations.js';
import { itemsRouter } from './routes/items.js';
import { pricesRouter } from './routes/prices.js';
import { movementsRouter } from './routes/movements.js';
import { stockCountsRouter } from './routes/stockcounts.js';
import { invoicesRouter } from './routes/invoices.js';
import { reservationsRouter } from './routes/reservations.js';
import { shiftsRouter } from './routes/shifts.js';
import { reportsRouter } from './routes/reports.js';
import { syncRouter } from './routes/sync.js';
import { stockLimitsRouter } from './routes/stocklimits.js';
import { dashboardRouter } from './routes/dashboard.js';
import { paymentMethodsRouter } from './routes/paymentmethods.js';
import { settingsRouter } from './routes/settings.js';
import { customersRouter } from './routes/customers.js';
import { alertsRouter } from './routes/alerts.js';
import { woocommerceRouter, runAutoSync } from './routes/woocommerce.js';

const app = express();
app.use(
  cors({
    origin: (origin, cb) => {
      // No Origin header = same-origin or non-browser request; allow.
      if (!origin || config.corsOrigins.includes(origin)) return cb(null, true);
      return cb(null, false);
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'],
  }),
);
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-site');
  next();
});
app.use(express.json({ limit: '5mb' }));

fs.mkdirSync(config.uploadDir, { recursive: true });
app.use('/uploads', express.static(path.resolve(config.uploadDir)));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use('/api/auth', authRouter);
app.use('/api/employees', employeesRouter);
app.use('/api/locations', locationsRouter);
app.use('/api/categories', categoriesRouter);
app.use('/api/items', itemsRouter);
app.use('/api/prices', pricesRouter);
app.use('/api/movements', movementsRouter);
app.use('/api/stock-counts', stockCountsRouter);
app.use('/api/invoices', invoicesRouter);
app.use('/api/reservations', reservationsRouter);
app.use('/api/shifts', shiftsRouter);
app.use('/api/reports', reportsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/sync', syncRouter);
app.use('/api/stock-limits', stockLimitsRouter);
app.use('/api/payment-methods', paymentMethodsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/customers', customersRouter);
app.use('/api/alerts', alertsRouter);
app.use('/api/woocommerce', woocommerceRouter);

app.use('/api', authenticate, (req, res) => {
  res.status(404).json({ error: `route.notfound:${req.method} ${req.path}` });
});

// In production, serve the built React app (client/dist) from the same process.
// The SPA fallback answers non-API GETs with index.html so client-side routes
// work on refresh; /api and /uploads are never swallowed.
const clientDist = path.resolve(import.meta.dirname, '../../client/dist');
const clientIndex = path.join(clientDist, 'index.html');
if (fs.existsSync(clientIndex)) {
  app.use(express.static(clientDist, { index: false }));
  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/uploads')) return next();
    res.sendFile(clientIndex);
  });
  console.log(`[serve] serving client from ${clientDist}`);
}

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[server error]', err);
  const status = err.status || err.statusCode || 500;
  const known = err.expose || err.status || err.statusCode; // multer/syntax errors carry a status
  res.status(status).json({ error: known ? (err.message || 'bad.request') : 'internal' });
});

app.listen(config.port, () => {
  console.log(`Jewelry API listening on http://localhost:${config.port}`);
});

// WooCommerce auto-sync scheduler: cheap tick every minute, actual cadence
// (interval floor + enable flag) is enforced inside runAutoSync.
setInterval(() => {
  void runAutoSync().catch((e: any) => console.error('[wc auto-sync]', e?.message || e));
}, 60_000);
