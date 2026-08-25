import { eq } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { industries, products } from '@/lib/db/schema'
import { createSyntheticCatalogFactory } from '../support/factories'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    migrationNames: ['0001_catalog_pricing.sql', '0008_industries.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
})

afterAll(async () => {
  await harness?.close()
})

describe('application persistence on PostgreSQL', () => {
  it('persists and reads a synthetic catalog product through Drizzle', async () => {
    const factory = createSyntheticCatalogFactory('persistence')
    const industry = factory.industry()
    const product = factory.product(industry.id)

    await harness.database.insert(industries).values(industry)
    await harness.database.insert(products).values(product)

    const persisted = await harness.database
      .select({
        internalCode: products.internalCode,
        description: products.description,
        industryName: industries.legalName,
      })
      .from(products)
      .innerJoin(industries, eq(products.industryId, industries.id))
      .where(eq(products.id, product.id))

    expect(persisted).toEqual([
      {
        internalCode: product.internalCode,
        description: product.description,
        industryName: industry.legalName,
      },
    ])
  })

  it('starts each test with migrated seed data but no prior business rows', async () => {
    const rows = await harness.database.select().from(industries)

    expect(rows).toEqual([])
  })
})
