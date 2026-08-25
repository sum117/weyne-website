-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS catalog_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  operation text NOT NULL CHECK (
    operation IN ('product.create', 'product.update', 'product.archive', 'price.update')
  ),
  target_type text NOT NULL CHECK (target_type IN ('product', 'product_price')),
  target_id uuid NOT NULL,
  reason text CHECK (reason IS NULL OR btrim(reason) <> ''),
  before_state jsonb,
  after_state jsonb,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS catalog_audit_target_idx
  ON catalog_audit (target_type, target_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS catalog_audit_actor_idx
  ON catalog_audit (actor_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_catalog_audit_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'catalog audit is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS catalog_audit_prevent_update_trg ON catalog_audit;
CREATE TRIGGER catalog_audit_prevent_update_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON catalog_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_catalog_audit_rewrite();