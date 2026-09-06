import { Router } from 'express';
import { authenticate, requirePermission } from '../middleware/auth.js';
import { query, queryOne, tx } from '../db.js';
import { audit, camelize, camelizeRows, deriveStatus, todayLocal } from '../utils.js';

export const wholesaleRouter = Router();
wholesaleRouter.use(authenticate, requirePermission('wholesale.manage'));

function httpError(status: number, message: string): never {
  const error: any = new Error(message);
  error.status = status;
  throw error;
}

const ORDER_SELECT = `
  SELECT o.*, t.customer_id, t.business_name, t.default_discount_pct,
         c.name AS trader_name, c.phone AS trader_phone, cat.name_ar AS category_name,
         COALESCE(s.allocated_weight_g,0) AS allocated_weight_g,
         COALESCE(s.delivered_weight_g,0) AS delivered_weight_g,
         COALESCE(s.returned_weight_g,0) AS returned_weight_g,
         COALESCE(s.piece_count,0) AS piece_count
    FROM wholesale_weight_orders o
    JOIN wholesale_traders t ON t.id=o.trader_id
    JOIN customers c ON c.id=t.customer_id
    LEFT JOIN categories cat ON cat.id=o.category_id
    LEFT JOIN LATERAL (
      SELECT SUM((wi.quantity-wi.delivered_qty)*wi.weight_g_snapshot) AS allocated_weight_g,
             SUM(wi.delivered_qty*wi.weight_g_snapshot) AS delivered_weight_g,
             SUM(wi.returned_qty*wi.weight_g_snapshot) AS returned_weight_g,
             SUM(wi.quantity) AS piece_count
        FROM wholesale_order_items wi WHERE wi.order_id=o.id
    ) s ON TRUE`;

async function orderDetails(id: number) {
  const order = await queryOne<any>(`${ORDER_SELECT} WHERE o.id=$1`, [id]);
  if (!order) return null;
  const [items, ledger] = await Promise.all([
    query(`SELECT wi.*, i.barcode, i.quantity AS stock_quantity, i.available_qty
             FROM wholesale_order_items wi JOIN items i ON i.id=wi.item_id
            WHERE wi.order_id=$1 ORDER BY wi.id DESC`, [id]),
    query(`SELECT l.*, e.full_name AS created_by_name
             FROM wholesale_ledger_entries l LEFT JOIN employees e ON e.id=l.created_by
            WHERE l.order_id=$1 ORDER BY l.created_at DESC,l.id DESC`, [id]),
  ]);
  return { ...camelize(order), items: camelizeRows(items), ledger: camelizeRows(ledger) };
}

wholesaleRouter.get('/dashboard', async (_req, res) => {
  const summary = await queryOne<any>(`
    SELECT COUNT(*) FILTER (WHERE status IN ('draft','preparing','ready','partial')) AS open_orders,
           COUNT(*) FILTER (WHERE status='ready') AS ready_orders,
           COALESCE(SUM(target_weight_g) FILTER (WHERE status IN ('draft','preparing','ready','partial')),0) AS open_target_weight_g,
           COUNT(DISTINCT trader_id) FILTER (WHERE status <> 'cancelled') AS active_traders
      FROM wholesale_weight_orders`);
  const balances = await queryOne<any>(`
    SELECT COALESCE(SUM(cash_delta),0) AS cash_balance,
           COALESCE(SUM(metal_delta_g),0) AS metal_balance_g
      FROM wholesale_ledger_entries`);
  res.json(camelize({ ...summary, ...balances }));
});

wholesaleRouter.get('/traders', async (req, res) => {
  const params: any[] = [];
  let where = 't.is_active';
  if (req.query.search) {
    params.push(`%${String(req.query.search)}%`);
    where += ` AND (c.name ILIKE $1 OR COALESCE(c.phone,'') ILIKE $1 OR COALESCE(t.business_name,'') ILIKE $1)`;
  }
  const rows = await query(`
    SELECT t.*, c.name, c.phone, c.email,
           COALESCE((SELECT SUM(l.cash_delta) FROM wholesale_ledger_entries l WHERE l.trader_id=t.id),0) AS cash_balance,
           COALESCE((SELECT SUM(l.metal_delta_g) FROM wholesale_ledger_entries l WHERE l.trader_id=t.id),0) AS metal_balance_g,
           COALESCE((SELECT jsonb_agg(jsonb_build_object('metalType',b.metal_type,'carat',b.carat,'weightG',b.weight_g) ORDER BY b.metal_type,b.carat)
                       FROM (SELECT metal_type,carat,SUM(metal_delta_g) AS weight_g
                               FROM wholesale_ledger_entries l WHERE l.trader_id=t.id AND l.metal_type IS NOT NULL
                              GROUP BY metal_type,carat HAVING SUM(metal_delta_g) <> 0) b),'[]'::jsonb) AS metal_balances,
           (SELECT COUNT(*) FROM wholesale_weight_orders o WHERE o.trader_id=t.id AND o.status IN ('draft','preparing','ready','partial')) AS open_orders
      FROM wholesale_traders t JOIN customers c ON c.id=t.customer_id
     WHERE ${where} ORDER BY c.name`, params);
  res.json(camelizeRows(rows));
});

wholesaleRouter.post('/traders', async (req, res) => {
  const b = req.body ?? {};
  if (!b.customerId) return res.status(400).json({ error: 'customers.required' });
  try {
    const row = await tx(async (q) => {
      const customer = await q.queryOne<any>('SELECT * FROM customers WHERE id=$1 AND is_active', [Number(b.customerId)]);
      if (!customer) httpError(404, 'customers.notfound');
      const trader = await q.queryOne<any>(`
        INSERT INTO wholesale_traders
          (customer_id,business_name,tax_number,credit_limit,payment_terms_days,default_discount_pct,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [customer.id, b.businessName || null, b.taxNumber || null, Number(b.creditLimit || 0),
         Number(b.paymentTermsDays || 0), Number(b.defaultDiscountPct || 0), req.employee!.id]);
      await audit(q, 'wholesale_traders', trader.id, 'create', req.employee!.id, null, trader);
      return trader;
    });
    res.status(201).json(camelize(row));
  } catch (e: any) {
    if (String(e.code) === '23505') return res.status(409).json({ error: 'wholesale.trader_exists' });
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

wholesaleRouter.get('/traders/:id/statement', async (req, res) => {
  const trader = await queryOne<any>(`
    SELECT t.*,c.name,c.phone,c.email FROM wholesale_traders t JOIN customers c ON c.id=t.customer_id WHERE t.id=$1`,
    [Number(req.params.id)]);
  if (!trader) return res.status(404).json({ error: 'notfound' });
  const entries = await query(`
    SELECT l.*,o.order_no,e.full_name AS created_by_name,
           SUM(l.cash_delta) OVER (ORDER BY l.created_at,l.id) AS running_cash_balance,
           SUM(l.metal_delta_g) OVER (PARTITION BY COALESCE(l.metal_type,''),COALESCE(l.carat,'') ORDER BY l.created_at,l.id) AS running_metal_balance_g
      FROM wholesale_ledger_entries l
      LEFT JOIN wholesale_weight_orders o ON o.id=l.order_id
      LEFT JOIN employees e ON e.id=l.created_by
     WHERE l.trader_id=$1 ORDER BY l.created_at DESC,l.id DESC`, [trader.id]);
  res.json({ trader: camelize(trader), entries: camelizeRows(entries) });
});

wholesaleRouter.get('/orders', async (req, res) => {
  const params: any[] = [];
  const conds: string[] = [];
  if (req.query.status) { params.push(String(req.query.status)); conds.push(`o.status=$${params.length}`); }
  if (req.query.traderId) { params.push(Number(req.query.traderId)); conds.push(`o.trader_id=$${params.length}`); }
  const rows = await query(`${ORDER_SELECT} ${conds.length ? `WHERE ${conds.join(' AND ')}` : ''} ORDER BY o.created_at DESC LIMIT 300`, params);
  res.json(camelizeRows(rows));
});

wholesaleRouter.get('/orders/:id', async (req, res) => {
  const result = await orderDetails(Number(req.params.id));
  if (!result) return res.status(404).json({ error: 'notfound' });
  res.json(result);
});

wholesaleRouter.post('/orders', async (req, res) => {
  const b = req.body ?? {};
  if (!b.traderId || !b.metalType || !b.carat || !(Number(b.targetWeightG) > 0)) {
    return res.status(400).json({ error: 'missing:trader,metal,carat,targetWeight' });
  }
  try {
    const order = await tx(async (q) => {
      const trader = await q.queryOne<any>('SELECT * FROM wholesale_traders WHERE id=$1 AND is_active', [Number(b.traderId)]);
      if (!trader) httpError(404, 'wholesale.trader_notfound');
      const today = todayLocal().replaceAll('-', '');
      const n = (await q.queryOne<any>(`SELECT COUNT(*)::int+1 AS n FROM wholesale_weight_orders WHERE created_at::date=CURRENT_DATE`))?.n ?? 1;
      const orderNo = `WO-${today}-${String(n).padStart(4, '0')}`;
      const row = await q.queryOne<any>(`
        INSERT INTO wholesale_weight_orders
          (order_no,trader_id,location_id,channel,metal_type,carat,category_id,target_weight_g,tolerance_g,making_per_g,discount_percent,due_date,notes,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [orderNo, trader.id, Number(b.locationId) || req.employee!.locationId || 1, b.channel || 'store',
         b.metalType, String(b.carat), b.categoryId || null, Number(b.targetWeightG), Number(b.toleranceG || 0),
         Number(b.makingPerG || 0), Number(b.discountPercent ?? trader.default_discount_pct ?? 0),
         b.dueDate || null, b.notes || null, req.employee!.id]);
      if (Number(b.deposit || 0) > 0) {
        await q.query(`INSERT INTO wholesale_ledger_entries
          (trader_id,order_id,entry_type,cash_delta,payment_method,reference,created_by)
          VALUES ($1,$2,'deposit',$3,$4,$5,$6)`,
          [trader.id,row.id,-Math.abs(Number(b.deposit)),b.paymentMethod || 'cash',row.order_no,req.employee!.id]);
      }
      await audit(q, 'wholesale_weight_orders', row.id, 'create', req.employee!.id, null, row);
      return row;
    });
    res.status(201).json(camelize(order));
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

wholesaleRouter.put('/orders/:id/allocations', async (req, res) => {
  const id = Number(req.params.id);
  const raw: { itemId: number; quantity: number }[] = Array.isArray(req.body?.items) ? req.body.items : [];
  const combined = new Map<number, number>();
  for (const item of raw) {
    const itemId = Number(item.itemId);
    const quantity = Number(item.quantity || 1);
    if (!Number.isInteger(itemId) || itemId < 1 || !Number.isInteger(quantity) || quantity < 1) {
      return res.status(400).json({ error: 'bad.allocation' });
    }
    combined.set(itemId, (combined.get(itemId) || 0)+quantity);
  }
  const requested = [...combined].map(([itemId, quantity]) => ({ itemId, quantity }));
  try {
    await tx(async (q) => {
      const order = await q.queryOne<any>('SELECT * FROM wholesale_weight_orders WHERE id=$1 FOR UPDATE', [id]);
      if (!order) httpError(404, 'notfound');
      if (!['draft','preparing','ready','partial'].includes(order.status)) httpError(409, 'wholesale.order_locked');
      const old = await q.query<any>('SELECT * FROM wholesale_order_items WHERE order_id=$1', [id]);

      for (const allocation of old) {
        const pending = Number(allocation.quantity)-Number(allocation.delivered_qty);
        if (pending <= 0) continue;
        const item = await q.queryOne<any>('SELECT * FROM items WHERE id=$1 FOR UPDATE', [allocation.item_id]);
        if (!item) continue;
        const reserved = Math.max(0, Number(item.reserved_qty) - pending);
        await q.query('UPDATE items SET reserved_qty=$1,status=$2,updated_at=now() WHERE id=$3',
          [reserved, deriveStatus(Number(item.quantity), reserved, Number(item.in_transit_qty)), item.id]);
      }
      await q.query('DELETE FROM wholesale_order_items WHERE order_id=$1 AND delivered_qty=0', [id]);
      await q.query('UPDATE wholesale_order_items SET quantity=delivered_qty WHERE order_id=$1 AND delivered_qty>0', [id]);

      let pendingWeight = 0;
      for (const requestedItem of requested) {
        const qty = Number(requestedItem.quantity || 1);
        if (!Number.isInteger(qty) || qty < 1) httpError(400, 'bad.quantity');
        const item = await q.queryOne<any>('SELECT * FROM items WHERE id=$1 AND is_active FOR UPDATE', [Number(requestedItem.itemId)]);
        if (!item || item.product_kind === 'general') httpError(404, `items.notfound:${requestedItem.itemId}`);
        if (item.metal_type !== order.metal_type || String(item.carat || '') !== String(order.carat)) httpError(409, `wholesale.item_mismatch:${item.code}`);
        if (order.category_id && Number(item.category_id) !== Number(order.category_id)) httpError(409, `wholesale.category_mismatch:${item.code}`);
        const available = Number(item.quantity)-Number(item.reserved_qty)-Number(item.in_transit_qty);
        if (available < qty) httpError(409, `items.not_available:${item.code}`);
        await q.query(`INSERT INTO wholesale_order_items
          (order_id,item_id,quantity,item_code_snapshot,item_name_snapshot,weight_g_snapshot,metal_type_snapshot,carat_snapshot)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (order_id,item_id) DO UPDATE
          SET quantity=wholesale_order_items.delivered_qty+EXCLUDED.quantity`,
          [id,item.id,qty,item.code,item.name,item.weight_g,item.metal_type,item.carat]);
        const reserved = Number(item.reserved_qty)+qty;
        await q.query('UPDATE items SET reserved_qty=$1,status=$2,updated_at=now() WHERE id=$3',
          [reserved,deriveStatus(Number(item.quantity),reserved,Number(item.in_transit_qty)),item.id]);
        pendingWeight += Number(item.weight_g)*qty;
      }
      await q.query(`UPDATE wholesale_weight_orders SET status=$2,updated_at=now() WHERE id=$1`,
        [id, requested.length ? (Math.abs(pendingWeight-Number(order.target_weight_g)) <= Number(order.tolerance_g) ? 'ready' : (order.status === 'partial' ? 'partial' : 'preparing')) : (order.status === 'partial' ? 'partial' : 'draft')]);
      await audit(q,'wholesale_weight_orders',id,'allocate',req.employee!.id,old,requested);
    });
    res.json(await orderDetails(id));
  } catch (e: any) {
    res.status(e.status || 500).json({ error: e.message || 'error' });
  }
});

wholesaleRouter.post('/orders/:id/deliver', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await tx(async (q) => {
      const order = await q.queryOne<any>('SELECT * FROM wholesale_weight_orders WHERE id=$1 FOR UPDATE', [id]);
      if (!order) httpError(404,'notfound');
      if (!['preparing','ready','partial'].includes(order.status)) httpError(409,'wholesale.order_not_deliverable');
      const items = await q.query<any>('SELECT * FROM wholesale_order_items WHERE order_id=$1 AND delivered_qty<quantity FOR UPDATE', [id]);
      if (!items.length) httpError(409,'wholesale.no_allocations');
      let weight = 0;
      for (const allocation of items) {
        const qty = Number(allocation.quantity)-Number(allocation.delivered_qty);
        const item = await q.queryOne<any>('SELECT * FROM items WHERE id=$1 FOR UPDATE', [allocation.item_id]);
        if (!item || Number(item.quantity) < qty || Number(item.reserved_qty) < qty) httpError(409,`items.not_available:${allocation.item_code_snapshot}`);
        const newQty = Number(item.quantity)-qty;
        const reserved = Number(item.reserved_qty)-qty;
        await q.query('UPDATE items SET quantity=$1,reserved_qty=$2,status=$3,updated_at=now() WHERE id=$4',
          [newQty,reserved,deriveStatus(newQty,reserved,Number(item.in_transit_qty)),item.id]);
        await q.query('UPDATE wholesale_order_items SET delivered_qty=quantity WHERE id=$1',[allocation.id]);
        weight += Number(allocation.weight_g_snapshot)*qty;
      }
      const netMakingPerG = Number(order.making_per_g)*(1-Number(order.discount_percent)/100);
      const making = Math.round(weight*netMakingPerG*100)/100;
      await q.query(`INSERT INTO wholesale_ledger_entries
        (trader_id,order_id,entry_type,metal_type,carat,metal_delta_g,reference,created_by)
        VALUES ($1,$2,'metal_out',$3,$4,$5,$6,$7)`,
        [order.trader_id,id,order.metal_type,order.carat,weight,order.order_no,req.employee!.id]);
      if (making) await q.query(`INSERT INTO wholesale_ledger_entries
        (trader_id,order_id,entry_type,cash_delta,reference,notes,created_by)
        VALUES ($1,$2,'making_charge',$3,$4,$5,$6)`,
        [order.trader_id,id,making,order.order_no,`مصنعية صافية ${netMakingPerG.toFixed(2)} لكل جرام`,req.employee!.id]);
      const paid = Number(req.body?.paidAmount || 0);
      if (paid > 0) await q.query(`INSERT INTO wholesale_ledger_entries
        (trader_id,order_id,entry_type,cash_delta,payment_method,reference,created_by)
        VALUES ($1,$2,'payment',$3,$4,$5,$6)`,
        [order.trader_id,id,-paid,req.body?.paymentMethod || 'cash',order.order_no,req.employee!.id]);
      const total = await q.queryOne<any>('SELECT COALESCE(SUM(delivered_qty*weight_g_snapshot),0) AS w FROM wholesale_order_items WHERE order_id=$1',[id]);
      const returned = await q.queryOne<any>('SELECT COALESCE(SUM(returned_qty*weight_g_snapshot),0) AS w FROM wholesale_order_items WHERE order_id=$1',[id]);
      const status = Number(total.w)-Number(returned?.w || 0) >= Number(order.target_weight_g)-Number(order.tolerance_g) ? 'completed' : 'partial';
      await q.query('UPDATE wholesale_weight_orders SET status=$2,updated_at=now() WHERE id=$1',[id,status]);
      await audit(q,'wholesale_weight_orders',id,'deliver',req.employee!.id,null,{weight,making,paid});
    });
    res.json(await orderDetails(id));
  } catch (e: any) { res.status(e.status || 500).json({ error:e.message || 'error' }); }
});

wholesaleRouter.post('/orders/:id/return', async (req, res) => {
  const id = Number(req.params.id);
  const rows: { allocationId: number; quantity: number }[] = Array.isArray(req.body?.items) ? req.body.items : [];
  try {
    await tx(async (q) => {
      const order = await q.queryOne<any>('SELECT * FROM wholesale_weight_orders WHERE id=$1 FOR UPDATE',[id]);
      if (!order) httpError(404,'notfound');
      if (!rows.length) httpError(400,'missing:items');
      let weight=0;
      for (const row of rows) {
        const allocation = await q.queryOne<any>('SELECT * FROM wholesale_order_items WHERE id=$1 AND order_id=$2 FOR UPDATE',[row.allocationId,id]);
        const qty=Number(row.quantity || 1);
        if (!allocation || !Number.isInteger(qty) || qty<1 || Number(allocation.returned_qty)+qty>Number(allocation.delivered_qty)) httpError(409,'wholesale.bad_return');
        const item=await q.queryOne<any>('SELECT * FROM items WHERE id=$1 FOR UPDATE',[allocation.item_id]);
        if (!item) httpError(404,'items.notfound');
        const newQty=Number(item.quantity)+qty;
        await q.query('UPDATE items SET quantity=$1,status=$2,updated_at=now() WHERE id=$3',[newQty,deriveStatus(newQty,Number(item.reserved_qty),Number(item.in_transit_qty)),item.id]);
        await q.query('UPDATE wholesale_order_items SET returned_qty=returned_qty+$2 WHERE id=$1',[allocation.id,qty]);
        weight += Number(allocation.weight_g_snapshot)*qty;
      }
      await q.query(`INSERT INTO wholesale_ledger_entries
        (trader_id,order_id,entry_type,metal_type,carat,metal_delta_g,reference,notes,created_by)
        VALUES ($1,$2,'metal_return',$3,$4,$5,$6,$7,$8)`,
        [order.trader_id,id,order.metal_type,order.carat,-weight,order.order_no,req.body?.notes || null,req.employee!.id]);
      const refundPct=Math.max(0,Math.min(100,Number(req.body?.makingRefundPercent || 0)));
      const refund=Math.round(weight*Number(order.making_per_g)*(1-Number(order.discount_percent)/100)*refundPct)/100;
      if (refund>0) await q.query(`INSERT INTO wholesale_ledger_entries
        (trader_id,order_id,entry_type,cash_delta,reference,notes,created_by)
        VALUES ($1,$2,'making_refund',$3,$4,$5,$6)`,
        [order.trader_id,id,-refund,order.order_no,`رد ${refundPct}% من المصنعية`,req.employee!.id]);
      await q.query(`UPDATE wholesale_weight_orders SET status='partial',updated_at=now() WHERE id=$1`,[id]);
      await audit(q,'wholesale_weight_orders',id,'return',req.employee!.id,null,{weight,refundPct,refund});
    });
    res.json(await orderDetails(id));
  } catch(e:any) { res.status(e.status || 500).json({error:e.message || 'error'}); }
});

wholesaleRouter.post('/traders/:id/payments', async (req,res) => {
  const id=Number(req.params.id); const amount=Number(req.body?.amount || 0);
  if (!(amount>0)) return res.status(400).json({error:'bad.amount'});
  const trader=await queryOne<any>('SELECT * FROM wholesale_traders WHERE id=$1 AND is_active',[id]);
  if (!trader) return res.status(404).json({error:'notfound'});
  const row=await queryOne<any>(`INSERT INTO wholesale_ledger_entries
    (trader_id,order_id,entry_type,cash_delta,payment_method,reference,notes,created_by)
    VALUES ($1,$2,'payment',$3,$4,$5,$6,$7) RETURNING *`,
    [id,req.body?.orderId || null,-amount,req.body?.paymentMethod || 'cash',req.body?.reference || null,req.body?.notes || null,req.employee!.id]);
  res.status(201).json(camelize(row));
});

wholesaleRouter.post('/orders/:id/cancel', async (req,res) => {
  const id=Number(req.params.id);
  try {
    await tx(async q => {
      const order=await q.queryOne<any>('SELECT * FROM wholesale_weight_orders WHERE id=$1 FOR UPDATE',[id]);
      if (!order) httpError(404,'notfound');
      if (['completed','cancelled'].includes(order.status)) httpError(409,'wholesale.order_locked');
      const allocations=await q.query<any>('SELECT * FROM wholesale_order_items WHERE order_id=$1',[id]);
      for (const a of allocations) {
        const pending=Number(a.quantity)-Number(a.delivered_qty);
        if (pending<=0) continue;
        const item=await q.queryOne<any>('SELECT * FROM items WHERE id=$1 FOR UPDATE',[a.item_id]);
        if (!item) continue;
        const reserved=Math.max(0,Number(item.reserved_qty)-pending);
        await q.query('UPDATE items SET reserved_qty=$1,status=$2,updated_at=now() WHERE id=$3',[reserved,deriveStatus(Number(item.quantity),reserved,Number(item.in_transit_qty)),item.id]);
      }
      await q.query(`UPDATE wholesale_weight_orders SET status='cancelled',updated_at=now() WHERE id=$1`,[id]);
      await audit(q,'wholesale_weight_orders',id,'cancel',req.employee!.id,order,req.body || {});
    });
    res.json({ok:true});
  } catch(e:any) { res.status(e.status || 500).json({error:e.message || 'error'}); }
});
