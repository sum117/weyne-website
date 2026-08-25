-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  tax_identifier text NOT NULL CHECK (btrim(tax_identifier) <> '')
);

CREATE TABLE IF NOT EXISTS quote_pricing_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,
  general_discount_rate numeric(9, 6) NOT NULL CHECK (general_discount_rate BETWEEN 0 AND 100),
  gross_items_amount numeric(19, 2) NOT NULL CHECK (gross_items_amount >= 0),
  line_discount_amount numeric(19, 2) NOT NULL CHECK (line_discount_amount >= 0),
  net_items_amount numeric(19, 2) NOT NULL CHECK (net_items_amount >= 0),
  general_discount_amount numeric(19, 2) NOT NULL CHECK (general_discount_amount >= 0),
  net_merchandise_amount numeric(19, 2) NOT NULL CHECK (net_merchandise_amount >= 0),
  ipi_amount numeric(19, 2) NOT NULL CHECK (ipi_amount >= 0),
  configured_tax_amount numeric(19, 2) NOT NULL CHECK (configured_tax_amount >= 0),
  freight_amount numeric(19, 2) NOT NULL CHECK (freight_amount >= 0),
  grand_total_amount numeric(19, 2) NOT NULL CHECK (grand_total_amount >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS quote_pricing_snapshot_lines (
  quote_pricing_snapshot_id uuid NOT NULL REFERENCES quote_pricing_snapshots(id) ON DELETE RESTRICT,
  line_id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  product_price_id uuid NOT NULL REFERENCES product_prices(id) ON DELETE RESTRICT,
  quantity numeric(18, 6) NOT NULL CHECK (quantity > 0),
  unit_price numeric(19, 6) NOT NULL CHECK (unit_price >= 0),
  line_discount_rate numeric(9, 6) NOT NULL CHECK (line_discount_rate BETWEEN 0 AND 100),
  gross_amount numeric(19, 2) NOT NULL CHECK (gross_amount >= 0),
  line_discount_amount numeric(19, 2) NOT NULL CHECK (line_discount_amount >= 0),
  net_after_line_discount_amount numeric(19, 2) NOT NULL CHECK (net_after_line_discount_amount >= 0),
  general_discount_amount numeric(19, 2) NOT NULL CHECK (general_discount_amount >= 0),
  net_merchandise_amount numeric(19, 2) NOT NULL CHECK (net_merchandise_amount >= 0),
  ipi_amount numeric(19, 2) NOT NULL CHECK (ipi_amount >= 0),
  configured_taxes jsonb NOT NULL CHECK (jsonb_typeof(configured_taxes) = 'array'),
  configured_tax_amount numeric(19, 2) NOT NULL CHECK (configured_tax_amount >= 0)
);

CREATE INDEX IF NOT EXISTS quote_pricing_snapshots_customer_idx
  ON quote_pricing_snapshots (customer_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS quote_pricing_snapshot_lines_quote_idx
  ON quote_pricing_snapshot_lines (quote_pricing_snapshot_id, line_id);
