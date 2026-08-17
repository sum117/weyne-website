-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS reference_records (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  budget numeric(19, 6) NOT NULL,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL,
  archived_at timestamptz,
  archived_by text,
  CONSTRAINT reference_records_name_ck CHECK (btrim(name) <> ''),
  CONSTRAINT reference_records_budget_ck CHECK (budget >= 0),
  CONSTRAINT reference_records_version_ck CHECK (version > 0),
  CONSTRAINT reference_records_archive_actor_ck CHECK (
    (archived_at IS NULL AND archived_by IS NULL)
    OR (archived_at IS NOT NULL AND btrim(archived_by) <> '')
  )
);

CREATE INDEX IF NOT EXISTS reference_records_active_name_idx
  ON reference_records (lower(name), id)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS reference_records_active_created_idx
  ON reference_records (created_at, id)
  WHERE archived_at IS NULL;

CREATE TABLE IF NOT EXISTS reference_record_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id uuid NOT NULL REFERENCES reference_records(id) ON DELETE RESTRICT,
  operation text NOT NULL,
  actor text NOT NULL,
  version bigint NOT NULL,
  occurred_at timestamptz NOT NULL,
  CONSTRAINT reference_record_events_operation_ck
    CHECK (operation IN ('created', 'updated', 'archived')),
  CONSTRAINT reference_record_events_actor_ck CHECK (btrim(actor) <> ''),
  CONSTRAINT reference_record_events_version_ck CHECK (version > 0),
  CONSTRAINT reference_record_events_record_version_uidx UNIQUE (record_id, version)
);

CREATE INDEX IF NOT EXISTS reference_record_events_record_idx
  ON reference_record_events (record_id, version);
