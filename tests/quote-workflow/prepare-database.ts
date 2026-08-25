/**
 * Applies the workflow migrations to the disposable PostgreSQL instance and
 * verifies connectivity. Run before the API server when the database is not
 * already migrated:
 *
 *   bun tests/quote-workflow/prepare-database.ts
 */
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres from 'postgres'

const SCHEMA = 'quote_workflow_e2e'
const MIGRATIONS = [
  '0000_migration_smoke.sql',
  '0001_catalog_pricing.sql',
  '0002_quote_persistence.sql',
  '0003_server_quote_pricing.sql',
  '0004_order_persistence.sql',
  '0004_quote_lifecycle.sql',
  '0005_quote_to_order_conversion.sql',
  '0006_quote_pdf_artifacts.sql',
  '0090_order_security.sql',
] as const

const url = process.env.WORKFLOW_DATABASE_URL?.trim()
if (!url) throw new Error('WORKFLOW_DATABASE_URL is required')

const sql = postgres(url, { max: 1, onnotice: () => undefined })

try {
  // Make the workflow schema the default for every future connection so the
  // application services resolve their tables without per-connection setup.
  await sql.unsafe(
    `ALTER DATABASE ${url.split('/').pop()!.split('?')[0]} SET search_path TO "${SCHEMA}", public`,
  )
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`)
  await sql.unsafe(`CREATE SCHEMA "${SCHEMA}"`)
  await sql.unsafe(`SET search_path TO "${SCHEMA}", public`)
  for (const name of MIGRATIONS) {
    const script = await readFile(resolve(process.cwd(), 'drizzle', name), 'utf8')
    await sql.unsafe(script)
  }
  console.log(JSON.stringify({ event: 'workflow_database_ready', schema: SCHEMA }))
} finally {
  await sql.end({ timeout: 5 })
}
