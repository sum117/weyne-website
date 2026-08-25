-- weyne:migration compatibility=expand previous-app-compatible=true
-- Private document logo assets referenced by settings.value.documents.logoAssetId.
-- Objects live in private object storage; this table only carries lifecycle
-- metadata. Active assets are permanent (issued-document snapshots reference
-- them); only abandoned staged assets may be purged.

CREATE TYPE document_logo_status AS ENUM ('staged', 'active', 'purged');

CREATE TABLE IF NOT EXISTS document_logo_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status document_logo_status NOT NULL DEFAULT 'staged',
  object_key text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  checksum_sha256 char(64) NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_user_id uuid NOT NULL CONSTRAINT document_logo_assets_created_by_user_id_users_id_fk REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz,
  activated_by_user_id uuid CONSTRAINT document_logo_assets_activated_by_user_id_users_id_fk REFERENCES users(id) ON DELETE RESTRICT,
  purged_at timestamptz,
  purged_by_user_id uuid CONSTRAINT document_logo_assets_purged_by_user_id_users_id_fk REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT document_logo_assets_object_key_uidx UNIQUE (object_key),
  CONSTRAINT document_logo_assets_size_ck CHECK (
    size_bytes > 0 AND size_bytes <= 2097152
  ),
  CONSTRAINT document_logo_assets_mime_ck CHECK (
    mime_type IN ('image/png', 'image/jpeg', 'image/webp')
  ),
  CONSTRAINT document_logo_assets_checksum_ck CHECK (
    checksum_sha256 ~ '^[0-9a-f]{64}$'
  ),
  CONSTRAINT document_logo_assets_object_key_ck CHECK (
    object_key ~ '^document-logos/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT document_logo_assets_filename_ck CHECK (
    btrim(original_filename) <> '' AND char_length(original_filename) <= 255
  ),
  CONSTRAINT document_logo_assets_dimensions_ck CHECK (
    (width IS NULL AND height IS NULL)
      OR (width > 0 AND height > 0)
  ),
  CONSTRAINT document_logo_assets_lifecycle_ck CHECK (
    (status = 'staged' AND activated_at IS NULL AND activated_by_user_id IS NULL
       AND purged_at IS NULL AND purged_by_user_id IS NULL)
      OR (status = 'active' AND activated_at IS NOT NULL AND activated_by_user_id IS NOT NULL
       AND purged_at IS NULL AND purged_by_user_id IS NULL)
      OR (status = 'purged' AND purged_at IS NOT NULL AND purged_by_user_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS document_logo_assets_status_created_idx
  ON document_logo_assets (status, created_at, id);

-- The canonical settings payload may only reference an active logo asset.
-- Staged assets are invisible to settings until activation commits; purged or
-- otherwise missing ids are rejected outright.
CREATE FUNCTION enforce_settings_logo_asset_active()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  asset_status text;
BEGIN
  IF NEW.value -> 'documents' ->> 'logoAssetId' IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status::text INTO asset_status
  FROM document_logo_assets
  WHERE id = (NEW.value -> 'documents' ->> 'logoAssetId')::uuid;

  IF asset_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'settings documents.logoAssetId must reference an active document logo asset'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER settings_logo_asset_active_trg
  BEFORE INSERT OR UPDATE OF value ON settings
  FOR EACH ROW EXECUTE FUNCTION enforce_settings_logo_asset_active();

-- Active assets are permanent: issued-document snapshots carry their id.
CREATE FUNCTION prevent_active_document_logo_deletion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'active document logo assets are permanent and cannot be deleted'
    USING ERRCODE = '55000';
  RETURN NULL;
END;
$$;

CREATE TRIGGER document_logo_assets_prevent_active_delete_trg
  BEFORE DELETE OR TRUNCATE ON document_logo_assets
  FOR EACH STATEMENT
  EXECUTE FUNCTION prevent_active_document_logo_deletion();
