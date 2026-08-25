-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  label text NOT NULL,
  original_filename text NOT NULL,
  object_key text NOT NULL UNIQUE,
  size_bytes bigint NOT NULL,
  validated_mime_type text NOT NULL,
  checksum_sha256 text NOT NULL,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  deleted_by uuid,
  deleted_at timestamptz,
  state text NOT NULL DEFAULT 'pending',
  idempotency_key text NOT NULL,
  payload_hash text NOT NULL,
  delete_idempotency_key text,
  CONSTRAINT order_attachments_upload_idempotency_uidx
    UNIQUE (order_id, created_by, idempotency_key),
  CONSTRAINT order_attachments_state_ck CHECK (
    state IN ('pending', 'ready', 'deleting', 'deleted', 'failed')
  ),
  CONSTRAINT order_attachments_size_ck CHECK (size_bytes > 0),
  CONSTRAINT order_attachments_mime_ck CHECK (
    validated_mime_type IN ('application/pdf', 'image/png', 'image/jpeg')
  ),
  CONSTRAINT order_attachments_checksum_ck CHECK (
    checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  CONSTRAINT order_attachments_object_key_ck CHECK (
    object_key ~ '^attachments/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT order_attachments_text_ck CHECK (
    btrim(label) <> ''
    AND char_length(label) <= 120
    AND btrim(original_filename) <> ''
    AND char_length(original_filename) <= 255
    AND original_filename !~ '[/\\]'
    AND btrim(idempotency_key) <> ''
    AND char_length(idempotency_key) <= 128
    AND payload_hash ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT order_attachments_delete_metadata_ck CHECK (
    (state = 'deleted' AND deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND delete_idempotency_key IS NOT NULL)
    OR state <> 'deleted'
  )
);

CREATE INDEX IF NOT EXISTS order_attachments_active_order_idx
  ON order_attachments (order_id, created_at DESC, id DESC)
  WHERE state IN ('pending', 'ready', 'deleting');

CREATE TABLE IF NOT EXISTS order_attachment_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE RESTRICT,
  attachment_id uuid NOT NULL REFERENCES order_attachments(id) ON DELETE RESTRICT,
  event_type text NOT NULL,
  actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  label text NOT NULL,
  CONSTRAINT order_attachment_audit_event_ck CHECK (
    event_type IN ('order.attachment.uploaded', 'order.attachment.deleted')
  ),
  CONSTRAINT order_attachment_audit_label_ck CHECK (btrim(label) <> '')
);

CREATE INDEX IF NOT EXISTS order_attachment_audit_history_idx
  ON order_attachment_audit (order_id, occurred_at, id);

CREATE OR REPLACE FUNCTION protect_order_attachment_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.order_id IS DISTINCT FROM OLD.order_id
    OR NEW.label IS DISTINCT FROM OLD.label
    OR NEW.original_filename IS DISTINCT FROM OLD.original_filename
    OR NEW.object_key IS DISTINCT FROM OLD.object_key
    OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
    OR NEW.validated_mime_type IS DISTINCT FROM OLD.validated_mime_type
    OR NEW.checksum_sha256 IS DISTINCT FROM OLD.checksum_sha256
    OR NEW.created_by IS DISTINCT FROM OLD.created_by
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
    OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
    OR NEW.payload_hash IS DISTINCT FROM OLD.payload_hash THEN
    RAISE EXCEPTION 'order attachment identity and verified metadata are immutable'
      USING ERRCODE = '55000';
  END IF;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS order_attachments_protect_identity_trg ON order_attachments;
CREATE TRIGGER order_attachments_protect_identity_trg
BEFORE UPDATE ON order_attachments
FOR EACH ROW EXECUTE FUNCTION protect_order_attachment_identity();

CREATE OR REPLACE FUNCTION prevent_order_attachment_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'order attachment metadata and audit history cannot be deleted'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS order_attachments_prevent_delete_trg ON order_attachments;
CREATE TRIGGER order_attachments_prevent_delete_trg
BEFORE DELETE OR TRUNCATE ON order_attachments
FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_attachment_hard_delete();

DROP TRIGGER IF EXISTS order_attachment_audit_prevent_mutation_trg ON order_attachment_audit;
CREATE TRIGGER order_attachment_audit_prevent_mutation_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON order_attachment_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_order_attachment_hard_delete();
