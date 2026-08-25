import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  industryCreateInputSchema,
  industryListInputSchema,
} from '@/domain/industries/contracts'
import { createPostgresIndustryRepository } from '@/domain/industries/repository.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

const actorUserId = '14ea395b-48e6-4567-b851-7cfa6f7375a4'
const createdAt = new Date('2026-08-17T12:00:00.000Z')
const address = {
  street: 'Rua do Sol',
  number: '100',
  complement: null,
  district: 'Santo Antônio',
  city: 'Recife',
  state: 'PE',
  postalCode: '50010000',
  countryCode: 'BR' as const,
}

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'industries',
    migrationNames: ['0001_catalog_pricing.sql', '0008_industries.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
})

afterAll(async () => {
  await harness?.close()
})

function repository() {
  return createPostgresIndustryRepository(harness.database)
}

async function createIndustry(
  legalName = 'Aurora Higiene Industrial Ltda.',
  overrides: Readonly<{
    tradeName?: string
    cnpj?: string
    defaultCommissionPercentage?: string
  }> = {},
) {
  return repository().create(
    industryCreateInputSchema.parse({
      legalName,
      tradeName: overrides.tradeName ?? 'Aurora Higiene',
      cnpj: overrides.cnpj ?? '41142260000189',
      address,
      defaultCommissionPercentage: overrides.defaultCommissionPercentage ?? '7.500000',
      notes: 'Atendimento regional',
    }),
    { id: randomUUID(), actorUserId, occurredAt: createdAt },
  )
}

describe('industry persistence on PostgreSQL', () => {
  it('persists the complete normalized profile and actor metadata', async () => {
    const created = await createIndustry()

    expect(created).toMatchObject({
      legalName: 'Aurora Higiene Industrial Ltda.',
      tradeName: 'Aurora Higiene',
      cnpj: '41142260000189',
      address,
      defaultCommissionPercentage: '7.500000',
      notes: 'Atendimento regional',
      createdAt: '2026-08-17T12:00:00.000Z',
      createdByUserId: actorUserId,
      updatedAt: '2026-08-17T12:00:00.000Z',
      updatedByUserId: actorUserId,
      archivedAt: null,
      archivedByUserId: null,
    })
    expect(await repository().findById(created.id)).toEqual(created)
    expect(await repository().list(industryListInputSchema.parse({}))).toMatchObject({
      items: [{ id: created.id }],
      nextCursor: null,
    })
  })

  it('rejects invalid values and serializes concurrent formatted CNPJ duplicates', async () => {
    const insert = async (client: typeof harness.sql, cnpj: string, commission = '7.5') =>
      client`
        WITH new_industry AS (
          INSERT INTO industries (id, legal_name)
          VALUES (${randomUUID()}, 'Aurora Higiene Industrial Ltda.')
          RETURNING id
        )
        INSERT INTO industry_profiles (
          industry_id, trade_name, cnpj, street, address_number, district,
          city, state, postal_code, country_code, default_commission_percentage,
          created_by_user_id, updated_by_user_id
        )
        SELECT
          id, 'Aurora Higiene', ${cnpj}, 'Rua do Sol', '100', 'Santo Antônio',
          'Recife', 'PE', '50010000', 'BR', ${commission}, ${actorUserId},
          ${actorUserId}
        FROM new_industry
      `

    await expect(insert(harness.sql, '00000000000000')).rejects.toMatchObject({
      code: '23514',
    })
    await expect(insert(harness.sql, '41142260000189', '100.000001')).rejects.toMatchObject({
      code: '23514',
    })

    const databaseUrl = process.env.TEST_DATABASE_URL!
    const first = postgres(databaseUrl, { max: 1, prepare: false })
    const second = postgres(databaseUrl, { max: 1, prepare: false })
    try {
      await Promise.all([
        first.unsafe(`SET search_path TO "${harness.schemaName}", public`),
        second.unsafe(`SET search_path TO "${harness.schemaName}", public`),
      ])
      const writes = await Promise.allSettled([
        insert(first, '41.142.260/0001-89'),
        insert(second, '41142260000189'),
      ])
      expect(writes.filter((write) => write.status === 'fulfilled')).toHaveLength(1)
      expect(writes.filter((write) => write.status === 'rejected')).toHaveLength(1)
      const rows = await harness.sql<{ cnpj: string }[]>`SELECT cnpj FROM industry_profiles`
      expect(rows).toEqual([{ cnpj: '41142260000189' }])
    } finally {
      await Promise.all([first.end(), second.end()])
    }
  })

  it('keeps archived rows and restricts deletion while product references exist', async () => {
    const repo = repository()
    const industry = await createIndustry()
    const productId = randomUUID()
    await harness.sql`
      INSERT INTO products (
        id, industry_id, internal_code, description, unit, created_by, updated_by
      ) VALUES (
        ${productId}, ${industry.id}, 'IND-REF-1', 'Produto referenciado', 'UN',
        'integration-test', 'integration-test'
      )
    `

    const archived = await repo.archive(industry.id, {
      actorUserId,
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
    })
    expect(archived).toMatchObject({
      id: industry.id,
      archivedAt: '2026-08-18T12:00:00.000Z',
      archivedByUserId: actorUserId,
    })
    expect(await repo.findActiveById(industry.id)).toBeNull()
    expect(await repo.findById(industry.id)).toEqual(archived)

    await harness.sql`ALTER TABLE industries DISABLE TRIGGER industries_prevent_hard_delete_trg`
    await expect(
      harness.sql`DELETE FROM industries WHERE id = ${industry.id}`,
    ).rejects.toMatchObject({ code: '23503' })
  })

  it('supports formatted CNPJ search, archive filtering, stable sorting, and required indexes', async () => {
    const repo = repository()
    const beta = await createIndustry('Beta Industrial Ltda.', {
      tradeName: 'Beta',
      cnpj: '11222333000181',
    })
    const alpha = await createIndustry('Alpha Industrial Ltda.', {
      tradeName: 'Alpha',
      cnpj: '19131243000197',
    })
    await repo.archive(beta.id, {
      actorUserId,
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    const active = await repo.list(industryListInputSchema.parse({}))
    expect(active.items.map((industry) => industry.id)).toEqual([alpha.id])
    const searched = await repo.list(
      industryListInputSchema.parse({
        filters: { search: '11.222.333/0001-81', archiveState: 'all' },
      }),
    )
    expect(searched.items.map((industry) => industry.id)).toEqual([beta.id])
    const archived = await repo.list(
      industryListInputSchema.parse({ filters: { archiveState: 'archived' } }),
    )
    expect(archived.items.map((industry) => industry.id)).toEqual([beta.id])

    const indexes = await harness.sql<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE schemaname = ${harness.schemaName}
    `
    const names = new Set(indexes.map((index) => index.indexname))
    for (const required of [
      'industries_cnpj_uidx',
      'industries_active_legal_name_idx',
      'industries_active_trade_name_idx',
      'industries_created_idx',
      'industries_updated_idx',
      'industries_archive_idx',
    ]) {
      expect(names.has(required), required).toBe(true)
    }
  })
})
