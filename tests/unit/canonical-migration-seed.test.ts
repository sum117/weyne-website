import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CANONICAL_PRICE_LISTS } from '@/lib/db/seed.server'

const root = resolve(import.meta.dirname, '../..')

async function projectFile(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

describe('canonical migration and seed contract', () => {
  it('targets the canonical schema and canonical migration directory', async () => {
    const config = await projectFile('drizzle.config.ts')
    const migrator = await projectFile('src/lib/db/migrate.server.ts')
    const journal = JSON.parse(
      await projectFile('drizzle/canonical/meta/_journal.json'),
    ) as { entries: { idx: number; when: number; tag: string }[] }

    expect(config).toContain("schema: './src/lib/db/schema/canonical.ts'")
    expect(config).toContain("out: './drizzle/canonical'")
    expect(migrator).toContain("migrationsFolder = 'drizzle/canonical'")
    expect(journal.entries).toEqual([
      { idx: 0, version: '7', when: 0, tag: '0000_canonical_schema', breakpoints: true },
      { idx: 1, version: '7', when: 1, tag: '0001_canonical_invariants', breakpoints: true },
      { idx: 2, version: '7', when: 2, tag: '0002_document_logo_assets', breakpoints: true },
    ])
  })

  it('defines exactly four deterministic price lists with stable identities', () => {
    expect(CANONICAL_PRICE_LISTS).toEqual([
      {
        id: '00000000-0000-4000-8000-000000000001',
        key: 'PRICE_1',
        displayName: 'Preço 1',
        position: 1,
      },
      {
        id: '00000000-0000-4000-8000-000000000002',
        key: 'PRICE_2',
        displayName: 'Preço 2',
        position: 2,
      },
      {
        id: '00000000-0000-4000-8000-000000000003',
        key: 'PRICE_3',
        displayName: 'Preço 3',
        position: 3,
      },
      {
        id: '00000000-0000-4000-8000-000000000004',
        key: 'PRICE_4',
        displayName: 'Preço 4',
        position: 4,
      },
    ])
  })

  it('adds migration-owned invariants that Drizzle cannot declare', async () => {
    const invariants = await projectFile('drizzle/canonical/0001_canonical_invariants.sql')

    expect(invariants).toContain('CREATE EXTENSION IF NOT EXISTS btree_gist')
    expect(invariants).toContain('product_prices_no_overlapping_validity')
    expect(invariants).toContain('commission_rules_no_overlapping_industry_validity')
    expect(invariants).toContain('commission_rules_no_overlapping_product_validity')
    expect(invariants).toContain('DEFERRABLE INITIALLY DEFERRED')
    expect(invariants).toContain('quote_order_conversion_pair_ck')
    expect(invariants).toContain('append-only')
    expect(invariants).toContain('price_lists_protect_canonical_set')
  })
})
