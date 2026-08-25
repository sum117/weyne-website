-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS quote_conversion_commands (
  command_id text PRIMARY KEY,
  payload_hash char(64) NOT NULL,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE RESTRICT,
  order_id uuid REFERENCES orders(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  CONSTRAINT quote_conversion_commands_command_ck CHECK (btrim(command_id) <> ''),
  CONSTRAINT quote_conversion_commands_hash_ck CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quote_conversion_commands_completion_ck CHECK (
    (order_id IS NULL AND completed_at IS NULL)
    OR (order_id IS NOT NULL AND completed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS quote_conversion_commands_quote_idx
  ON quote_conversion_commands (quote_id, created_at, command_id);
