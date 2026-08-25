-- weyne:migration compatibility=expand previous-app-compatible=true
-- Ensures the carrier reference is added when orders are introduced after carriers.
ALTER TABLE IF EXISTS orders ADD COLUMN IF NOT EXISTS carrier_id uuid;

DO $$
BEGIN
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

DO $$
BEGIN
  IF to_regclass('orders') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS orders_carrier_idx ON orders (carrier_id)
      WHERE carrier_id IS NOT NULL;
  END IF;
END;
$$;
