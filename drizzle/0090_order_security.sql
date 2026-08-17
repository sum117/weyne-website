-- weyne:migration compatibility=expand previous-app-compatible=true
CREATE TABLE IF NOT EXISTS commercial_resource_scopes (
  resource_type text NOT NULL CHECK (resource_type IN ('quote', 'order')),
  resource_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  owner_user_id text NOT NULL CHECK (btrim(owner_user_id) <> ''),
  resource_status text NOT NULL CHECK (btrim(resource_status) <> ''),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (resource_type, resource_id)
);

CREATE INDEX IF NOT EXISTS commercial_resource_scopes_tenant_owner_idx
  ON commercial_resource_scopes (tenant_id, owner_user_id, resource_type, resource_id);

CREATE TABLE IF NOT EXISTS commercial_resource_assignments (
  resource_type text NOT NULL,
  resource_id uuid NOT NULL,
  user_id text NOT NULL CHECK (btrim(user_id) <> ''),
  assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (resource_type, resource_id, user_id),
  FOREIGN KEY (resource_type, resource_id)
    REFERENCES commercial_resource_scopes(resource_type, resource_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS commercial_resource_assignments_user_idx
  ON commercial_resource_assignments (user_id, resource_type, resource_id);

CREATE TABLE IF NOT EXISTS secure_order_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  object_key text NOT NULL UNIQUE,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL CHECK (size_bytes > 0),
  checksum_sha256 text NOT NULL CHECK (checksum_sha256 ~ '^[A-Za-z0-9+/]{43}=$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by text NOT NULL CHECK (btrim(created_by) <> ''),
  deleted_at timestamptz,
  deleted_by text,
  CONSTRAINT secure_order_attachments_filename_ck CHECK (
    btrim(original_filename) <> '' AND char_length(original_filename) <= 255
  ),
  CONSTRAINT secure_order_attachments_object_key_ck CHECK (
    object_key ~ '^order-attachments/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  ),
  CONSTRAINT secure_order_attachments_delete_actor_ck CHECK (
    (deleted_at IS NULL AND deleted_by IS NULL)
    OR (deleted_at IS NOT NULL AND btrim(deleted_by) <> '')
  )
);

CREATE INDEX IF NOT EXISTS secure_order_attachments_order_active_idx
  ON secure_order_attachments (tenant_id, order_id, created_at, id)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS commercial_security_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  actor_id text NOT NULL CHECK (btrim(actor_id) <> ''),
  actor_role text NOT NULL CHECK (actor_role IN ('admin', 'representative', 'read_only')),
  target_type text NOT NULL CHECK (target_type IN ('quote', 'order', 'order_attachment')),
  target_id uuid NOT NULL,
  action text NOT NULL CHECK (btrim(action) <> ''),
  outcome text NOT NULL CHECK (outcome IN ('allowed', 'forbidden', 'not_found')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS commercial_security_audit_target_idx
  ON commercial_security_audit (tenant_id, target_type, target_id, occurred_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS commercial_security_audit_actor_idx
  ON commercial_security_audit (tenant_id, actor_id, occurred_at DESC, id DESC);

CREATE OR REPLACE FUNCTION prevent_commercial_security_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'commercial security audit is append-only'
    USING ERRCODE = '55000';
END;
$$;

DROP TRIGGER IF EXISTS commercial_security_audit_append_only_trg ON commercial_security_audit;
CREATE TRIGGER commercial_security_audit_append_only_trg
BEFORE UPDATE OR DELETE OR TRUNCATE ON commercial_security_audit
FOR EACH STATEMENT EXECUTE FUNCTION prevent_commercial_security_audit_mutation();
