-- weyne:migration compatibility=expand previous-app-compatible=true
-- PostgreSQL invariants that cannot be represented by Drizzle table builders.

CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE product_prices
  ADD CONSTRAINT product_prices_no_overlapping_validity
  EXCLUDE USING gist (
    product_id WITH =,
    price_list_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  );

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_no_overlapping_industry_validity
  EXCLUDE USING gist (
    industry_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope = 'industry_default');

ALTER TABLE commission_rules
  ADD CONSTRAINT commission_rules_no_overlapping_product_validity
  EXCLUDE USING gist (
    product_id WITH =,
    tstzrange(valid_from, COALESCE(valid_to, 'infinity'::timestamptz), '[)') WITH &&
  ) WHERE (scope = 'product_override');

ALTER TABLE price_lists
  ADD CONSTRAINT price_lists_display_name_ck CHECK (btrim(display_name) <> '');

CREATE FUNCTION price_lists_protect_canonical_set()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  expected_id uuid;
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION 'canonical price lists are permanent and cannot be deleted'
      USING ERRCODE = '55000';
  END IF;

  expected_id := CASE NEW.key
    WHEN 'PRICE_1' THEN '00000000-0000-4000-8000-000000000001'::uuid
    WHEN 'PRICE_2' THEN '00000000-0000-4000-8000-000000000002'::uuid
    WHEN 'PRICE_3' THEN '00000000-0000-4000-8000-000000000003'::uuid
    WHEN 'PRICE_4' THEN '00000000-0000-4000-8000-000000000004'::uuid
  END;

  IF NEW.id IS DISTINCT FROM expected_id THEN
    RAISE EXCEPTION 'canonical price-list key has an invalid stable identifier'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE'
    AND (NEW.id IS DISTINCT FROM OLD.id
      OR NEW.key IS DISTINCT FROM OLD.key
      OR NEW.position IS DISTINCT FROM OLD.position) THEN
    RAISE EXCEPTION 'canonical price-list identity is immutable'
      USING ERRCODE = '55000';
  END IF;

  NEW.display_name := btrim(NEW.display_name);
  IF TG_OP = 'UPDATE' THEN
    NEW.updated_at := clock_timestamp();
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER price_lists_protect_canonical_set_row_trg
BEFORE INSERT OR UPDATE OR DELETE ON price_lists
FOR EACH ROW EXECUTE FUNCTION price_lists_protect_canonical_set();

CREATE TRIGGER price_lists_protect_canonical_set_truncate_trg
BEFORE TRUNCATE ON price_lists
FOR EACH STATEMENT EXECUTE FUNCTION price_lists_protect_canonical_set();

INSERT INTO price_lists (id, key, display_name, position)
VALUES
  ('00000000-0000-4000-8000-000000000001', 'PRICE_1', 'Preço 1', 1),
  ('00000000-0000-4000-8000-000000000002', 'PRICE_2', 'Preço 2', 2),
  ('00000000-0000-4000-8000-000000000003', 'PRICE_3', 'Preço 3', 3),
  ('00000000-0000-4000-8000-000000000004', 'PRICE_4', 'Preço 4', 4);

CREATE FUNCTION prevent_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% is append-only; % is prohibited', TG_TABLE_NAME, TG_OP
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER quote_events_append_only_row_trg
BEFORE UPDATE OR DELETE ON quote_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER quote_events_append_only_truncate_trg
BEFORE TRUNCATE ON quote_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER order_events_append_only_row_trg
BEFORE UPDATE OR DELETE ON order_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER order_events_append_only_truncate_trg
BEFORE TRUNCATE ON order_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER audit_events_append_only_row_trg
BEFORE UPDATE OR DELETE ON audit_events
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER audit_events_append_only_truncate_trg
BEFORE TRUNCATE ON audit_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_append_only_mutation();

CREATE TRIGGER order_lines_append_only_row_trg
BEFORE UPDATE OR DELETE ON order_lines
FOR EACH ROW EXECUTE FUNCTION prevent_append_only_mutation();
CREATE TRIGGER order_lines_append_only_truncate_trg
BEFORE TRUNCATE ON order_lines
FOR EACH STATEMENT EXECUTE FUNCTION prevent_append_only_mutation();

CREATE FUNCTION protect_version_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN
    RAISE EXCEPTION '% version history is append-only', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  IF (to_jsonb(NEW) - 'valid_to' - 'ended_by_user_id')
      IS DISTINCT FROM
     (to_jsonb(OLD) - 'valid_to' - 'ended_by_user_id')
    OR OLD.valid_to IS NOT NULL
    OR NEW.valid_to IS NULL
    OR NEW.ended_by_user_id IS NULL THEN
    RAISE EXCEPTION '% versions may only be closed once', TG_TABLE_NAME
      USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER product_prices_protect_version_row_trg
BEFORE UPDATE OR DELETE ON product_prices
FOR EACH ROW EXECUTE FUNCTION protect_version_history();
CREATE TRIGGER product_prices_protect_version_truncate_trg
BEFORE TRUNCATE ON product_prices
FOR EACH STATEMENT EXECUTE FUNCTION protect_version_history();

CREATE TRIGGER commission_rules_protect_version_row_trg
BEFORE UPDATE OR DELETE ON commission_rules
FOR EACH ROW EXECUTE FUNCTION protect_version_history();
CREATE TRIGGER commission_rules_protect_version_truncate_trg
BEFORE TRUNCATE ON commission_rules
FOR EACH STATEMENT EXECUTE FUNCTION protect_version_history();

CREATE FUNCTION prevent_business_record_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% business records must be archived, not hard deleted', TG_TABLE_NAME
    USING ERRCODE = '55000';
END;
$$;

CREATE TRIGGER representatives_prevent_hard_delete_trg BEFORE DELETE ON representatives
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER customers_prevent_hard_delete_trg BEFORE DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER industries_prevent_hard_delete_trg BEFORE DELETE ON industries
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER carriers_prevent_hard_delete_trg BEFORE DELETE ON carriers
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER products_prevent_hard_delete_trg BEFORE DELETE ON products
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER product_assets_prevent_hard_delete_trg BEFORE DELETE ON product_assets
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();
CREATE TRIGGER attachments_prevent_hard_delete_trg BEFORE DELETE ON attachments
FOR EACH ROW EXECUTE FUNCTION prevent_business_record_hard_delete();

CREATE FUNCTION quote_order_conversion_pair_ck()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  target_quote_id uuid;
  target_order_id uuid;
  paired_quote_id uuid;
  paired_order_id uuid;
  paired_quote_status quote_status;
BEGIN
  IF TG_TABLE_NAME = 'quotes' THEN
    target_quote_id := NEW.id;
    target_order_id := NEW.converted_order_id;

    SELECT source_quote_id INTO paired_quote_id
    FROM orders
    WHERE id = target_order_id;

    IF target_order_id IS NULL THEN
      IF EXISTS (SELECT 1 FROM orders WHERE source_quote_id = target_quote_id) THEN
        RAISE EXCEPTION 'quote and order conversion links must be reciprocal'
          USING ERRCODE = '23514';
      END IF;
    ELSIF paired_quote_id IS DISTINCT FROM target_quote_id THEN
      RAISE EXCEPTION 'quote and order conversion links must be reciprocal'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    target_order_id := NEW.id;
    target_quote_id := NEW.source_quote_id;

    SELECT converted_order_id, status
      INTO paired_order_id, paired_quote_status
    FROM quotes
    WHERE id = target_quote_id;

    IF paired_order_id IS DISTINCT FROM target_order_id
      OR paired_quote_status IS DISTINCT FROM 'converted'::quote_status THEN
      RAISE EXCEPTION 'quote and order conversion links must be reciprocal'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER quotes_conversion_pair_trg
AFTER INSERT OR UPDATE ON quotes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION quote_order_conversion_pair_ck();

CREATE CONSTRAINT TRIGGER orders_conversion_pair_trg
AFTER INSERT OR UPDATE ON orders
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION quote_order_conversion_pair_ck();
