export type Role = 'manager' | 'cashier' | 'social';

export interface Employee {
  id: number;
  employeeNo: string;
  fullName: string;
  phone: string | null;
  hireDate: string;
  status: 'active' | 'inactive';
  role: string;
  roleCode: Role;
  roleId?: number;
  locationId: number | null;
  locationName?: string | null;
  discountCapPercent: number | string;
  username: string;
  lastLoginAt?: string | null;
  permissions: string[];
}

export interface Location {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  isActive: boolean;
}

export interface Category {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  isActive: boolean;
  itemCount?: number;
}

export interface Item {
  id: number;
  code: string;
  barcode?: string | null;
  name?: string | null;
  description?: string | null;
  photoUrl?: string | null;
  categoryId?: number | null;
  categoryName?: string | null;
  size?: string | null;
  /** 'general' = fixed-price products (watches, gifts…), 'jewelry' = priced by weight × metal price. */
  productKind?: 'jewelry' | 'general';
  salePrice?: number | string | null;
  metalType?: 'gold' | 'silver' | null;
  carat?: string | null;
  weightG?: number | string | null;
  stoneWeightG: number | string;
  craftsmanshipType: 'fixed' | 'percent';
  craftsmanshipValue: number | string;
  cost?: number | string | null;
  metalPriceAtAdd?: number | string | null;
  sourceSupplier?: string | null;
  status: 'available' | 'reserved' | 'sold' | 'in_transit';
  physicalStatus: 'new' | 'used';
  notes?: string | null;
  manufacturingVarianceG: number | string;
  quantity?: number;
  reservedQty?: number;
  inTransitQty?: number;
  minQty?: number;
  maxQty?: number | null;
  availableQty?: number;
  currentLocationId?: number | null;
  locationName?: string | null;
  isActive?: boolean;
  needsReview?: boolean;
  createdBy?: number | null;
  createdAt?: string;
}

export interface PriceRow {
  id: number;
  metalType: 'gold' | 'silver';
  carat?: string | null;
  pricePerGram: number | string;
  effectiveDate: string;
  endDate?: string | null;
  enteredByName?: string | null;
}

export interface AppSettings {
  slow_stock_days?: string;
  currency?: string;
  store_name?: string;
  cashier_discount_enabled?: string;
  cashier_cap_override_enabled?: string;
  vat_percent?: string;
}

export interface Customer {
  id: number;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  notes?: string | null;
  isActive: boolean;
  createdAt?: string;
  totalInvoices?: number;
  totalSpent?: number;
  lastPurchaseAt?: string | null;
  activeReservations?: number;
}

export interface Invoice {
  id: number;
  invoiceNo: string;
  employeeId: number;
  cashierName?: string;
  locationId: number;
  locationName?: string;
  customerId?: number | null;
  customerName?: string | null;
  customerPhone?: string | null;
  metalSubtotal: number;
  craftsmanshipTotal: number;
  discountAmount: number;
  discountReason?: string | null;
  discountApprovedBy?: number | null;
  vatPercent?: number;
  vatAmount?: number;
  total: number;
  paymentMethod: string;
  paymentMethodName?: string;
  paymentMethodColor?: string;
  status: 'active' | 'returned';
  shiftId?: number | null;
  isOffline: boolean;
  returnReason?: string | null;
  returnedAt?: string | null;
  createdAt: string;
  items?: InvoiceItem[];
  payments?: Payment[];
}

export interface InvoiceItem {
  id: number;
  invoiceId: number;
  itemId: number;
  itemCodeSnapshot: string;
  itemNameSnapshot?: string | null;
  metalTypeSnapshot?: string;
  caratSnapshot?: string | null;
  weightGSnapshot: number | string;
  metalPriceSnapshot: number | string;
  metalCostPrice?: number | string | null;
  craftsmanshipSnapshot: number | string;
  lineDiscount: number | string;
  costSnapshot?: number | string | null;
  quantity?: number;
  lineTotal: number | string;
}

export interface Payment {
  id: number;
  invoiceId: number;
  method: string;
  amount: number;
  receivedByName?: string;
  createdAt: string;
}

export interface Reservation {
  id: number;
  itemId: number;
  itemCode?: string;
  itemName?: string | null;
  customerId?: number | null;
  customerName: string;
  customerPhone?: string | null;
  downPayment: number;
  totalValue: number;
  remainingDue: number;
  reservedByName?: string;
  reservedAt: string;
  quantity?: number;
  status: 'active' | 'completed' | 'cancelled';
}

export interface Movement {
  id: number;
  itemId: number;
  itemCode?: string;
  itemName?: string | null;
  fromLocationId?: number | null;
  toLocationId: number;
  fromLocation?: string | null;
  toLocation?: string | null;
  movedByName?: string;
  movedAt: string;
  receivedByName?: string;
  receivedAt?: string | null;
  status: 'in_transit' | 'received' | 'cancelled';
  reason?: string | null;
  quantity?: number;
}

export interface StockCount {
  id: number;
  locationId: number;
  locationName?: string;
  startedByName?: string;
  startedAt: string;
  status: 'in_progress' | 'completed' | 'cancelled';
  expected?: CountItem[];
  extra?: CountItem[];
}

export interface CountItem extends Item {
  countedStatus: 'found' | 'missing' | 'unexpected';
  expectedQty?: number;
  countedQty?: number | null;
  diffQty?: number;
}

export interface Shift {
  id: number;
  employeeId: number;
  employeeName?: string;
  locationId: number;
  locationName?: string;
  openedAt: string;
  closedAt?: string | null;
  status: 'open' | 'closed';
  expectedCash?: number;
  countedCash?: number;
  difference?: number;
  expectedTotal?: number;
  countedTotal?: number;
  differenceTotal?: number;
  methodTotals?: { code: string; name: string; expected: number }[];
}

export interface StockLimit {
  id: number;
  locationId: number;
  metalType: string;
  carat?: string | null;
  minQty: number;
  maxQty?: number | null;
}

export interface PaymentMethod {
  id: number;
  code: string;
  nameAr: string;
  nameEn?: string | null;
  color: string;
  isActive: boolean;
  sortOrder: number;
  invoices30d?: number;
  total30d?: number;
}

export interface CartLine {
  item: Item;
  quantity: number;
  metalPrice: number;
  metalTotal: number;
  craft: number;
  lineTotal: number;
}

export interface WcConfig {
  configured: boolean;
  url: string;
  hasKey: boolean;
  hasSecret: boolean;
  autoSync: { enabled: boolean; intervalMin: number; ops: string[] };
  weightKg: boolean;
}

export interface WcSyncResult {
  op: string;
  direction: 'in' | 'out';
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { ref: string | number; reason: string }[];
}

export interface WcLogRow {
  id: number;
  op: string;
  direction: string;
  imported: number;
  updated: number;
  skipped: number;
  failed: number;
  errors: { ref: string | number; reason: string }[];
  ranBy: number | null;
  ranByName?: string | null;
  createdAt: string;
}
