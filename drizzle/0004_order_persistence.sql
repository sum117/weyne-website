-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  source_quote_revision integer NOT NULL CHECK (source_quote_revision > 0),
  number text NOT NULL,
  number_year integer NOT NULL,
  number_sequence integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),

  client_id uuid NOT NULL,
  client_legal_name text NOT NULL,
  client_trade_name text,
  client_tax_identifier text NOT NULL,
  client_state_registration text,
  client_email text,
  client_phone text,
  client_address_street text NOT NULL,
  client_address_number text NOT NULL,
  client_address_complement text,
  client_address_district text NOT NULL,
  client_address_city text NOT NULL,
  client_address_state char(2) NOT NULL,
  client_address_postal_code text NOT NULL,
  client_address_country_code char(2) NOT NULL DEFAULT 'BR',

  currency_code char(3) NOT NULL,
  gross_items_amount numeric(19, 6) NOT NULL,
  per_item_discount_amount numeric(19, 6) NOT NULL,
  net_items_amount numeric(19, 6) NOT NULL,
  general_discount_rate numeric(9, 6) NOT NULL,
  general_discount_amount numeric(19, 6) NOT NULL,
  net_after_discounts_amount numeric(19, 6) NOT NULL,
  ipi_amount numeric(19, 6) NOT NULL,
  configured_tax_amount numeric(19, 6) NOT NULL,
  freight_amount numeric(19, 6) NOT NULL,
  grand_total_amount numeric(19, 6) NOT NULL,
  commission_basis_amount numeric(19, 6) NOT NULL,
  commission_amount numeric(19, 6) NOT NULL,

  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL,
  creation_reason text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL,
  status_changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status_changed_by text NOT NULL,
  status_change_reason text NOT NULL,

  CONSTRAINT orders_source_quote_uidx UNIQUE (source_quote_id),
  CONSTRAINT orders_number_uidx UNIQUE (number),
  CONSTRAINT orders_year_sequence_uidx UNIQUE (number_year, number_sequence),
  CONSTRAINT orders_number_ck CHECK (
    number_year BETWEEN 2000 AND 9999
    AND number_sequence BETWEEN 1 AND 999999
    AND number = 'PED-' || number_year::text || '-' || lpad(number_sequence::text, 6, '0')
  ),
  CONSTRAINT orders_status_ck CHECK (
    status IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled')
  ),
  CONSTRAINT orders_required_text_ck CHECK (
    btrim(client_legal_name) <> ''
    AND btrim(client_tax_identifier) <> ''
    AND btrim(client_address_street) <> ''
    AND btrim(client_address_number) <> ''
    AND btrim(client_address_district) <> ''
    AND btrim(client_address_city) <> ''
    AND btrim(client_address_postal_code) <> ''
    AND btrim(created_by) <> ''
    AND btrim(creation_reason) <> ''
    AND btrim(updated_by) <> ''
    AND btrim(status_changed_by) <> ''
    AND btrim(status_change_reason) <> ''
  ),
  CONSTRAINT orders_currency_ck CHECK (
    currency_code ~ '^[A-Z]{3}$'
    AND client_address_state ~ '^[A-Z]{2}$'
    AND client_address_country_code ~ '^[A-Z]{2}$'
  ),
  CONSTRAINT orders_amounts_ck CHECK (
    gross_items_amount >= 0
    AND per_item_discount_amount BETWEEN 0 AND gross_items_amount
    AND net_items_amount >= 0
    AND general_discount_rate BETWEEN 0 AND 100
    AND general_discount_amount BETWEEN 0 AND net_items_amount
    AND net_after_discounts_amount >= 0
    AND ipi_amount >= 0
    AND configured_tax_amount >= 0
    AND freight_amount >= 0
    AND grand_total_amount >= 0
    AND commission_basis_amount >= 0
    AND commission_amount >= 0
  )
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx
  ON orders (status, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS orders_client_created_idx
  ON orders (client_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  source_quote_line_id uuid NOT NULL,
  line_number integer NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  product_industry_id uuid NOT NULL,
  product_industry_name text NOT NULL CHECK (btrim(product_industry_name) <> ''),
  product_internal_code text NOT NULL CHECK (btrim(product_internal_code) <> ''),
  product_manufacturer_code text,
  product_description text NOT NULL CHECK (btrim(product_description) <> ''),
  product_brand text,
  product_category text,
  product_ncm text,
  product_cest text,
  product_ean text,
  product_dun text,
  product_packaging text,
  product_unit text NOT NULL CHECK (btrim(product_unit) <> ''),
  quantity numeric(19, 6) NOT NULL,
  price_list_id uuid NOT NULL,
  product_price_version_id uuid NOT NULL,
  unit_price_source text NOT NULL,
  unit_price_amount numeric(19, 6) NOT NULL,
  gross_amount numeric(19, 6) NOT NULL,
  per_item_discount_rate numeric(9, 6) NOT NULL,
  per_item_discount_amount numeric(19, 6) NOT NULL,
  net_before_general_discount_amount numeric(19, 6) NOT NULL,
  allocated_general_discount_amount numeric(19, 6) NOT NULL,
  net_after_discounts_amount numeric(19, 6) NOT NULL,
  ipi_rate numeric(9, 6) NOT NULL,
  ipi_basis_amount numeric(19, 6) NOT NULL,
  ipi_amount numeric(19, 6) NOT NULL,
  configured_tax_amount numeric(19, 6) NOT NULL,
  freight_amount numeric(19, 6) NOT NULL,
  line_total_amount numeric(19, 6) NOT NULL,
  commission_source text NOT NULL,
  commission_rate numeric(9, 6),
  commission_basis_amount numeric(19, 6) NOT NULL,
  commission_amount numeric(19, 6) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT order_lines_order_line_number_uidx UNIQUE (order_id, line_number),
  CONSTRAINT order_lines_order_quote_line_uidx UNIQUE (order_id, source_quote_line_id),
  CONSTRAINT order_lines_source_ck CHECK (
    unit_price_source IN ('price_list', 'manual_override')
    AND commission_source IN ('product_override', 'industry_default', 'none')
    AND ((commission_source = 'none' AND commission_rate IS NULL)
      OR (commission_source <> 'none' AND commission_rate BETWEEN 0 AND 100))
  ),
  CONSTRAINT order_lines_amounts_ck CHECK (
    quantity > 0 AND unit_price_amount >= 0 AND gross_amount >= 0
    AND per_item_discount_rate BETWEEN 0 AND 100
    AND per_item_discount_amount >= 0 AND net_before_general_discount_amount >= 0
    AND allocated_general_discount_amount >= 0 AND net_after_discounts_amount >= 0
    AND ipi_rate BETWEEN 0 AND 100 AND ipi_basis_amount >= 0 AND ipi_amount >= 0
    AND configured_tax_amount >= 0 AND freight_amount >= 0 AND line_total_amount >= 0
    AND commission_basis_amount >= 0 AND commission_amount >= 0
  )
);
CREATE INDEX IF NOT EXISTS order_lines_product_idx ON order_lines (product_id, order_id);

CREATE TABLE IF NOT EXISTS order_line_taxes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_line_id uuid NOT NULL REFERENCES order_lines(id) ON DELETE RESTRICT,
  code text NOT NULL CHECK (btrim(code) <> ''),
  rate numeric(9, 6) NOT NULL CHECK (rate BETWEEN 0 AND 100),
  basis_amount numeric(19, 6) NOT NULL CHECK (basis_amount >= 0),
  amount numeric(19, 6) NOT NULL CHECK (amount >= 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT order_line_taxes_line_code_uidx UNIQUE (order_line_id, code)
);

CREATE TABLE IF NOT EXISTS order_state_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  actor text NOT NULL CHECK (btrim(actor) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL CHECK (version > 0),
  CONSTRAINT order_state_audit_order_version_uidx UNIQUE (order_id, version),
  CONSTRAINT order_state_audit_states_ck CHECK (
    (from_status IS NULL OR from_status IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled'))
    AND to_status IN ('open', 'confirmed', 'invoiced', 'completed', 'cancelled')
  )
);
CREATE INDEX IF NOT EXISTS order_state_audit_actor_idx
  ON order_state_audit (actor, occurred_at DESC);

CREATE OR REPLACE FUNCTION protect_order_snapshots()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF ROW(
    NEW.id, NEW.source_quote_id, NEW.source_quote_revision, NEW.number,
    NEW.number_year, NEW.number_sequence, NEW.client_id, NEW.client_legal_name,
    NEW.client_trade_name, NEW.client_tax_identifier, NEW.client_state_registration,
    NEW.client_email, NEW.client_phone, NEW.client_address_street,
    NEW.client_address_number, NEW.client_address_complement,
    NEW.client_address_district, NEW.client_address_city, NEW.client_address_state,
    NEW.client_address_postal_code, NEW.client_address_country_code, NEW.currency_code,
    NEW.gross_items_amount, NEW.per_item_discount_amount, NEW.net_items_amount,
    NEW.general_discount_rate, NEW.general_discount_amount, NEW.net_after_discounts_amount,
    NEW.ipi_amount, NEW.configured_tax_amount, NEW.freight_amount, NEW.grand_total_amount,
    NEW.commission_basis_amount, NEW.commission_amount, NEW.created_at, NEW.created_by,
    NEW.creation_reason
  ) IS DISTINCT FROM ROW(
    OLD.id, OLD.source_quote_id, OLD.source_quote_revision, OLD.number,
    OLD.number_year, OLD.number_sequence, OLD.client_id, OLD.client_legal_name,
    OLD.client_trade_name, OLD.client_tax_identifier, OLD.client_state_registration,
    OLD.client_email, OLD.client_phone, OLD.client_address_street,
    OLD.client_address_number, OLD.client_address_complement,
    OLD.client_address_district, OLD.client_address_city, OLD.client_address_state,
    OLD.client_address_postal_code, OLD.client_address_country_code, OLD.currency_code,
    OLD.gross_items_amount, OLD.per_item_discount_amount, OLD.net_items_amount,
    OLD.general_discount_rate, OLD.general_discount_amount, OLD.net_after_discounts_amount,
    OLD.ipi_amount, OLD.configured_tax_amount, OLD.freight_amount, OLD.grand_total_amount,
    OLD.commission_basis_amount, OLD.commission_amount, OLD.created_at, OLD.created_by,
    OLD.creation_reason
  ) THEN
    RAISE EXCEPTION 'order quote snapshots are immutable' USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_order_snapshot_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'order line and tax snapshots are immutable' USING ERRCODE = '55000';
END;
$$;

CREATE OR REPLACE FUNCTION prevent_order_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'order state audit is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS orders_protect_snapshots_trg ON orders;
CREATE TRIGGER orders_protect_snapshots_trg
BEFORE UPDATE ON orders FOR EACH ROW EXECUTE FUNCTION protect_order_snapshots();
DROP TRIGGER IF EXISTS order_lines_protect_mutation_trg ON order_lines;
CREATE TRIGGER order_lines_protect_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON order_lines
FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_snapshot_mutation();
DROP TRIGGER IF EXISTS order_line_taxes_protect_mutation_trg ON order_line_taxes;
CREATE TRIGGER order_line_taxes_protect_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON order_line_taxes
FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_snapshot_mutation();
DROP TRIGGER IF EXISTS order_state_audit_protect_mutation_trg ON order_state_audit;
CREATE TRIGGER order_state_audit_protect_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON order_state_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_audit_mutation();
