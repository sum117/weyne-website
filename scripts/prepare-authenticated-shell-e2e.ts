import { createAuth } from '../src/lib/auth/auth.server'
import { parseAuthConfig } from '../src/lib/auth/config.server'
import { provisionCredentialUser } from '../src/lib/auth/provisioning.server'
import { closeDatabase, getDatabase } from '../src/lib/db/database.server'
import { migrateDatabase } from '../src/lib/db/migrate.server'
import type { Sql } from 'postgres'
import {
  AUDIT_E2E_EVENT,
  AUDIT_E2E_SCHEMA,
  AUTHENTICATED_SHELL_USERS,
} from '../tests/e2e/authenticated-shell.fixture'

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required for authenticated-shell e2e preparation')
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

/**
 * The audit endpoint intentionally reads a separately configured projection
 * schema. Build the smallest faithful projection in the disposable E2E
 * database, rather than coupling browser coverage to canonical write tables.
 */
async function seedAuditActivity(admin: { id: string; name: string }): Promise<void> {
  const schema = quoteIdentifier(AUDIT_E2E_SCHEMA)
  const database = await getDatabase()
  const sql = (database as unknown as { $client: Sql }).$client

  await sql.unsafe(`CREATE SCHEMA IF NOT EXISTS ${schema}`)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.users (
      id text PRIMARY KEY,
      name text NOT NULL
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.quotes (
      id uuid PRIMARY KEY,
      quote_number text NOT NULL
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.quote_audit (
      id uuid PRIMARY KEY,
      quote_id uuid NOT NULL REFERENCES ${schema}.quotes(id),
      actor_id text NOT NULL,
      operation text NOT NULL CHECK (operation IN ('create', 'update', 'transition', 'duplicate')),
      command_id text NOT NULL UNIQUE,
      before_state jsonb,
      after_state jsonb NOT NULL,
      occurred_at timestamptz NOT NULL
    )
  `)
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS ${schema}.commercial_resource_scopes (
      resource_type text NOT NULL,
      resource_id uuid NOT NULL,
      tenant_id uuid NOT NULL,
      owner_user_id text NOT NULL,
      resource_status text NOT NULL,
      PRIMARY KEY (resource_type, resource_id)
    )
  `)

  await sql.unsafe(
    `INSERT INTO ${schema}.users (id, name) VALUES ($1, $2)`,
    [admin.id, admin.name],
  )
  await sql.unsafe(
    `INSERT INTO ${schema}.quotes (id, quote_number) VALUES ($1::uuid, $2)`,
    [AUDIT_E2E_EVENT.quoteId, AUDIT_E2E_EVENT.quoteNumber],
  )
  await sql.unsafe(
    `INSERT INTO ${schema}.commercial_resource_scopes
      (resource_type, resource_id, tenant_id, owner_user_id, resource_status)
      VALUES ('quote', $1::uuid, '10000000-0000-4000-8000-000000000901'::uuid, $2, 'draft')`,
    [AUDIT_E2E_EVENT.quoteId, admin.id],
  )
  await sql.unsafe(
    `INSERT INTO ${schema}.quote_audit
      (id, quote_id, actor_id, operation, command_id, before_state, after_state, occurred_at)
      VALUES ($1::uuid, $2::uuid, $3, 'update', $4, $5::jsonb, $6::jsonb, $7::timestamptz)`,
    [
      AUDIT_E2E_EVENT.id,
      AUDIT_E2E_EVENT.quoteId,
      admin.id,
      AUDIT_E2E_EVENT.correlationId,
      JSON.stringify(AUDIT_E2E_EVENT.before),
      JSON.stringify(AUDIT_E2E_EVENT.after),
      AUDIT_E2E_EVENT.occurredAt,
    ],
  )
}

try {
  await migrateDatabase()
  const auth = createAuth(await getDatabase(), parseAuthConfig(process.env))

  for (const user of Object.values(AUTHENTICATED_SHELL_USERS)) {
    const provisioned = await provisionCredentialUser(auth, user)
    if (provisioned.role === 'admin') {
      await seedAuditActivity({ id: provisioned.id, name: user.name })
    }
  }
} finally {
  await closeDatabase()
}
