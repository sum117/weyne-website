-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS carriers (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  tax_id text,
  contact_name text,
  email text,
  phone text,
  street_address text,
  postal_code text,
  city text,
  state text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_user_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by_user_id uuid NOT NULL,
  archived_at timestamptz,
  archived_by_user_id uuid,
  CONSTRAINT carriers_name_ck CHECK (btrim(name) <> ''),
  CONSTRAINT carriers_tax_id_ck CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{14}$'),
  CONSTRAINT carriers_postal_code_ck CHECK (
    postal_code IS NULL OR postal_code ~ '^[0-9]{8}$'
  ),
  CONSTRAINT carriers_state_ck CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  CONSTRAINT carriers_archive_actor_ck CHECK (
    (archived_at IS NULL AND archived_by_user_id IS NULL)
    OR (archived_at IS NOT NULL AND archived_by_user_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS carriers_tax_id_uidx
  ON carriers (tax_id) WHERE tax_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carriers_name_idx ON carriers (lower(name), id);
CREATE INDEX IF NOT EXISTS carriers_created_idx ON carriers (created_at, id);
CREATE INDEX IF NOT EXISTS carriers_updated_idx ON carriers (updated_at, id);
CREATE INDEX IF NOT EXISTS carriers_archive_idx ON carriers (archived_at, id);

ALTER TABLE IF EXISTS quotes ADD COLUMN IF NOT EXISTS carrier_id uuid;
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS carrier_id uuid;

DO $$
BEGIN
  IF to_regclass('quotes') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('quotes')
        AND conname = 'quotes_carrier_id_carriers_id_fk'
    )
  THEN
    ALTER TABLE quotes
      ADD CONSTRAINT quotes_carrier_id_carriers_id_fk
      FOREIGN KEY (carrier_id) REFERENCES carriers(id) ON DELETE RESTRICT;
  END IF;

  IF to_regclass('orders') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('orders')
        AND conname = 'orders_carrier_id_carriers_id_fk'
    )
  THEN
    ALTER TABLE orders
      ADD CONSTRAINT orders_carrier_id_carriers_id_fk
      FOREIGN KEY (carrier_id) REFERENCES carriers(id) ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS quotes_carrier_idx ON quotes (carrier_id)
  WHERE carrier_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('orders') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS orders_carrier_idx ON orders (carrier_id)
      WHERE carrier_id IS NOT NULL;
  END IF;
END;
$$;
