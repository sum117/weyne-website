-- weyne:migration compatibility=expand previous-app-compatible=true
ALTER TABLE industries
  ADD COLUMN IF NOT EXISTS archived_by_user_id uuid;

CREATE OR REPLACE FUNCTION is_valid_industry_cnpj(value text)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
STRICT
AS $$
DECLARE
  normalized text := regexp_replace(upper(value), '[^A-Z0-9]', '', 'g');
  first_weights integer[] := ARRAY[5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  second_weights integer[] := ARRAY[6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  first_sum integer := 0;
  second_sum integer := 0;
  first_digit integer;
  second_digit integer;
  character_value integer;
BEGIN
  IF normalized !~ '^[A-Z0-9]{12}[0-9]{2}$'
    OR normalized ~ '^([A-Z0-9])\1{13}$' THEN
    RETURN false;
  END IF;

  FOR position IN 1..12 LOOP
    character_value := ascii(substr(normalized, position, 1)) - 48;
    first_sum := first_sum + character_value * first_weights[position];
  END LOOP;
  first_digit := 11 - (first_sum % 11);
  IF first_digit >= 10 THEN first_digit := 0; END IF;

  FOR position IN 1..12 LOOP
    character_value := ascii(substr(normalized, position, 1)) - 48;
    second_sum := second_sum + character_value * second_weights[position];
  END LOOP;
  second_sum := second_sum + first_digit * second_weights[13];
  second_digit := 11 - (second_sum % 11);
  IF second_digit >= 10 THEN second_digit := 0; END IF;

  RETURN right(normalized, 2) = first_digit::text || second_digit::text;
END;
$$;

CREATE TABLE IF NOT EXISTS industry_profiles (
  industry_id uuid PRIMARY KEY REFERENCES industries(id) ON DELETE RESTRICT,
  trade_name text NOT NULL,
  cnpj text NOT NULL,
  street text NOT NULL,
  address_number text NOT NULL,
  address_complement text,
  district text NOT NULL,
  city text NOT NULL,
  state char(2) NOT NULL,
  postal_code char(8) NOT NULL,
  country_code char(2) NOT NULL DEFAULT 'BR',
  default_commission_percentage numeric(9, 6) NOT NULL,
  notes text,
  created_by_user_id uuid NOT NULL,
  updated_by_user_id uuid NOT NULL,
  CONSTRAINT industries_trade_name_ck
    CHECK (btrim(trade_name) <> '' AND char_length(trade_name) <= 160),
  CONSTRAINT industries_cnpj_ck CHECK (is_valid_industry_cnpj(cnpj)),
  CONSTRAINT industries_address_ck CHECK (
    btrim(street) <> '' AND char_length(street) <= 160
    AND btrim(address_number) <> '' AND char_length(address_number) <= 30
    AND (address_complement IS NULL OR (btrim(address_complement) <> '' AND char_length(address_complement) <= 80))
    AND btrim(district) <> '' AND char_length(district) <= 80
    AND btrim(city) <> '' AND char_length(city) <= 120
    AND state ~ '^[A-Z]{2}$'
    AND postal_code ~ '^[0-9]{8}$'
    AND country_code = 'BR'
  ),
  CONSTRAINT industries_default_commission_ck
    CHECK (default_commission_percentage BETWEEN 0 AND 100),
  CONSTRAINT industries_notes_ck
    CHECK (notes IS NULL OR (btrim(notes) <> '' AND char_length(notes) <= 2000))
);

CREATE OR REPLACE FUNCTION normalize_industry_profile()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.trade_name := btrim(NEW.trade_name);
  NEW.cnpj := regexp_replace(upper(NEW.cnpj), '[^A-Z0-9]', '', 'g');
  NEW.street := btrim(NEW.street);
  NEW.address_number := btrim(NEW.address_number);
  NEW.address_complement := NULLIF(btrim(NEW.address_complement), '');
  NEW.district := btrim(NEW.district);
  NEW.city := btrim(NEW.city);
  NEW.state := upper(btrim(NEW.state));
  NEW.postal_code := regexp_replace(NEW.postal_code, '[^0-9]', '', 'g');
  NEW.country_code := upper(btrim(NEW.country_code));
  NEW.notes := NULLIF(btrim(NEW.notes), '');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS industry_profiles_normalize_trg ON industry_profiles;
CREATE TRIGGER industry_profiles_normalize_trg
BEFORE INSERT OR UPDATE ON industry_profiles
FOR EACH ROW EXECUTE FUNCTION normalize_industry_profile();

CREATE UNIQUE INDEX IF NOT EXISTS industries_cnpj_uidx ON industry_profiles (cnpj);
CREATE INDEX IF NOT EXISTS industries_active_legal_name_idx
  ON industries (lower(legal_name), id) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS industries_active_trade_name_idx
  ON industry_profiles (lower(trade_name), industry_id);
CREATE INDEX IF NOT EXISTS industries_cnpj_idx ON industry_profiles (cnpj, industry_id);
CREATE INDEX IF NOT EXISTS industries_created_idx ON industries (created_at, id);
CREATE INDEX IF NOT EXISTS industries_updated_idx ON industries (updated_at, id);
CREATE INDEX IF NOT EXISTS industries_archive_idx ON industries (archived_at, id);
