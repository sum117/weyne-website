import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { quotePdfArtifacts, quoteSnapshots } from '@/lib/db/schema'

describe('quote PDF persistence schema', () => {
  it('exports immutable snapshot and artifact tables', () => {
    expect(quoteSnapshots).toBeDefined()
    expect(quotePdfArtifacts).toBeDefined()
  })

  it('enforces artifact source identity, terminal metadata, and append-only bytes in SQL', () => {
    const migration = readFileSync(
      new URL('../../drizzle/0006_quote_pdf_artifacts.sql', import.meta.url),
      'utf8',
    )

    expect(migration).toMatch(
      /UNIQUE\s*\(\s*quote_id,\s*snapshot_id,\s*snapshot_version,\s*template_id,\s*template_version,\s*source_checksum\s*\)/i,
    )
    expect(migration).toContain("status IN ('generating', 'completed', 'failed')")
    expect(migration).toContain('quote_pdf_artifacts_terminal_metadata_ck')
    expect(migration).toContain('quote_pdf_artifacts_immutable_completed_trg')
    expect(migration).toContain('quote_snapshots_append_only_trg')
    expect(migration).toContain('ON CONFLICT')
    expect(migration).toContain("status = 'failed'")
  })
})
