import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { camelizeRows, camelize } from '../utils.js';
import { getSalesOverview, getInventoryValue } from '../reportQueries.js';

export const dashboardRouter = Router();

dashboardRouter.use(authenticate);

// إحصاءات لوحة التحكم: متاحة لكل موظف مسجّل (التقارير التفصيلية تبقى لصلاحية reports.view)
dashboardRouter.get('/', async (_req, res) => {
  const [sales, inventory] = await Promise.all([getSalesOverview(14), getInventoryValue()]);
  res.json({
    daily: camelizeRows(sales.daily),
    byMetal: camelizeRows(sales.byMetal),
    byMethod: camelizeRows(sales.byMethod),
    summary: camelize(sales.summary),
    inventory: camelize(inventory),
  });
});
