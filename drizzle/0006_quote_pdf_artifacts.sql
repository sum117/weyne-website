-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS quote_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL,
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  captured_by text NOT NULL CHECK (btrim(captured_by) <> ''),
  CONSTRAINT quote_snapshots_quote_version_uidx UNIQUE (quote_id, version),
  CONSTRAINT quote_snapshots_artifact_reference_uidx UNIQUE (quote_id, id, version)
);

CREATE TABLE IF NOT EXISTS quote_pdf_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id uuid NOT NULL,
  snapshot_id uuid NOT NULL,
  snapshot_version integer NOT NULL,
  template_id uuid NOT NULL,
  template_version integer NOT NULL,
  template_variant text NOT NULL CHECK (template_variant IN ('summary', 'commercial')),
  source_checksum char(64) NOT NULL CHECK (source_checksum ~ '^[0-9a-f]{64}$'),
  status text NOT NULL CHECK (status IN ('generating', 'completed', 'failed')),
  object_key text,
  mime_type text,
  size_bytes bigint,
  output_checksum char(64),
  page_count integer,
  attempt_count integer NOT NULL DEFAULT 1 CHECK (attempt_count > 0),
  generation_started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  failed_at timestamptz,
  error_code text,
  error_message text,
  error_details jsonb,
  CONSTRAINT quote_pdf_artifacts_snapshot_fk
    FOREIGN KEY (quote_id, snapshot_id, snapshot_version)
    REFERENCES quote_snapshots (quote_id, id, version)
    ON DELETE RESTRICT,
  CONSTRAINT quote_pdf_artifacts_source_uidx
    UNIQUE (
      quote_id,
      snapshot_id,
      snapshot_version,
      template_id,
      template_version,
      source_checksum
    ),
  CONSTRAINT quote_pdf_artifacts_versions_ck
    CHECK (snapshot_version > 0 AND template_version > 0),
  CONSTRAINT quote_pdf_artifacts_output_checksum_ck
    CHECK (output_checksum IS NULL OR output_checksum ~ '^[0-9a-f]{64}$'),
  CONSTRAINT quote_pdf_artifacts_terminal_metadata_ck CHECK (
    (
      status = 'generating'
      AND object_key IS NULL
      AND mime_type IS NULL
      AND size_bytes IS NULL
      AND output_checksum IS NULL
      AND page_count IS NULL
      AND completed_at IS NULL
      AND failed_at IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
    ) OR (
      status = 'completed'
      AND btrim(object_key) <> ''
      AND mime_type = 'application/pdf'
      AND size_bytes > 0
      AND output_checksum IS NOT NULL
      AND page_count > 0
      AND completed_at IS NOT NULL
      AND failed_at IS NULL
      AND error_code IS NULL
      AND error_message IS NULL
      AND error_details IS NULL
    ) OR (
      status = 'failed'
      AND object_key IS NULL
      AND mime_type IS NULL
      AND size_bytes IS NULL
      AND output_checksum IS NULL
      AND page_count IS NULL
      AND completed_at IS NULL
      AND failed_at IS NOT NULL
      AND btrim(error_code) <> ''
      AND btrim(error_message) <> ''
    )
  )
);

CREATE INDEX IF NOT EXISTS quote_pdf_artifacts_quote_history_idx
  ON quote_pdf_artifacts (quote_id, snapshot_version DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS quote_pdf_artifacts_status_idx
  ON quote_pdf_artifacts (status, generation_started_at);

CREATE OR REPLACE FUNCTION protect_quote_snapshot_append_only()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote snapshots are append-only' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS quote_snapshots_append_only_trg ON quote_snapshots;
CREATE TRIGGER quote_snapshots_append_only_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON quote_snapshots
FOR EACH STATEMENT EXECUTE FUNCTION protect_quote_snapshot_append_only();

CREATE OR REPLACE FUNCTION protect_quote_pdf_artifact_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.quote_id IS DISTINCT FROM NEW.quote_id
    OR OLD.snapshot_id IS DISTINCT FROM NEW.snapshot_id
    OR OLD.snapshot_version IS DISTINCT FROM NEW.snapshot_version
    OR OLD.template_id IS DISTINCT FROM NEW.template_id
    OR OLD.template_version IS DISTINCT FROM NEW.template_version
    OR OLD.template_variant IS DISTINCT FROM NEW.template_variant
    OR OLD.source_checksum IS DISTINCT FROM NEW.source_checksum
    OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'quote PDF artifact identity is immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'completed quote PDF artifacts are immutable' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'generating' AND NEW.status = 'generating' THEN
    IF NEW.attempt_count <> OLD.attempt_count + 1
      OR NEW.generation_started_at <= OLD.generation_started_at THEN
      RAISE EXCEPTION 'stale quote PDF reclaim must advance attempt and start time'
        USING ERRCODE = '55000';
    END IF;
  ELSIF OLD.status = 'generating' AND NEW.status NOT IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'invalid quote PDF artifact status transition' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'failed' AND NEW.status <> 'generating' THEN
    RAISE EXCEPTION 'failed quote PDF artifact may only be reclaimed' USING ERRCODE = '55000';
  END IF;

  IF OLD.status = 'failed' AND NEW.attempt_count <> OLD.attempt_count + 1 THEN
    RAISE EXCEPTION 'quote PDF artifact retry must increment attempt count once' USING ERRCODE = '55000';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quote_pdf_artifacts_immutable_completed_trg ON quote_pdf_artifacts;
CREATE TRIGGER quote_pdf_artifacts_immutable_completed_trg
BEFORE UPDATE ON quote_pdf_artifacts
FOR EACH ROW EXECUTE FUNCTION protect_quote_pdf_artifact_history();

CREATE OR REPLACE FUNCTION prevent_quote_pdf_artifact_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'quote PDF artifact history cannot be deleted' USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS quote_pdf_artifacts_append_only_trg ON quote_pdf_artifacts;
CREATE TRIGGER quote_pdf_artifacts_append_only_trg
BEFORE DELETE OR TRUNCATE ON quote_pdf_artifacts
FOR EACH STATEMENT EXECUTE FUNCTION prevent_quote_pdf_artifact_delete();

-- Atomic claim/reclaim boundary. Callers render only when claimed=true.
-- INSERT ... ON CONFLICT prevents concurrent duplicate source identities; the
-- conditional UPDATE reclaims only a prior failed attempt. Completed and
-- currently-generating rows are returned unchanged with claimed=false.
CREATE OR REPLACE FUNCTION claim_quote_pdf_artifact(
  p_quote_id uuid,
  p_snapshot_id uuid,
  p_snapshot_version integer,
  p_template_id uuid,
  p_template_version integer,
  p_template_variant text,
  p_snapshot_source_checksum char(64),
  p_stale_before timestamptz,
  p_source_checksum char(64)
)
RETURNS TABLE (artifact quote_pdf_artifacts, claimed boolean)
LANGUAGE plpgsql
AS $$
DECLARE
  claimed_artifact quote_pdf_artifacts;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM quote_snapshots
    WHERE quote_id = p_quote_id
      AND id = p_snapshot_id
      AND version = p_snapshot_version
      AND source_checksum = p_snapshot_source_checksum
  ) THEN
    RAISE EXCEPTION 'immutable quote snapshot identity or checksum mismatch'
      USING ERRCODE = '23503';
  END IF;

  INSERT INTO quote_pdf_artifacts (
    quote_id,
    snapshot_id,
    snapshot_version,
    template_id,
    template_version,
    template_variant,
    source_checksum,
    status
  ) VALUES (
    p_quote_id,
    p_snapshot_id,
    p_snapshot_version,
    p_template_id,
    p_template_version,
    p_template_variant,
    p_source_checksum,
    'generating'
  )
  ON CONFLICT (
    quote_id,
    snapshot_id,
    snapshot_version,
    template_id,
    template_version,
    source_checksum
  ) DO NOTHING
  RETURNING * INTO claimed_artifact;

  IF FOUND THEN
    RETURN QUERY SELECT claimed_artifact, true;
    RETURN;
  END IF;

  UPDATE quote_pdf_artifacts
  SET
    status = 'generating',
    attempt_count = attempt_count + 1,
    generation_started_at = clock_timestamp(),
    failed_at = NULL,
    error_code = NULL,
    error_message = NULL,
    error_details = NULL
  WHERE quote_id = p_quote_id
    AND snapshot_id = p_snapshot_id
    AND snapshot_version = p_snapshot_version
    AND template_id = p_template_id
    AND template_version = p_template_version
    AND source_checksum = p_source_checksum
    AND status = 'failed'
  RETURNING * INTO claimed_artifact;

  IF FOUND THEN
    RETURN QUERY SELECT claimed_artifact, true;
    RETURN;
  END IF;

  UPDATE quote_pdf_artifacts
  SET attempt_count = attempt_count + 1,
      generation_started_at = clock_timestamp()
  WHERE quote_id = p_quote_id
    AND snapshot_id = p_snapshot_id
    AND snapshot_version = p_snapshot_version
    AND template_id = p_template_id
    AND template_version = p_template_version
    AND source_checksum = p_source_checksum
    AND status = 'generating'
    AND generation_started_at < p_stale_before
  RETURNING * INTO claimed_artifact;

  IF FOUND THEN
    RETURN QUERY SELECT claimed_artifact, true;
    RETURN;
  END IF;

  SELECT * INTO claimed_artifact
  FROM quote_pdf_artifacts
  WHERE quote_id = p_quote_id
    AND snapshot_id = p_snapshot_id
    AND snapshot_version = p_snapshot_version
    AND template_id = p_template_id
    AND template_version = p_template_version
    AND source_checksum = p_source_checksum;

  RETURN QUERY SELECT claimed_artifact, false;
END;
$$;

CREATE OR REPLACE FUNCTION complete_quote_pdf_artifact(
  p_artifact_id uuid,
  p_attempt_count integer,
  p_object_key text,
  p_size_bytes bigint,
  p_output_checksum char(64),
  p_page_count integer
)
RETURNS quote_pdf_artifacts
LANGUAGE plpgsql
AS $$
DECLARE
  completed_artifact quote_pdf_artifacts;
BEGIN
  UPDATE quote_pdf_artifacts
  SET status = 'completed', object_key = p_object_key,
      mime_type = 'application/pdf', size_bytes = p_size_bytes,
      output_checksum = p_output_checksum, page_count = p_page_count,
      completed_at = clock_timestamp()
  WHERE id = p_artifact_id
    AND status = 'generating'
    AND attempt_count = p_attempt_count
  RETURNING * INTO completed_artifact;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale quote PDF generation claim' USING ERRCODE = '40001';
  END IF;
  RETURN completed_artifact;
END;
$$;

CREATE OR REPLACE FUNCTION fail_quote_pdf_artifact(
  p_artifact_id uuid,
  p_attempt_count integer,
  p_error_code text,
  p_error_message text,
  p_error_details jsonb DEFAULT NULL
)
RETURNS quote_pdf_artifacts
LANGUAGE plpgsql
AS $$
DECLARE
  failed_artifact quote_pdf_artifacts;
BEGIN
  UPDATE quote_pdf_artifacts
  SET status = 'failed', failed_at = clock_timestamp(),
      error_code = p_error_code, error_message = p_error_message,
      error_details = p_error_details
  WHERE id = p_artifact_id
    AND status = 'generating'
    AND attempt_count = p_attempt_count
  RETURNING * INTO failed_artifact;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale quote PDF generation claim' USING ERRCODE = '40001';
  END IF;
  RETURN failed_artifact;
END;
$$;
