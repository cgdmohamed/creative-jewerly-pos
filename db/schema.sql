-- ============================================================
-- Jewelry Management System — PostgreSQL schema
-- Per PRD: entities (items/employees/locations) are separated
-- from historical records (invoices/movements/counts).
-- No hard deletes for employees/items: deactivate instead.
-- ============================================================

BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ------------------------------------------------------------
-- Roles & Permissions
-- ------------------------------------------------------------
CREATE TABLE roles (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,          -- manager | cashier | social
  name_ar       TEXT NOT NULL,
  name_en       TEXT NOT NULL
);

CREATE TABLE permissions (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL           -- e.g. 'pricing.set', 'invoice.create'
);

CREATE TABLE role_permissions (
  role_id       INT REFERENCES roles(id) ON DELETE CASCADE,
  permission_id INT REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

-- ------------------------------------------------------------
-- Locations (branches / warehouses)
-- ------------------------------------------------------------
CREATE TABLE locations (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Categories (سبيكة، خاتم، سلسلة، أسورة …)
-- ------------------------------------------------------------
CREATE TABLE categories (
  id            SERIAL PRIMARY KEY,
  code          TEXT UNIQUE NOT NULL,
  name_ar       TEXT NOT NULL,
  name_en       TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE
);

-- ------------------------------------------------------------
-- Employees (never hard-deleted; deactivate instead)
-- ------------------------------------------------------------
CREATE TABLE employees (
  id                    SERIAL PRIMARY KEY,
  employee_no           TEXT UNIQUE NOT NULL,
  full_name             TEXT NOT NULL,
  phone                 TEXT UNIQUE,
  hire_date             DATE NOT NULL DEFAULT CURRENT_DATE,
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','inactive')),
  role_id               INT NOT NULL REFERENCES roles(id),
  location_id           INT REFERENCES locations(id),
  discount_cap_percent  NUMERIC(5,2) NOT NULL DEFAULT 0,  -- max % off craftsmanship
  username              TEXT UNIQUE NOT NULL,
  pin_hash              TEXT NOT NULL,
  photo_url             TEXT,
  notes                 TEXT,
  last_login_at         TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Items (bullion & handmade pieces) — single units, audited
-- ------------------------------------------------------------
CREATE TABLE items (
  id                        SERIAL PRIMARY KEY,
  code                      TEXT UNIQUE NOT NULL,
  barcode                   TEXT UNIQUE,
  name                      TEXT,
  description               TEXT,
  photo_url                 TEXT,
  category_id               INT REFERENCES categories(id),
  size                      TEXT,

  product_kind              TEXT NOT NULL DEFAULT 'jewelry'
                            CHECK (product_kind IN ('jewelry','general')),  -- 'general' = fixed-price products (watches, gifts…)
  metal_type                TEXT CHECK (metal_type IN ('gold','silver')),   -- NULL for general products
  carat                     TEXT,                          -- e.g. '21','24','925'
  weight_g                  NUMERIC(10,3) CHECK (weight_g IS NULL OR weight_g > 0),  -- NULL for general products
  stone_weight_g            NUMERIC(10,3) NOT NULL DEFAULT 0,
  sale_price                NUMERIC(12,2),                 -- fixed sale price (general products only)

  craftsmanship_type        TEXT NOT NULL DEFAULT 'fixed'
                            CHECK (craftsmanship_type IN ('fixed','percent')),
  craftsmanship_value       NUMERIC(10,2) NOT NULL DEFAULT 0,
  cost                      NUMERIC(12,2),                 -- purchase/making cost
  metal_price_at_add        NUMERIC(12,2),                 -- metal price at add time
  source_supplier           TEXT,
  source_origin             TEXT CHECK (source_origin IN ('purchase','customer')),  -- reserved for future trade-in

  status                    TEXT NOT NULL DEFAULT 'available'
                            CHECK (status IN ('available','reserved','sold','in_transit')),
  physical_status           TEXT NOT NULL DEFAULT 'new'
                            CHECK (physical_status IN ('new','used')),
  notes                     TEXT,
  manufacturing_variance_g  NUMERIC(10,3) NOT NULL DEFAULT 0,  -- factory weight variance

  quantity                  INT NOT NULL DEFAULT 1 CHECK (quantity >= 0),       -- pieces in this batch
  reserved_qty              INT NOT NULL DEFAULT 0 CHECK (reserved_qty >= 0),   -- held by reservations
  in_transit_qty            INT NOT NULL DEFAULT 0 CHECK (in_transit_qty >= 0), -- moving between locations
  available_qty             INT GENERATED ALWAYS AS (quantity - reserved_qty - in_transit_qty) STORED,

  current_location_id       INT REFERENCES locations(id),
  is_active                 BOOLEAN NOT NULL DEFAULT TRUE,
  wc_product_id             BIGINT,                 -- WooCommerce product id (SKU-linked)
  wc_last_synced_at         TIMESTAMPTZ,            -- last successful WC sync
  created_by                INT REFERENCES employees(id),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_items_wc_product_id
  ON items (wc_product_id) WHERE wc_product_id IS NOT NULL;

-- Stock limits (Min/Max) per location + metal/carat (reports "حدود المخزون")
CREATE TABLE stock_limits (
  id            SERIAL PRIMARY KEY,
  location_id   INT NOT NULL REFERENCES locations(id) ON DELETE CASCADE,
  metal_type    TEXT NOT NULL CHECK (metal_type IN ('gold','silver')),
  carat         TEXT,
  min_qty       INT NOT NULL DEFAULT 0,
  max_qty       INT,
  UNIQUE (location_id, metal_type, carat)
);

-- ------------------------------------------------------------
-- Daily pricing (append-only; never overwrite)
-- ------------------------------------------------------------
CREATE TABLE price_history (
  id              SERIAL PRIMARY KEY,
  metal_type      TEXT NOT NULL CHECK (metal_type IN ('gold','silver')),
  carat           TEXT,
  price_per_gram  NUMERIC(12,2) NOT NULL,
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,                        -- NULL => currently active
  entered_by      INT REFERENCES employees(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_price_history_metal_date ON price_history (metal_type, carat, effective_date);

-- ------------------------------------------------------------
-- Item status audit (full trail: available → reserved → sold …)
-- ------------------------------------------------------------
CREATE TABLE item_status_history (
  id            SERIAL PRIMARY KEY,
  item_id       INT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  reason        TEXT,
  changed_by    INT REFERENCES employees(id),
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Item movements / transfers between locations
-- ------------------------------------------------------------
CREATE TABLE item_movements (
  id                SERIAL PRIMARY KEY,
  item_id           INT NOT NULL REFERENCES items(id),
  quantity          INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  from_location_id  INT REFERENCES locations(id),
  to_location_id    INT NOT NULL REFERENCES locations(id),
  moved_by          INT REFERENCES employees(id),
  moved_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  status            TEXT NOT NULL DEFAULT 'in_transit'
                    CHECK (status IN ('in_transit','received','cancelled')),
  received_by       INT REFERENCES employees(id),
  received_at       TIMESTAMPTZ,
  reason            TEXT
);

-- ------------------------------------------------------------
-- Customers (عملاء) — linked from invoices & reservations
-- ------------------------------------------------------------
CREATE TABLE customers (
  id            SERIAL PRIMARY KEY,
  name          TEXT NOT NULL,
  phone         TEXT,
  email         TEXT,
  address       TEXT,
  notes         TEXT,
  is_active     BOOLEAN NOT NULL DEFAULT TRUE,
  wc_customer_id    BIGINT,                        -- WooCommerce customer id
  wc_last_synced_at TIMESTAMPTZ,
  created_by    INT REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_wc_customer_id
  ON customers (wc_customer_id) WHERE wc_customer_id IS NOT NULL;
CREATE INDEX idx_customers_phone ON customers (phone);
CREATE INDEX idx_customers_name ON customers (name);

-- ------------------------------------------------------------
-- Invoices (sales). Status 'active' | 'returned'
-- ------------------------------------------------------------
CREATE TABLE invoices (
  id                    SERIAL PRIMARY KEY,
  invoice_no            TEXT UNIQUE NOT NULL,
  employee_id           INT NOT NULL REFERENCES employees(id),   -- cashier
  location_id           INT NOT NULL REFERENCES locations(id),
  customer_id           INT REFERENCES customers(id),
  customer_phone        TEXT,
  metal_subtotal        NUMERIC(12,2) NOT NULL DEFAULT 0,
  craftsmanship_total   NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  discount_reason       TEXT,
  discount_approved_by  INT REFERENCES employees(id),
  vat_percent           NUMERIC(5,2) NOT NULL DEFAULT 0,
  vat_amount            NUMERIC(12,2) NOT NULL DEFAULT 0,
  total                 NUMERIC(12,2) NOT NULL,
  payment_method        TEXT NOT NULL DEFAULT 'cash',
  status                TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','returned')),
  shift_id              INT,                                     -- set later
  is_offline            BOOLEAN NOT NULL DEFAULT FALSE,
  device_id             TEXT,
  return_reason         TEXT,
  returned_at           TIMESTAMPTZ,
  returned_by           INT REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE invoice_items (
  id                     SERIAL PRIMARY KEY,
  invoice_id             INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  item_id                INT NOT NULL REFERENCES items(id),
  quantity               INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  item_code_snapshot     TEXT NOT NULL,
  item_name_snapshot     TEXT,
  metal_type_snapshot    TEXT,
  carat_snapshot         TEXT,
  weight_g_snapshot      NUMERIC(10,3) NOT NULL,
  metal_price_snapshot   NUMERIC(12,2) NOT NULL,     -- metal price at sale
  metal_cost_price       NUMERIC(12,2),              -- metal price when item was added
  craftsmanship_snapshot NUMERIC(12,2) NOT NULL DEFAULT 0,
  line_discount          NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost_snapshot          NUMERIC(12,2),
  line_total             NUMERIC(12,2) NOT NULL
);

CREATE TABLE payments (
  id            SERIAL PRIMARY KEY,
  invoice_id    INT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  method        TEXT NOT NULL DEFAULT 'cash',
  amount        NUMERIC(12,2) NOT NULL,
  received_by   INT REFERENCES employees(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Payment methods catalog (طرق الدفع القابلة للتخصيص) — code يُحفظ في الفواتير، لا يُحذف
CREATE TABLE payment_methods (
  id          SERIAL PRIMARY KEY,
  code        TEXT UNIQUE NOT NULL,
  name_ar     TEXT NOT NULL,
  name_en     TEXT,
  color       TEXT NOT NULL DEFAULT '#64748b',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Reservations with down payment (عربون)
-- ------------------------------------------------------------
CREATE TABLE reservations (
  id             SERIAL PRIMARY KEY,
  item_id        INT NOT NULL REFERENCES items(id),
  quantity       INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  customer_id    INT REFERENCES customers(id),
  customer_name  TEXT NOT NULL,
  customer_phone TEXT,
  down_payment   NUMERIC(12,2) NOT NULL,
  total_value    NUMERIC(12,2) NOT NULL,
  remaining_due  NUMERIC(12,2) NOT NULL,
  reserved_by    INT REFERENCES employees(id),
  reserved_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('active','completed','cancelled')),
  invoice_id     INT REFERENCES invoices(id),
  notes          TEXT
);

-- ------------------------------------------------------------
-- Stock counts (جرد) + discrepancy report
-- ------------------------------------------------------------
CREATE TABLE stock_counts (
  id            SERIAL PRIMARY KEY,
  location_id   INT NOT NULL REFERENCES locations(id),
  started_by    INT REFERENCES employees(id),
  started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  status        TEXT NOT NULL DEFAULT 'in_progress'
                CHECK (status IN ('in_progress','completed','cancelled')),
  completed_by  INT REFERENCES employees(id),
  completed_at  TIMESTAMPTZ,
  notes         TEXT
);

CREATE TABLE stock_count_items (
  id               SERIAL PRIMARY KEY,
  stock_count_id   INT NOT NULL REFERENCES stock_counts(id) ON DELETE CASCADE,
  item_id          INT NOT NULL REFERENCES items(id),
  expected_qty     INT NOT NULL DEFAULT 1,
  counted_qty      INT NOT NULL DEFAULT 0,
  counted_status   TEXT NOT NULL
                   CHECK (counted_status IN ('found','missing','unexpected')),
  counted_by       INT REFERENCES employees(id),
  counted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_count_item ON stock_count_items (stock_count_id, item_id);

-- ------------------------------------------------------------
-- Shifts + cash reconciliation (تسوية الكاش)
-- ------------------------------------------------------------
CREATE TABLE shifts (
  id            SERIAL PRIMARY KEY,
  employee_id   INT NOT NULL REFERENCES employees(id),
  location_id   INT NOT NULL REFERENCES locations(id),
  opened_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  closed_at     TIMESTAMPTZ,
  status        TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  closed_by     INT REFERENCES employees(id),
  notes         TEXT
);

CREATE TABLE shift_reconciliations (
  id              SERIAL PRIMARY KEY,
  shift_id        INT NOT NULL UNIQUE REFERENCES shifts(id) ON DELETE CASCADE,
  expected_cash   NUMERIC(12,2) NOT NULL,
  counted_cash    NUMERIC(12,2) NOT NULL,
  difference      NUMERIC(12,2) NOT NULL,
  methods         JSONB NOT NULL DEFAULT '[]',
  notes           TEXT,
  reconciled_by   INT REFERENCES employees(id),
  reconciled_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Generic audit log + settings + offline sync outbox
-- ------------------------------------------------------------
CREATE TABLE audit_log (
  id            BIGSERIAL PRIMARY KEY,
  table_name    TEXT NOT NULL,
  record_id     TEXT NOT NULL,
  action        TEXT NOT NULL,
  old_data      JSONB,
  new_data      JSONB,
  performed_by  INT REFERENCES employees(id),
  performed_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE app_settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Offline (local-first) sync outbox: sales made while offline
CREATE TABLE sync_outbox (
  id            BIGSERIAL PRIMARY KEY,
  device_id     TEXT NOT NULL,
  op            TEXT NOT NULL,                 -- 'invoice.create' | 'movement.receive' …
  payload       JSONB NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','applied','conflict','rejected')),
  conflict_note TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  applied_at    TIMESTAMPTZ
);

-- WooCommerce sync run history (imports/exports, counts + per-item errors)
CREATE TABLE wc_sync_log (
  id         BIGSERIAL PRIMARY KEY,
  op         TEXT NOT NULL,
  direction  TEXT NOT NULL,
  imported   INT NOT NULL DEFAULT 0,
  updated    INT NOT NULL DEFAULT 0,
  skipped    INT NOT NULL DEFAULT 0,
  failed     INT NOT NULL DEFAULT 0,
  errors     JSONB NOT NULL DEFAULT '[]',
  ran_by     INT REFERENCES employees(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- WC order -> local invoice links (prevents double-importing an order)
CREATE TABLE wc_order_links (
  wc_order_id BIGINT PRIMARY KEY,
  invoice_id  INT NOT NULL REFERENCES invoices(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ------------------------------------------------------------
-- Seed: roles, permissions, default data
-- ------------------------------------------------------------
INSERT INTO roles (code, name_ar, name_en) VALUES
  ('manager', 'مدير المحل', 'Manager'),
  ('cashier', 'كاشير / بياع', 'Cashier'),
  ('social',  'مسؤول السوشيال ميديا', 'Social Media');

INSERT INTO permissions (code) VALUES
  ('employees.manage'),      -- create/edit/deactivate employees
  ('pricing.set'),           -- enter daily prices
  ('inventory.manage'),      -- add/edit items
  ('invoice.create'),        -- sell
  ('invoice.return'),        -- return/cancel invoices
  ('invoice.discount_override'),  -- exceed cashier discount cap
  ('movement.create'),       -- transfer items
  ('movement.receive'),      -- confirm receiving transfers
  ('stockcount.manage'),     -- start/complete stock counts
  ('shift.close'),           -- close shift & reconcile cash
  ('reports.view'),          -- view reports
  ('reservation.manage'),    -- create/cancel reservations
  ('customers.manage'),      -- create/edit customers
  ('settings.manage'),       -- manage payment methods & settings
  ('locations.manage'),      -- add/edit branches & locations
  ('woocommerce.manage');    -- manage WooCommerce integration

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code = 'manager';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('invoice.create','movement.receive','shift.close','reservation.manage','invoice.return','inventory.manage','customers.manage')
WHERE r.code = 'cashier';

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.code IN
  ('invoice.create','reservation.manage','inventory.manage','customers.manage')
WHERE r.code = 'social';

INSERT INTO locations (code, name_ar) VALUES ('MAIN', 'الفرع الرئيسي');

INSERT INTO payment_methods (code, name_ar, name_en, color, sort_order) VALUES
  ('cash', 'نقدي', 'Cash', '#10b981', 1),
  ('transfer', 'تحويل بنكي', 'Bank transfer', '#0ea5e9', 2),
  ('card', 'كارت بنكي', 'Bank card', '#8b5cf6', 3),
  ('wallet', 'محفظة إلكترونية', 'E-wallet', '#f59e0b', 4)
ON CONFLICT (code) DO NOTHING;

INSERT INTO categories (code, name_ar, name_en) VALUES
  ('BAR','سبيكة','Bar'),
  ('RING','خاتم','Ring'),
  ('CHAIN','سلسلة','Chain'),
  ('BRACELET','أسورة','Bracelet'),
  ('EARRINGS','حلق','Earrings'),
  ('NECKLACE','قلادة','Necklace'),
  ('OTHER','أخرى','Other');

INSERT INTO app_settings (key, value) VALUES
  ('slow_stock_days','90'),
  ('currency','ج.م'),
  ('store_name','محل السبائك والمشغولات'),
  ('cashier_discount_enabled','true'),
  ('cashier_cap_override_enabled','true'),
  ('vat_percent','0');

COMMIT;
