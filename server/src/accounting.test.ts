import assert from 'node:assert/strict';
import test from 'node:test';
import { allocateDiscount, calculateInvoiceTotals, calculateLockedInvoiceTotals, computeUnitCraftsmanship, normalizePayment, roundMoney } from './accounting.js';

test('workmanship methods remain independent for low-making bullion', () => {
  assert.equal(roundMoney(computeUnitCraftsmanship('per_gram', 12, 31.1, 250_000)), 373.2);
  assert.equal(computeUnitCraftsmanship('fixed', 12, 31.1, 250_000), 12);
  assert.equal(computeUnitCraftsmanship('percent', 0.5, 31.1, 250_000), 1250);
});

test('invoice components always reconcile exactly to total', () => {
  const result = calculateInvoiceTotals({
    metalSubtotal: 1234.567,
    craftsmanshipSubtotal: 321.239,
    discountType: 'percent',
    discountValue: 12.5,
    vatPercent: 14,
  });
  assert.equal(result.total, roundMoney(result.metalSubtotal + result.craftsmanshipTotal + result.vatAmount));
  assert.equal(result.discountAmount, 40.16);
  assert.equal(result.total, 1727.84);
});

test('discount cannot exceed craftsmanship', () => {
  assert.equal(calculateInvoiceTotals({
    metalSubtotal: 1000,
    craftsmanshipSubtotal: 100,
    discountType: 'fixed',
    discountValue: 500,
  }).discountAmount, 100);
  assert.throws(() => calculateInvoiceTotals({
    metalSubtotal: 1000,
    craftsmanshipSubtotal: 100,
    discountType: 'percent',
    discountValue: 101,
  }), /bad.discount/);
});

test('allocated line discounts equal header discount to the cent', () => {
  const allocated = allocateDiscount([10, 20, 30], 7.01);
  assert.deepEqual(allocated, [1.16, 2.33, 3.52]);
  assert.equal(roundMoney(allocated.reduce((sum, value) => sum + value, 0)), 7.01);
});

test('cash tender records net collection and separates change', () => {
  assert.deepEqual(normalizePayment(120, 100), { collected: 100, change: 20, outstanding: 0 });
  assert.deepEqual(normalizePayment(40, 100), { collected: 40, change: 0, outstanding: 60 });
  assert.deepEqual(normalizePayment(undefined, 100), { collected: 100, change: 0, outstanding: 0 });
  assert.throws(() => normalizePayment(-1, 100), /bad.payment/);
});

test('reservation conversion preserves the agreed total and deposit balance', () => {
  const result = calculateLockedInvoiceTotals(101, 600, 0);
  assert.deepEqual(result, {
    metalSubtotal: 101,
    rawCraftsmanship: 499,
    craftsmanshipTotal: 499,
    discountAmount: 0,
    vatPercent: 0,
    vatAmount: 0,
    total: 600,
  });
  assert.deepEqual(normalizePayment(450, result.total - 150), {
    collected: 450,
    change: 0,
    outstanding: 0,
  });
});

test('reservation total cannot be lower than its metal value', () => {
  assert.throws(() => calculateLockedInvoiceTotals(601, 600, 0), /reservations.total_below_metal/);
});

test('quantity arithmetic retains cents for large batches', () => {
  const unitMetal = 1.001 * 1234.56;
  const quantity = 300;
  const result = calculateInvoiceTotals({
    metalSubtotal: unitMetal * quantity,
    craftsmanshipSubtotal: unitMetal * quantity * 0.07,
    vatPercent: 14,
  });
  assert.equal(result.metalSubtotal, 370738.37);
  assert.equal(result.craftsmanshipTotal, 25951.69);
  assert.equal(result.total, 452226.67);
});
