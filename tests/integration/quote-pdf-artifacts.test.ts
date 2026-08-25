import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import postgres, { type Sql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) throw new Error('TEST_DATABASE_URL is required')

const schemaName = `quote_pdf_${randomUUID().replaceAll('-', '')}`
const migrationUrl = new URL(
  '../../drizzle/0006_quote_pdf_artifacts.sql',
  import.meta.url,
)
let sql: Sql

const quoteId = randomUUID()
const snapshotId = randomUUID()
const templateId = randomUUID()
const sourceChecksum = 'a'.repeat(64)

beforeAll(async () => {
  sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  await sql.unsafe(`CREATE SCHEMA ${schemaName}`)
  await sql.unsafe(`SET search_path TO ${schemaName}, public`)
  const migration = await readFile(migrationUrl, 'utf8')
  await sql.unsafe(migration)
  await sql.unsafe(migration)
  await sql`
    INSERT INTO quote_snapshots (
      id, quote_id, version, payload, source_checksum, captured_by
    ) VALUES (
      ${snapshotId}, ${quoteId}, 1,
      ${JSON.stringify({ quoteNumber: 'ORC-2026-000001' })}::text::jsonb,
      ${'b'.repeat(64)}, 'integration-test'
    )
  `
})

afterAll(async () => {
  if (!sql) return
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
  await sql.end()
})

async function claim() {
  return sql<{ id: string; status: string; attemptCount: number; claimed: boolean }[]>`
    SELECT
      (artifact).id::text AS id,
      (artifact).status AS status,
      (artifact).attempt_count AS "attemptCount",
      claimed
    FROM claim_quote_pdf_artifact(
      ${quoteId}, ${snapshotId}, 1, ${templateId}, 1,
      'commercial', ${'b'.repeat(64)}, '1970-01-01T00:00:00Z',
      ${sourceChecksum}
    )
  `
}

describe('quote PDF artifact migration', () => {
  it('atomically returns one claimed artifact for one source identity', async () => {
    const first = await claim()
    const second = await claim()

    expect(first[0]).toMatchObject({ status: 'generating', attemptCount: 1, claimed: true })
    expect(second[0]).toMatchObject({ id: first[0]?.id, status: 'generating', claimed: false })
    const count = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM quote_pdf_artifacts
    `
    expect(count[0]?.count).toBe(1)

    const reclaimed = await sql<{ attemptCount: number; claimed: boolean }[]>`
      SELECT (artifact).attempt_count AS "attemptCount", claimed
      FROM claim_quote_pdf_artifact(
        ${quoteId}, ${snapshotId}, 1, ${templateId}, 1,
        'commercial', ${'b'.repeat(64)}, '2999-01-01T00:00:00Z',
        ${sourceChecksum}
      )
    `
    expect(reclaimed[0]).toEqual({ attemptCount: 2, claimed: true })
  })

  it('reclaims failed generation and permanently freezes completed metadata', async () => {
    const id = (await claim())[0]!.id
    await sql`
      SELECT fail_quote_pdf_artifact(
        ${id}, 2, 'render_failed', 'temporary renderer error', NULL
      )
    `

    const retried = await claim()
    expect(retried[0]).toMatchObject({ id, status: 'generating', attemptCount: 3, claimed: true })

    await expect(
      sql`
        SELECT fail_quote_pdf_artifact(
          ${id}, 2, 'render_failed', 'stale worker', NULL
        )
      `,
    ).rejects.toThrow(/stale quote PDF generation claim/i)

    await sql`
      SELECT complete_quote_pdf_artifact(
        ${id}, 3, 'quote-pdfs/artifact/source.pdf', 42,
        ${'c'.repeat(64)}, 1
      )
    `

    await expect(
      sql`UPDATE quote_pdf_artifacts SET object_key = 'changed.pdf' WHERE id = ${id}`,
    ).rejects.toThrow(/completed quote PDF artifacts are immutable/i)
  })

  it('prevents snapshot mutation and deletion', async () => {
    await expect(
      sql`UPDATE quote_snapshots SET payload = '{}'::jsonb WHERE id = ${snapshotId}`,
    ).rejects.toThrow(/append-only/i)
    await expect(
      sql`DELETE FROM quote_snapshots WHERE id = ${snapshotId}`,
    ).rejects.toThrow(/append-only/i)
  })
})
