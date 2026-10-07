-- Custom Invoice Module schema

CREATE TABLE IF NOT EXISTS invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop TEXT NOT NULL,
  shopify_customer_id TEXT NOT NULL,
  shopify_order_id TEXT,
  invoice_number TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  invoice_date TEXT,
  order_no TEXT,
  order_date TEXT,
  customer_no TEXT,
  po_number TEXT,
  salesperson TEXT,
  terms TEXT,
  ship_via TEXT,
  currency TEXT DEFAULT 'CAD',
  sold_to JSONB,
  ship_to JSONB,
  tax_exempt_code TEXT,
  tax_registration_no TEXT,
  subtotal TEXT,
  total_tax TEXT,
  total_amount TEXT,
  less_payment TEXT,
  amount_due TEXT,
  downloadable BOOLEAN NOT NULL DEFAULT false,
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop, invoice_number, revision)
);

CREATE INDEX IF NOT EXISTS invoices_customer_idx
  ON invoices (shop, shopify_customer_id);

CREATE INDEX IF NOT EXISTS invoices_invoice_date_idx
  ON invoices (shop, shopify_customer_id, invoice_date DESC);

CREATE TABLE IF NOT EXISTS invoice_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  item_number TEXT,
  description TEXT,
  qty_ordered TEXT,
  qty_shipped TEXT,
  qty_backorder TEXT,
  unit_price TEXT,
  uom TEXT,
  extended_price TEXT,
  UNIQUE (invoice_id, line_index)
);

CREATE TABLE IF NOT EXISTS invoice_tax_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  line_index INTEGER NOT NULL,
  code TEXT,
  amount TEXT,
  UNIQUE (invoice_id, line_index)
);

CREATE TABLE IF NOT EXISTS outstanding_balances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop TEXT NOT NULL,
  shopify_customer_id TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('invoice', 'customer')),
  shopify_order_id TEXT,
  invoice_number TEXT,
  amount TEXT NOT NULL,
  currency TEXT DEFAULT 'CAD',
  raw_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Natural key uniqueness for upserts
CREATE UNIQUE INDEX IF NOT EXISTS outstanding_customer_uq
  ON outstanding_balances (shop, shopify_customer_id)
  WHERE scope = 'customer';

CREATE UNIQUE INDEX IF NOT EXISTS outstanding_invoice_uq
  ON outstanding_balances (shop, shopify_customer_id, invoice_number)
  WHERE scope = 'invoice' AND invoice_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS outstanding_customer_idx
  ON outstanding_balances (shop, shopify_customer_id, scope);
