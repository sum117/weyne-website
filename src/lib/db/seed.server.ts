import { asc } from 'drizzle-orm'
import { priceLists } from './schema/canonical'
import { closeDatabase, getDatabase } from './database.server'

export const CANONICAL_PRICE_LISTS = Object.freeze([
  Object.freeze({
    id: '00000000-0000-4000-8000-000000000001',
    key: 'PRICE_1' as const,
    displayName: 'Preço 1',
    position: 1,
  }),
  Object.freeze({
    id: '00000000-0000-4000-8000-000000000002',
    key: 'PRICE_2' as const,
    displayName: 'Preço 2',
    position: 2,
  }),
  Object.freeze({
    id: '00000000-0000-4000-8000-000000000003',
    key: 'PRICE_3' as const,
    displayName: 'Preço 3',
    position: 3,
  }),
  Object.freeze({
    id: '00000000-0000-4000-8000-000000000004',
    key: 'PRICE_4' as const,
    displayName: 'Preço 4',
    position: 4,
  }),
] as const)

type SeedRunnerOptions = Readonly<{
  seedDatabase: () => Promise<void>
  closeDatabase: () => Promise<void>
}>

export function createSeedRunner(options: SeedRunnerOptions): () => Promise<void> {
  return async () => {
    try {
      await options.seedDatabase()
    } finally {
      await options.closeDatabase()
    }
  }
}

export const seedDatabase = createSeedRunner({
  seedDatabase: async () => {
    const database = await getDatabase()
    await database.insert(priceLists).values([...CANONICAL_PRICE_LISTS]).onConflictDoNothing()

    const actual = await database
      .select({ id: priceLists.id, key: priceLists.key, position: priceLists.position })
      .from(priceLists)
      .orderBy(asc(priceLists.position))
    const expected = CANONICAL_PRICE_LISTS.map(({ id, key, position }) => ({ id, key, position }))

    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error('Canonical price-list identities are missing or inconsistent')
    }
  },
  closeDatabase,
})
