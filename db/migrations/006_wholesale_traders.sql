BEGIN;

INSERT INTO permissions (code) VALUES ('wholesale.manage')
ON CONFLICT (code) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('manager','cashier','social') AND p.code = 'wholesale.manage'
ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS wholesale_traders (
  id                    SERIAL PRIMARY KEY,
  customer_id           INT NOT NULL UNIQUE REFERENCES customers(id),
  business_name         TEXT,
  tax_number            TEXT,
  credit_limit          NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  payment_terms_days    INT NOT NULL DEFAULT 0 CHECK (payment_terms_days >= 0),
  default_discount_pct  NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (default_discount_pct BETWEEN 0 AND 100),
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  created_by            INT REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wholesale_weight_orders (
  id                    BIGSERIAL PRIMARY KEY,
  order_no              TEXT NOT NULL UNIQUE,
  trader_id             INT NOT NULL REFERENCES wholesale_traders(id),
  location_id           INT REFERENCES locations(id),
  channel               TEXT NOT NULL DEFAULT 'store'
                        CHECK (channel IN ('store','b2b','phone','whatsapp')),
  metal_type            TEXT NOT NULL CHECK (metal_type IN ('gold','silver')),
  carat                 TEXT NOT NULL,
  category_id           INT REFERENCES categories(id),
  target_weight_g       NUMERIC(14,3) NOT NULL CHECK (target_weight_g > 0),
  tolerance_g           NUMERIC(10,3) NOT NULL DEFAULT 0 CHECK (tolerance_g >= 0),
  making_per_g          NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (making_per_g >= 0),
  discount_percent      NUMERIC(5,2) NOT NULL DEFAULT 0 CHECK (discount_percent BETWEEN 0 AND 100),
  due_date              DATE,
  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','preparing','ready','partial','completed','cancelled')),
  notes                 TEXT,
  created_by            INT REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wholesale_order_items (
  id                    BIGSERIAL PRIMARY KEY,
  order_id              BIGINT NOT NULL REFERENCES wholesale_weight_orders(id) ON DELETE CASCADE,
  item_id               INT NOT NULL REFERENCES items(id),
  quantity              INT NOT NULL DEFAULT 1 CHECK (quantity > 0),
  delivered_qty         INT NOT NULL DEFAULT 0 CHECK (delivered_qty >= 0),
  returned_qty          INT NOT NULL DEFAULT 0 CHECK (returned_qty >= 0),
  item_code_snapshot    TEXT NOT NULL,
  item_name_snapshot    TEXT,
  weight_g_snapshot     NUMERIC(10,3) NOT NULL,
  metal_type_snapshot   TEXT NOT NULL,
  carat_snapshot        TEXT NOT NULL,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, item_id),
  CHECK (delivered_qty <= quantity),
  CHECK (returned_qty <= delivered_qty)
);

CREATE TABLE IF NOT EXISTS wholesale_ledger_entries (
  id                    BIGSERIAL PRIMARY KEY,
  trader_id             INT NOT NULL REFERENCES wholesale_traders(id),
  order_id              BIGINT REFERENCES wholesale_weight_orders(id),
  entry_type            TEXT NOT NULL
                        CHECK (entry_type IN ('deposit','payment','metal_out','metal_return','making_charge','making_refund','adjustment')),
  metal_type            TEXT CHECK (metal_type IN ('gold','silver')),
  carat                 TEXT,
  metal_delta_g         NUMERIC(14,3) NOT NULL DEFAULT 0,
  cash_delta            NUMERIC(14,2) NOT NULL DEFAULT 0,
  payment_method        TEXT,
  reference             TEXT,
  notes                 TEXT,
  created_by            INT REFERENCES employees(id),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wholesale_orders_trader ON wholesale_weight_orders(trader_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wholesale_orders_status ON wholesale_weight_orders(status, due_date);
CREATE INDEX IF NOT EXISTS idx_wholesale_ledger_trader ON wholesale_ledger_entries(trader_id, created_at, id);

COMMIT;
