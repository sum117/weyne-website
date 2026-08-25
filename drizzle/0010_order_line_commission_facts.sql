-- weyne:migration compatibility=expand previous-app-compatible=true
-- Immutable reportable commission facts on order lines.
--
-- Each column is a conversion-time snapshot: the selected commission source,
-- its rate, the explicit calculation basis, and the calculated value, plus
-- the discount components that produced the basis. Nothing here references
-- live commission rules; later edits to product overrides or industry
-- defaults cannot recalculate or silently change a converted order.
ALTER TABLE IF EXISTS order_lines ADD COLUMN IF NOT EXISTS commission_industry_id uuid;
ALTER TABLE IF EXISTS order_lines ADD COLUMN IF NOT EXISTS commission_provenance text;

DO $$
BEGIN
  IF to_regclass('order_lines') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('order_lines')
        AND conname = 'order_lines_commission_facts_ck'
    )
  THEN
    ALTER TABLE order_lines ADD CONSTRAINT order_lines_commission_facts_ck CHECK (
      (commission_source = 'none' AND commission_amount = 0)
      OR (commission_source <> 'none'
        AND commission_basis_amount >= 0 AND commission_amount >= 0)
    );
  END IF;

  -- Provenance is mandatory for new rows and describes which snapshot the
  -- selected rate came from. Existing rows keep NULL for compatibility.
  IF to_regclass('order_lines') IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conrelid = to_regclass('order_lines')
        AND conname = 'order_lines_commission_provenance_ck'
    )
  THEN
    ALTER TABLE order_lines ADD CONSTRAINT order_lines_commission_provenance_ck CHECK (
      commission_provenance IS NULL
      OR commission_provenance IN (
        'product_override_snapshot', 'industry_default_snapshot', 'no_rate_configured'
      )
    );
  END IF;
END;
$$;
