-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS carrier_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id uuid NOT NULL,
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'representative', 'read_only')),
  carrier_id uuid NOT NULL REFERENCES carriers(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN ('carrier.create', 'carrier.update', 'carrier.archive')
  ),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS carrier_audit_carrier_idx
  ON carrier_audit (carrier_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS carrier_audit_actor_idx
  ON carrier_audit (actor_user_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION prevent_carrier_audit_rewrite()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'carrier audit is append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS carrier_audit_prevent_update_trg ON carrier_audit;
CREATE TRIGGER carrier_audit_prevent_update_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON carrier_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_carrier_audit_rewrite();
