-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS product_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (category IN ('PHOTO', 'TECHNICAL_SHEET', 'FISPQ')),
  object_key text NOT NULL,
  original_filename text NOT NULL,
  display_label text,
  document_version text,
  effective_date date,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 text NOT NULL,
  upload_status text NOT NULL DEFAULT 'PENDING',
  photo_position integer,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_by text NOT NULL,
  deleted_at timestamptz,
  deleted_by text,
  CONSTRAINT product_attachments_object_key_uidx UNIQUE (object_key),
  CONSTRAINT product_attachments_object_key_ck CHECK (
    object_key ~ '^attachments/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT product_attachments_original_filename_ck CHECK (
    btrim(original_filename) <> '' AND char_length(original_filename) <= 255
  ),
  CONSTRAINT product_attachments_document_text_ck CHECK (
    (display_label IS NULL OR (btrim(display_label) <> '' AND char_length(display_label) <= 200))
    AND (document_version IS NULL OR (btrim(document_version) <> '' AND char_length(document_version) <= 100))
  ),
  CONSTRAINT product_attachments_upload_status_ck CHECK (
    upload_status IN ('PENDING', 'UPLOADED', 'PROCESSING', 'AVAILABLE', 'FAILED', 'DELETING')
  ),
  CONSTRAINT product_attachments_checksum_ck CHECK (
    checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'
  ),
  CONSTRAINT product_attachments_policy_ck CHECK (
    (category = 'PHOTO'
      AND mime_type IN ('image/jpeg', 'image/png', 'image/webp')
      AND size_bytes BETWEEN 1 AND 10485760)
    OR (category IN ('TECHNICAL_SHEET', 'FISPQ')
      AND mime_type = 'application/pdf'
      AND size_bytes BETWEEN 1 AND 26214400)
  ),
  CONSTRAINT product_attachments_metadata_ck CHECK (
    (category = 'PHOTO'
      AND display_label IS NULL
      AND document_version IS NULL
      AND effective_date IS NULL
      AND photo_position IS NOT NULL
      AND photo_position >= 0)
    OR (category IN ('TECHNICAL_SHEET', 'FISPQ')
      AND display_label IS NOT NULL
      AND btrim(display_label) <> ''
      AND photo_position IS NULL
      AND NOT is_primary)
  ),
  CONSTRAINT product_attachments_audit_actor_ck CHECK (
    btrim(created_by) <> '' AND btrim(updated_by) <> ''
  ),
  CONSTRAINT product_attachments_delete_actor_ck CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND btrim(deleted_by) <> '')
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS product_attachments_photo_position_uidx
  ON product_attachments (product_id, photo_position)
  WHERE category = 'PHOTO' AND deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS product_attachments_primary_photo_uidx
  ON product_attachments (product_id)
  WHERE category = 'PHOTO' AND is_primary AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS product_attachments_product_category_idx
  ON product_attachments (product_id, category, created_at, id);
CREATE INDEX IF NOT EXISTS product_attachments_status_idx
  ON product_attachments (upload_status, updated_at, id);

CREATE TABLE IF NOT EXISTS product_photo_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attachment_id uuid NOT NULL REFERENCES product_attachments(id) ON DELETE RESTRICT,
  variant_key text NOT NULL CHECK (variant_key IN ('THUMBNAIL', 'DISPLAY')),
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/webp'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  width integer NOT NULL CHECK (width > 0),
  height integer NOT NULL CHECK (height > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT product_photo_variants_attachment_key_uidx UNIQUE (attachment_id, variant_key),
  CONSTRAINT product_photo_variants_object_key_ck CHECK (
    object_key ~ '^attachments/([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/)?[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT product_photo_variants_dimensions_ck CHECK (
    (variant_key = 'THUMBNAIL' AND width <= 320 AND height <= 320)
    OR (variant_key = 'DISPLAY' AND width <= 1600 AND height <= 1600)
  )
);

CREATE INDEX IF NOT EXISTS product_photo_variants_attachment_idx
  ON product_photo_variants (attachment_id, variant_key);

CREATE OR REPLACE FUNCTION prepare_product_attachment_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.original_filename := btrim(NEW.original_filename);
  NEW.display_label := NULLIF(btrim(NEW.display_label), '');
  NEW.document_version := NULLIF(btrim(NEW.document_version), '');
  NEW.created_by := btrim(NEW.created_by);
  NEW.updated_by := btrim(NEW.updated_by);
  NEW.deleted_by := NULLIF(btrim(NEW.deleted_by), '');
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_attachments_prepare_write_trg ON product_attachments;
CREATE TRIGGER product_attachments_prepare_write_trg
BEFORE INSERT OR UPDATE ON product_attachments
FOR EACH ROW EXECUTE FUNCTION prepare_product_attachment_write();

CREATE OR REPLACE FUNCTION assert_product_photo_invariants(target_product_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  photo_count integer;
  primary_count integer;
  minimum_position integer;
  maximum_position integer;
BEGIN
  SELECT
    count(*)::integer,
    count(*) FILTER (WHERE is_primary)::integer,
    min(photo_position),
    max(photo_position)
  INTO photo_count, primary_count, minimum_position, maximum_position
  FROM product_attachments
  WHERE product_id = target_product_id
    AND category = 'PHOTO'
    AND deleted_at IS NULL;

  IF photo_count > 0 AND primary_count <> 1 THEN
    RAISE EXCEPTION 'a product with photos must have exactly one primary photo'
      USING ERRCODE = '23514';
  END IF;

  IF photo_count > 0
    AND (minimum_position <> 0 OR maximum_position <> photo_count - 1) THEN
    RAISE EXCEPTION 'product photo positions must be contiguous from zero'
      USING ERRCODE = '23514';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION enforce_product_photo_invariants()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP <> 'DELETE' THEN
    PERFORM assert_product_photo_invariants(NEW.product_id);
  END IF;
  IF TG_OP <> 'INSERT' AND (TG_OP = 'DELETE' OR OLD.product_id IS DISTINCT FROM NEW.product_id) THEN
    PERFORM assert_product_photo_invariants(OLD.product_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS product_attachments_photo_invariants_trg ON product_attachments;
CREATE CONSTRAINT TRIGGER product_attachments_photo_invariants_trg
AFTER INSERT OR UPDATE OR DELETE ON product_attachments
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION enforce_product_photo_invariants();

CREATE OR REPLACE FUNCTION require_photo_variant_parent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  parent_category text;
BEGIN
  SELECT category INTO parent_category
  FROM product_attachments
  WHERE id = NEW.attachment_id AND deleted_at IS NULL;

  IF parent_category IS DISTINCT FROM 'PHOTO' THEN
    RAISE EXCEPTION 'photo variants require an active photo attachment parent'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS product_photo_variants_require_parent_trg ON product_photo_variants;
CREATE TRIGGER product_photo_variants_require_parent_trg
BEFORE INSERT OR UPDATE ON product_photo_variants
FOR EACH ROW EXECUTE FUNCTION require_photo_variant_parent();
