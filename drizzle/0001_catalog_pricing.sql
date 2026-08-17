-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS industries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  legal_name text NOT NULL CHECK (btrim(legal_name) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  archived_at timestamptz,
  archived_by text,
  is_active boolean GENERATED ALWAYS AS (archived_at IS NULL) STORED,
  CONSTRAINT industries_archive_actor_ck CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND btrim(archived_by) <> '')
  )
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  industry_id uuid NOT NULL REFERENCES industries(id) ON DELETE RESTRICT,
  internal_code text NOT NULL,
  internal_code_normalized text GENERATED ALWAYS AS (
    regexp_replace(upper(internal_code), '[^A-Z0-9]', '', 'g')
  ) STORED,
  manufacturer_code text,
  manufacturer_code_normalized text GENERATED ALWAYS AS (
    CASE WHEN manufacturer_code IS NULL THEN NULL
      ELSE regexp_replace(upper(manufacturer_code), '[^A-Z0-9]', '', 'g') END
  ) STORED,
  description text NOT NULL,
  brand text,
  category text,
  ncm text,
  ncm_normalized text GENERATED ALWAYS AS (
    CASE WHEN ncm IS NULL THEN NULL ELSE regexp_replace(upper(ncm), '[^A-Z0-9]', '', 'g') END
  ) STORED,
  cest text,
  cest_normalized text GENERATED ALWAYS AS (
    CASE WHEN cest IS NULL THEN NULL ELSE regexp_replace(upper(cest), '[^A-Z0-9]', '', 'g') END
  ) STORED,
  ean text,
  ean_normalized text GENERATED ALWAYS AS (
    CASE WHEN ean IS NULL THEN NULL ELSE regexp_replace(upper(ean), '[^A-Z0-9]', '', 'g') END
  ) STORED,
  dun text,
  dun_normalized text GENERATED ALWAYS AS (
    CASE WHEN dun IS NULL THEN NULL ELSE regexp_replace(upper(dun), '[^A-Z0-9]', '', 'g') END
  ) STORED,
  packaging text,
  unit text NOT NULL,
  net_weight numeric(18, 6),
  gross_weight numeric(18, 6),
  width numeric(18, 6),
  height numeric(18, 6),
  depth numeric(18, 6),
  dimension_unit text,
  ipi_rate numeric(9, 6),
  icms_rate numeric(9, 6),
  pis_rate numeric(9, 6),
  cofins_rate numeric(9, 6),
  commission_override numeric(9, 6),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  archived_at timestamptz,
  archived_by text,
  is_active boolean GENERATED ALWAYS AS (archived_at IS NULL) STORED,
  CONSTRAINT products_internal_code_ck CHECK (btrim(internal_code) <> '' AND internal_code_normalized <> ''),
  CONSTRAINT products_description_ck CHECK (btrim(description) <> ''),
  CONSTRAINT products_unit_ck CHECK (btrim(unit) <> ''),
  CONSTRAINT products_manufacturer_code_ck CHECK (
    manufacturer_code IS NULL OR manufacturer_code_normalized <> ''
  ),
  CONSTRAINT products_ncm_ck CHECK (ncm IS NULL OR ncm_normalized <> ''),
  CONSTRAINT products_cest_ck CHECK (cest IS NULL OR cest_normalized <> ''),
  CONSTRAINT products_ean_ck CHECK (ean IS NULL OR ean_normalized <> ''),
  CONSTRAINT products_dun_ck CHECK (dun IS NULL OR dun_normalized <> ''),
  CONSTRAINT products_weights_ck CHECK (
    (net_weight IS NULL OR net_weight >= 0)
    AND (gross_weight IS NULL OR gross_weight >= 0)
  ),
  CONSTRAINT products_dimensions_ck CHECK (
    (width IS NULL OR width >= 0)
    AND (height IS NULL OR height >= 0)
    AND (depth IS NULL OR depth >= 0)
    AND (
      (width IS NULL AND height IS NULL AND depth IS NULL)
      OR (dimension_unit IS NOT NULL AND btrim(dimension_unit) <> '')
    )
  ),
  CONSTRAINT products_percentages_ck CHECK (
    (ipi_rate IS NULL OR ipi_rate BETWEEN 0 AND 100)
    AND (icms_rate IS NULL OR icms_rate BETWEEN 0 AND 100)
    AND (pis_rate IS NULL OR pis_rate BETWEEN 0 AND 100)
    AND (cofins_rate IS NULL OR cofins_rate BETWEEN 0 AND 100)
    AND (commission_override IS NULL OR commission_override BETWEEN 0 AND 100)
  ),
  CONSTRAINT products_archive_actor_ck CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND btrim(archived_by) <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS products_internal_code_normalized_uidx
  ON products (internal_code_normalized);
CREATE INDEX IF NOT EXISTS products_active_list_idx
  ON products (lower(description), internal_code_normalized, id)
  WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS products_active_brand_idx
  ON products (brand, id) WHERE archived_at IS NULL AND brand IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_active_industry_idx
  ON products (industry_id, id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS products_active_category_idx
  ON products (category, id) WHERE archived_at IS NULL AND category IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_manufacturer_code_normalized_idx
  ON products (manufacturer_code_normalized)
  WHERE manufacturer_code_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_ncm_normalized_idx
  ON products (ncm_normalized) WHERE ncm_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_cest_normalized_idx
  ON products (cest_normalized) WHERE cest_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_ean_normalized_idx
  ON products (ean_normalized) WHERE ean_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS products_dun_normalized_idx
  ON products (dun_normalized) WHERE dun_normalized IS NOT NULL;

CREATE TABLE IF NOT EXISTS price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  display_name text NOT NULL CHECK (btrim(display_name) <> ''),
  position smallint NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT price_lists_canonical_key_position_ck CHECK (
    (key = 'PRICE_1' AND position = 1)
    OR (key = 'PRICE_2' AND position = 2)
    OR (key = 'PRICE_3' AND position = 3)
    OR (key = 'PRICE_4' AND position = 4)
  )
);

INSERT INTO price_lists (id, key, display_name, position)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'PRICE_1', 'Preço 1', 1),
  ('00000000-0000-4000-8000-000000000002', 'PRICE_2', 'Preço 2', 2),
  ('00000000-0000-4000-8000-000000000003', 'PRICE_3', 'Preço 3', 3),
  ('00000000-0000-4000-8000-000000000004', 'PRICE_4', 'Preço 4', 4)
ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS product_prices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,
  amount numeric(19, 6) NOT NULL CHECK (amount >= 0),
  currency_code char(3) NOT NULL DEFAULT 'BRL' CHECK (currency_code ~ '^[A-Z]{3}$'),
  version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL CHECK (btrim(updated_by) <> ''),
  CONSTRAINT product_prices_product_list_uidx UNIQUE (product_id, price_list_id)
);

CREATE INDEX IF NOT EXISTS product_prices_product_idx
  ON product_prices (product_id, price_list_id);
CREATE INDEX IF NOT EXISTS product_prices_price_list_idx
  ON product_prices (price_list_id, product_id);

CREATE TABLE IF NOT EXISTS product_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_price_id uuid NOT NULL REFERENCES product_prices(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE RESTRICT,
  old_amount numeric(19, 6),
  new_amount numeric(19, 6) NOT NULL,
  old_currency_code char(3),
  new_currency_code char(3) NOT NULL,
  actor text NOT NULL CHECK (btrim(actor) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  version bigint NOT NULL CHECK (version > 0),
  CONSTRAINT product_price_history_amounts_ck CHECK (
    (old_amount IS NULL OR old_amount >= 0) AND new_amount >= 0
  ),
  CONSTRAINT product_price_history_currency_ck CHECK (
    (old_currency_code IS NULL OR old_currency_code ~ '^[A-Z]{3}$')
    AND new_currency_code ~ '^[A-Z]{3}$'
  ),
  CONSTRAINT product_price_history_version_uidx UNIQUE (product_price_id, version)
);

CREATE INDEX IF NOT EXISTS product_price_history_lookup_idx
  ON product_price_history (product_id, price_list_id, changed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS product_price_history_actor_idx
  ON product_price_history (actor, changed_at DESC);

CREATE OR REPLACE FUNCTION normalize_product_text_fields()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.internal_code := btrim(NEW.internal_code);
  NEW.manufacturer_code := NULLIF(btrim(NEW.manufacturer_code), '');
  NEW.description := btrim(NEW.description);
  NEW.brand := NULLIF(btrim(NEW.brand), '');
  NEW.category := NULLIF(btrim(NEW.category), '');
  NEW.ncm := NULLIF(btrim(NEW.ncm), '');
  NEW.cest := NULLIF(btrim(NEW.cest), '');
  NEW.ean := NULLIF(btrim(NEW.ean), '');
  NEW.dun := NULLIF(btrim(NEW.dun), '');
  NEW.packaging := NULLIF(btrim(NEW.packaging), '');
  NEW.unit := btrim(NEW.unit);
  NEW.dimension_unit := NULLIF(btrim(NEW.dimension_unit), '');
  NEW.created_by := btrim(NEW.created_by);
  NEW.updated_by := btrim(NEW.updated_by);
  NEW.archived_by := NULLIF(btrim(NEW.archived_by), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS products_normalize_text_fields_trg ON products;
CREATE TRIGGER products_normalize_text_fields_trg
BEFORE INSERT OR UPDATE ON products
FOR EACH ROW EXECUTE FUNCTION normalize_product_text_fields();

CREATE OR REPLACE FUNCTION prevent_catalog_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalog hard delete is prohibited for table %', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS industries_prevent_hard_delete_trg ON industries;
CREATE TRIGGER industries_prevent_hard_delete_trg
BEFORE DELETE OR TRUNCATE ON industries
FOR EACH STATEMENT EXECUTE FUNCTION prevent_catalog_hard_delete();

DROP TRIGGER IF EXISTS products_prevent_hard_delete_trg ON products;
CREATE TRIGGER products_prevent_hard_delete_trg
BEFORE DELETE OR TRUNCATE ON products
FOR EACH STATEMENT EXECUTE FUNCTION prevent_catalog_hard_delete();

DROP TRIGGER IF EXISTS price_lists_prevent_hard_delete_trg ON price_lists;
CREATE TRIGGER price_lists_prevent_hard_delete_trg
BEFORE DELETE OR TRUNCATE ON price_lists
FOR EACH STATEMENT EXECUTE FUNCTION prevent_catalog_hard_delete();

DROP TRIGGER IF EXISTS product_prices_prevent_hard_delete_trg ON product_prices;
CREATE TRIGGER product_prices_prevent_hard_delete_trg
BEFORE DELETE OR TRUNCATE ON product_prices
FOR EACH STATEMENT EXECUTE FUNCTION prevent_catalog_hard_delete();

CREATE OR REPLACE FUNCTION protect_price_list_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key OR NEW.position IS DISTINCT FROM OLD.position THEN
    RAISE EXCEPTION 'canonical price-list key and position are immutable'
      USING ERRCODE = '55000';
  END IF;
  NEW.display_name := btrim(NEW.display_name);
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS price_lists_protect_identity_trg ON price_lists;
CREATE TRIGGER price_lists_protect_identity_trg
BEFORE UPDATE ON price_lists
FOR EACH ROW EXECUTE FUNCTION protect_price_list_identity();

CREATE OR REPLACE FUNCTION prepare_product_price_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  change_actor text := NULLIF(btrim(current_setting('app.actor', true)), '');
  change_reason text := NULLIF(btrim(current_setting('app.price_change_reason', true)), '');
  product_is_active boolean;
BEGIN
  IF change_actor IS NULL THEN
    RAISE EXCEPTION 'price change actor is required' USING ERRCODE = '22023';
  END IF;
  IF change_reason IS NULL THEN
    RAISE EXCEPTION 'price change reason is required' USING ERRCODE = '22023';
  END IF;

  SELECT is_active INTO product_is_active
  FROM products
  WHERE id = NEW.product_id;
  IF product_is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'price changes require an active product' USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.product_id IS DISTINCT FROM OLD.product_id
      OR NEW.price_list_id IS DISTINCT FROM OLD.price_list_id THEN
      RAISE EXCEPTION 'product-price identity is immutable' USING ERRCODE = '55000';
    END IF;

    IF NEW.amount IS NOT DISTINCT FROM OLD.amount
      AND NEW.currency_code IS NOT DISTINCT FROM OLD.currency_code THEN
      NEW := OLD;
      RETURN NEW;
    END IF;

    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := 1;
  END IF;

  NEW.updated_at := clock_timestamp();
  NEW.updated_by := change_actor;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION append_product_price_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  change_actor text := NULLIF(btrim(current_setting('app.actor', true)), '');
  change_reason text := NULLIF(btrim(current_setting('app.price_change_reason', true)), '');
BEGIN
  IF TG_OP = 'UPDATE'
    AND NEW.amount IS NOT DISTINCT FROM OLD.amount
    AND NEW.currency_code IS NOT DISTINCT FROM OLD.currency_code THEN
    RETURN NEW;
  END IF;

  PERFORM set_config('app.internal_price_history_write', 'on', true);
  INSERT INTO product_price_history (
    product_price_id,
    product_id,
    price_list_id,
    old_amount,
    new_amount,
    old_currency_code,
    new_currency_code,
    actor,
    reason,
    changed_at,
    version
  ) VALUES (
    NEW.id,
    NEW.product_id,
    NEW.price_list_id,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.amount END,
    NEW.amount,
    CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.currency_code END,
    NEW.currency_code,
    change_actor,
    change_reason,
    NEW.updated_at,
    NEW.version
  );
  PERFORM set_config('app.internal_price_history_write', '', true);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_product_price_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF current_setting('app.internal_price_history_write', true) IS DISTINCT FROM 'on' THEN
      RAISE EXCEPTION 'price history is append-only and may only be written by the price trigger'
        USING ERRCODE = '55000';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'price history is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS product_prices_prepare_change_trg ON product_prices;
CREATE TRIGGER product_prices_prepare_change_trg
BEFORE INSERT OR UPDATE ON product_prices
FOR EACH ROW EXECUTE FUNCTION prepare_product_price_change();

DROP TRIGGER IF EXISTS product_prices_append_history_trg ON product_prices;
CREATE TRIGGER product_prices_append_history_trg
AFTER INSERT OR UPDATE ON product_prices
FOR EACH ROW EXECUTE FUNCTION append_product_price_history();

DROP TRIGGER IF EXISTS product_price_history_protect_insert_trg ON product_price_history;
CREATE TRIGGER product_price_history_protect_insert_trg
BEFORE INSERT ON product_price_history
FOR EACH ROW EXECUTE FUNCTION protect_product_price_history();

DROP TRIGGER IF EXISTS product_price_history_protect_mutation_trg ON product_price_history;
CREATE TRIGGER product_price_history_protect_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON product_price_history
FOR EACH STATEMENT EXECUTE FUNCTION protect_product_price_history();
