-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS document_sequences (
  document_type text NOT NULL,
  year integer NOT NULL,
  next_value bigint NOT NULL,
  PRIMARY KEY (document_type, year),
  CONSTRAINT document_sequences_type_ck CHECK (document_type IN ('quote', 'order')),
  CONSTRAINT document_sequences_year_ck CHECK (year BETWEEN 2000 AND 9999),
  CONSTRAINT document_sequences_value_ck CHECK (next_value > 0)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_number text NOT NULL UNIQUE,
  source_quote_id uuid REFERENCES quotes(id) ON DELETE RESTRICT,
  owner_user_id text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  valid_until date NOT NULL,
  version integer NOT NULL DEFAULT 1,
  customer_snapshot jsonb NOT NULL,
  commercial_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quotes_number_ck CHECK (quote_number ~ '^ORC-[0-9]{4}-[0-9]{6}$'),
  CONSTRAINT quotes_owner_ck CHECK (btrim(owner_user_id) <> ''),
  CONSTRAINT quotes_status_ck CHECK (
    status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled')
  ),
  CONSTRAINT quotes_version_ck CHECK (version > 0),
  CONSTRAINT quotes_customer_snapshot_ck CHECK (jsonb_typeof(customer_snapshot) = 'object'),
  CONSTRAINT quotes_commercial_snapshot_ck CHECK (jsonb_typeof(commercial_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS quotes_source_idx ON quotes (source_quote_id);
CREATE INDEX IF NOT EXISTS quotes_status_idx ON quotes (status, updated_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS quote_versions (
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  version integer NOT NULL,
  operation text NOT NULL,
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (quote_id, version),
  CONSTRAINT quote_versions_version_ck CHECK (version > 0),
  CONSTRAINT quote_versions_operation_ck CHECK (
    operation IN ('create', 'update', 'transition', 'duplicate')
  ),
  CONSTRAINT quote_versions_snapshot_ck CHECK (jsonb_typeof(snapshot) = 'object')
);

CREATE TABLE IF NOT EXISTS quote_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  operation text NOT NULL,
  version integer NOT NULL,
  command_id text NOT NULL UNIQUE,
  before_state jsonb,
  after_state jsonb NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT quote_audit_actor_ck CHECK (btrim(actor_id) <> ''),
  CONSTRAINT quote_audit_role_ck CHECK (
    actor_role IN ('admin', 'representative', 'read_only', 'system')
  ),
  CONSTRAINT quote_audit_operation_ck CHECK (
    operation IN ('create', 'update', 'transition', 'duplicate')
  ),
  CONSTRAINT quote_audit_version_ck CHECK (version > 0),
  CONSTRAINT quote_audit_command_ck CHECK (btrim(command_id) <> ''),
  CONSTRAINT quote_audit_before_ck CHECK (
    before_state IS NULL OR jsonb_typeof(before_state) = 'object'
  ),
  CONSTRAINT quote_audit_after_ck CHECK (jsonb_typeof(after_state) = 'object')
);

CREATE INDEX IF NOT EXISTS quote_audit_history_idx
  ON quote_audit (quote_id, version, occurred_at, id);

CREATE OR REPLACE FUNCTION prevent_quote_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote version and audit history are append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS quote_versions_prevent_mutation_trg ON quote_versions;
CREATE TRIGGER quote_versions_prevent_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON quote_versions
FOR EACH STATEMENT EXECUTE FUNCTION prevent_quote_history_mutation();

DROP TRIGGER IF EXISTS quote_audit_prevent_mutation_trg ON quote_audit;
CREATE TRIGGER quote_audit_prevent_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON quote_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_quote_history_mutation();
