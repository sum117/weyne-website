-- weyne:migration compatibility=expand previous-app-compatible=true
ALTER TABLE quotes
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ready_to_send boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by text,
  ADD COLUMN IF NOT EXISTS rejected_at timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by text,
  ADD COLUMN IF NOT EXISTS rejected_reason text,
  ADD COLUMN IF NOT EXISTS expired_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_by text,
  ADD COLUMN IF NOT EXISTS cancelled_reason text;

CREATE TABLE IF NOT EXISTS quote_transition_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  actor_id text NOT NULL,
  actor_role text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  from_status text NOT NULL,
  to_status text NOT NULL,
  reason text,
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  CONSTRAINT quote_transition_history_actor_ck CHECK (btrim(actor_id) <> ''),
  CONSTRAINT quote_transition_history_role_ck CHECK (
    actor_role IN ('admin', 'representative', 'read_only', 'system')
  ),
  CONSTRAINT quote_transition_history_from_ck CHECK (
    from_status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled')
  ),
  CONSTRAINT quote_transition_history_to_ck CHECK (
    to_status IN ('draft', 'sent', 'approved', 'rejected', 'expired', 'converted', 'cancelled')
  ),
  CONSTRAINT quote_transition_history_command_ck CHECK (
    command_type IN (
      'sendQuote', 'reopenQuote', 'approveQuote', 'rejectQuote', 'expireQuote', 'cancelQuote'
    )
  ),
  CONSTRAINT quote_transition_history_idempotency_ck CHECK (btrim(idempotency_key) <> ''),
  UNIQUE (command_type, idempotency_key)
);

CREATE INDEX IF NOT EXISTS quote_transition_history_quote_idx
  ON quote_transition_history (quote_id, occurred_at, id);

CREATE TABLE IF NOT EXISTS quote_lifecycle_commands (
  command_type text NOT NULL,
  idempotency_key text NOT NULL,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  payload_hash char(64) NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (command_type, idempotency_key),
  CONSTRAINT quote_lifecycle_commands_type_ck CHECK (
    command_type IN (
      'sendQuote', 'reopenQuote', 'approveQuote', 'rejectQuote', 'expireQuote', 'cancelQuote'
    )
  ),
  CONSTRAINT quote_lifecycle_commands_key_ck CHECK (btrim(idempotency_key) <> ''),
  CONSTRAINT quote_lifecycle_commands_hash_ck CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quote_lifecycle_commands_result_ck CHECK (jsonb_typeof(result) = 'object')
);

CREATE INDEX IF NOT EXISTS quote_lifecycle_commands_quote_idx
  ON quote_lifecycle_commands (quote_id, created_at);

CREATE OR REPLACE FUNCTION prevent_quote_lifecycle_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote lifecycle history is append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS quote_transition_history_prevent_mutation_trg
  ON quote_transition_history;
CREATE TRIGGER quote_transition_history_prevent_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON quote_transition_history
FOR EACH STATEMENT EXECUTE FUNCTION prevent_quote_lifecycle_history_mutation();
