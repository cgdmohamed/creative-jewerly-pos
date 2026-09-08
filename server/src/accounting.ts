export type DiscountType = 'percent' | 'fixed';

export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) throw new Error('bad.number');
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export type CraftsmanshipType = 'fixed' | 'percent' | 'per_gram';

export function computeUnitCraftsmanship(
  type: CraftsmanshipType,
  value: number,
  weightG: number,
  unitMetalValue: number,
): number {
  if (type === 'percent') return unitMetalValue * value / 100;
  if (type === 'per_gram') return weightG * value;
  return value;
}

export function calculateInvoiceTotals(input: {
  metalSubtotal: number;
  craftsmanshipSubtotal: number;
  discountType?: DiscountType;
  discountValue?: number;
  vatPercent?: number;
}) {
  const metalSubtotal = roundMoney(input.metalSubtotal);
  const rawCraftsmanship = roundMoney(input.craftsmanshipSubtotal);
  const discountValue = Number(input.discountValue ?? 0);
  const vatPercent = Number(input.vatPercent ?? 0);

  if (metalSubtotal < 0 || rawCraftsmanship < 0) throw new Error('bad.subtotal');
  if (!Number.isFinite(discountValue) || discountValue < 0) throw new Error('bad.discount');
  if (!Number.isFinite(vatPercent) || vatPercent < 0 || vatPercent > 100) throw new Error('bad.vat');

  let discountAmount = 0;
  if ((input.discountType ?? 'percent') === 'fixed') {
    discountAmount = Math.min(roundMoney(discountValue), rawCraftsmanship);
  } else {
    if (discountValue > 100) throw new Error('bad.discount');
    discountAmount = roundMoney(rawCraftsmanship * discountValue / 100);
  }

  const craftsmanshipTotal = roundMoney(rawCraftsmanship - discountAmount);
  const vatAmount = roundMoney((metalSubtotal + craftsmanshipTotal) * vatPercent / 100);
  const total = roundMoney(metalSubtotal + craftsmanshipTotal + vatAmount);
  return { metalSubtotal, rawCraftsmanship, craftsmanshipTotal, discountAmount, vatPercent, vatAmount, total };
}

export function allocateDiscount(craftTotals: number[], discountAmount: number): number[] {
  const craftCents = craftTotals.map((value) => Math.round(roundMoney(value) * 100));
  const discountCents = Math.round(roundMoney(discountAmount) * 100);
  const totalCraftCents = craftCents.reduce((sum, value) => sum + value, 0);
  if (discountCents < 0 || discountCents > totalCraftCents) throw new Error('bad.discount');
  if (discountCents === 0 || totalCraftCents === 0) return craftCents.map(() => 0);

  let distributed = 0;
  return craftCents.map((craft, index) => {
    const cents = index === craftCents.length - 1
      ? discountCents - distributed
      : Math.floor(discountCents * craft / totalCraftCents);
    distributed += cents;
    return cents / 100;
  });
}

export function normalizePayment(tendered: unknown, total: number): { collected: number; change: number; outstanding: number } {
  const invoiceTotal = roundMoney(total);
  const amount = tendered == null || tendered === '' ? invoiceTotal : Number(tendered);
  if (!Number.isFinite(amount) || amount < 0) throw new Error('bad.payment');
  const roundedAmount = roundMoney(amount);
  const collected = Math.min(roundedAmount, invoiceTotal);
  return {
    collected,
    change: roundMoney(Math.max(roundedAmount - invoiceTotal, 0)),
    outstanding: roundMoney(invoiceTotal - collected),
  };
}
