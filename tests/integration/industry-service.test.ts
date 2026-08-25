import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { industryCreateInputSchema } from '@/domain/industries/contracts'
import { createIndustryMutationService } from '@/domain/industries/mutation-service.server'
import {
  createPostgresIndustryPersistence,
  createPostgresIndustryRepository,
} from '@/domain/industries/repository.server'
import { createIndustryQueryService } from '@/domain/industries/query-service.server'
import {
  CatalogAccessError,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

const admin = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  role: 'admin',
} satisfies CatalogActor
const representative = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  role: 'representative',
} satisfies CatalogActor
const readOnly = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  role: 'read_only',
} satisfies CatalogActor
const occurredAt = new Date('2026-08-17T16:00:00.000Z')
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
const baseInput = {
  legalName: 'Aurora Higiene Industrial Ltda.',
  tradeName: 'Aurora Higiene',
  cnpj: '41.142.260/0001-89',
  address,
  defaultCommissionPercentage: '7.500000',
  notes: 'Atendimento regional',
} as const

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'industry_service',
    migrationNames: [
      '0001_catalog_pricing.sql',
      '0002_catalog_audit.sql',
      '0008_industries.sql',
      '0009_industry_audit.sql',
    ],
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

function servicesFor(actor: CatalogActor | null, ids: string[] = [randomUUID()]) {
  const persistence = createPostgresIndustryPersistence(harness.database)
  let nextId = 0
  return {
    mutation: createIndustryMutationService({
      ...persistence,
      authenticate: async () => actor,
      createId: () => ids[nextId++] ?? randomUUID(),
      now: () => occurredAt,
    }),
    query: createIndustryQueryService({
      repository: repository(),
      authenticate: async () => actor,
    }),
  }
}

async function persistFixture(
  id: string,
  input: Readonly<{
    legalName: string
    tradeName: string
    cnpj: string
    defaultCommissionPercentage?: string
  }>,
) {
  return repository().create(
    industryCreateInputSchema.parse({
      ...baseInput,
      ...input,
      address,
      notes: undefined,
    }),
    { id, actorUserId: admin.id, occurredAt },
  )
}

async function auditRows() {
  return harness.sql<
    {
      actorId: string
      operation: string
      targetId: string
      beforeState: Record<string, unknown> | null
      afterState: Record<string, unknown>
    }[]
  >`
    SELECT
      actor_id AS "actorId",
      operation,
      target_id AS "targetId",
      before_state AS "beforeState",
      after_state AS "afterState"
    FROM catalog_audit
    WHERE target_type = 'industry'
    ORDER BY occurred_at, operation
  `
}

describe('authorized industry services on PostgreSQL', () => {
  it('allows every authenticated role to list and read active detail, while unauthenticated reads fail before access', async () => {
    const industry = await persistFixture(
      '10000000-0000-4000-8000-000000000001',
      {
        legalName: 'Aurora Higiene Industrial Ltda.',
        tradeName: 'Aurora Higiene',
        cnpj: '41142260000189',
      },
    )

    for (const actor of [admin, representative, readOnly]) {
      const query = servicesFor(actor).query
      await expect(query.detail({ id: industry.id })).resolves.toEqual({
        ok: true,
        data: industry,
      })
      await expect(query.list({})).resolves.toMatchObject({
        ok: true,
        data: { items: [{ id: industry.id }], nextCursor: null },
      })
    }

    const unauthenticated = servicesFor(null).query
    await expect(unauthenticated.detail({ id: industry.id })).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    })
    await expect(unauthenticated.list({})).rejects.toBeInstanceOf(CatalogAccessError)
  })

  it.each([
    ['unauthenticated', null],
    ['representative', representative],
    ['read-only', readOnly],
  ] as const)('denies all %s mutations without rows or success audit events', async (_label, actor) => {
    const mutation = servicesFor(actor).mutation
    const expectedCategory = actor === null ? 'unauthenticated' : 'forbidden'

    await expect(mutation.create(baseInput)).resolves.toEqual({
      ok: false,
      error: { category: expectedCategory },
    })
    await expect(
      mutation.update({
        id: '10000000-0000-4000-8000-000000000001',
        legalName: 'Não deve persistir',
      }),
    ).resolves.toEqual({ ok: false, error: { category: expectedCategory } })
    await expect(
      mutation.archive({ id: '10000000-0000-4000-8000-000000000001' }),
    ).resolves.toEqual({ ok: false, error: { category: expectedCategory } })

    expect(await harness.sql`SELECT id FROM industries`).toEqual([])
    expect(await auditRows()).toEqual([])
  })

  it('commits create, update, and archive atomically with safe append-only audit events', async () => {
    const industryId = '10000000-0000-4000-8000-000000000001'
    const mutation = servicesFor(admin, [industryId]).mutation

    const created = await mutation.create(baseInput)
    expect(created).toMatchObject({
      ok: true,
      data: {
        id: industryId,
        legalName: baseInput.legalName,
        cnpj: '41142260000189',
        defaultCommissionPercentage: '7.500000',
      },
    })
    const updated = await mutation.update({
      id: industryId,
      tradeName: 'Aurora Profissional',
      defaultCommissionPercentage: '9.125000',
      notes: null,
    })
    expect(updated).toMatchObject({
      ok: true,
      data: {
        id: industryId,
        tradeName: 'Aurora Profissional',
        defaultCommissionPercentage: '9.125000',
        notes: null,
      },
    })
    const archived = await mutation.archive({ id: industryId })
    expect(archived).toMatchObject({
      ok: true,
      data: {
        id: industryId,
        archivedAt: occurredAt.toISOString(),
        archivedByUserId: admin.id,
      },
    })

    const rows = await auditRows()
    expect(rows.map((row) => [row.operation, row.actorId, row.targetId])).toEqual([
      ['industry.archive', admin.id, industryId],
      ['industry.create', admin.id, industryId],
      ['industry.update', admin.id, industryId],
    ])
    expect(JSON.stringify(rows)).not.toContain('41142260000189')
    expect(JSON.stringify(rows)).not.toContain('Rua do Sol')
    expect(JSON.stringify(rows)).not.toContain('Atendimento regional')
    await expect(
      harness.sql`UPDATE catalog_audit SET after_state = '{}'::jsonb WHERE target_id = ${industryId}`,
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      harness.sql`DELETE FROM catalog_audit WHERE target_id = ${industryId}`,
    ).rejects.toMatchObject({ code: '55000' })
  })

  it('rejects formatted create and update CNPJ duplicates without changing data or audit history', async () => {
    const firstId = '10000000-0000-4000-8000-000000000001'
    const secondId = '10000000-0000-4000-8000-000000000002'
    const mutation = servicesFor(admin, [firstId, secondId]).mutation
    expect((await mutation.create(baseInput)).ok).toBe(true)
    expect(
      (
        await mutation.create({
          ...baseInput,
          legalName: 'Duplicada Ltda.',
          tradeName: 'Duplicada',
          cnpj: '41142260000189',
        })
      ).ok,
    ).toBe(false)
    expect(
      await mutation.create({
        ...baseInput,
        legalName: 'Nordeste Ltda.',
        tradeName: 'Nordeste',
        cnpj: '45.723.174/0001-10',
      }),
    ).toMatchObject({ ok: true, data: { id: secondId } })

    await expect(
      mutation.update({ id: secondId, cnpj: '41.142.260/0001-89' }),
    ).resolves.toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [
          {
            path: ['cnpj'],
            message: 'Já existe uma indústria cadastrada com este CNPJ.',
          },
        ],
      },
    })
    expect(await repository().findById(secondId)).toMatchObject({ cnpj: '45723174000110' })
    expect(await auditRows()).toHaveLength(2)
  })

  it('enforces normalized CNPJ uniqueness and commission range at the database boundary', async () => {
    const first = await persistFixture('10000000-0000-4000-8000-000000000001', {
      legalName: 'Aurora Ltda.',
      tradeName: 'Aurora',
      cnpj: '41142260000189',
    })
    const second = await persistFixture('10000000-0000-4000-8000-000000000002', {
      legalName: 'Nordeste Ltda.',
      tradeName: 'Nordeste',
      cnpj: '45723174000110',
    })

    await expect(
      harness.sql`UPDATE industry_profiles SET cnpj = '41.142.260/0001-89' WHERE industry_id = ${second.id}`,
    ).rejects.toMatchObject({ code: '23505', constraint_name: 'industries_cnpj_uidx' })
    for (const commission of ['-0.000001', '100.000001']) {
      await expect(
        harness.sql`UPDATE industry_profiles SET default_commission_percentage = ${commission} WHERE industry_id = ${first.id}`,
      ).rejects.toMatchObject({ code: '23514' })
    }
    await expect(
      harness.sql`UPDATE industry_profiles SET default_commission_percentage = '100.000000' WHERE industry_id = ${first.id}`,
    ).resolves.toBeDefined()
  })

  it('returns shared pt-BR validation for required profile, address, CNPJ, and commission fields', async () => {
    const mutation = servicesFor(admin).mutation
    const result = await mutation.create({
      legalName: ' ',
      tradeName: '',
      cnpj: '11.111.111/1111-11',
      address: { ...address, street: '', state: 'P', postalCode: '123' },
      defaultCommissionPercentage: '100.0000001',
    })

    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } })
    if (result.ok || result.error.category !== 'validation') {
      throw new Error('expected validation issues')
    }
    expect(result.error.issues).toEqual(
      expect.arrayContaining([
        { path: ['legalName'], message: 'A razão social é obrigatório' },
        { path: ['tradeName'], message: 'O nome fantasia é obrigatório' },
        { path: ['cnpj'], message: 'Informe um CNPJ válido' },
        { path: ['address', 'street'], message: 'O logradouro é obrigatório' },
        { path: ['address', 'state'], message: 'Informe uma UF válida' },
        { path: ['address', 'postalCode'], message: 'Informe um CEP válido' },
        {
          path: ['defaultCommissionPercentage'],
          message: 'Informe uma porcentagem entre 0 e 100 com até 6 casas decimais',
        },
      ]),
    )
    expect(await harness.sql`SELECT id FROM industries`).toEqual([])
    expect(await auditRows()).toEqual([])
  })

  it('paginates deterministic ties, reports cursor metadata, accepts boundaries, and rejects unsafe list input', async () => {
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ]
    await persistFixture(ids[0]!, {
      legalName: 'Alfa Ltda.',
      tradeName: 'Mesmo Nome',
      cnpj: '41142260000189',
    })
    await persistFixture(ids[1]!, {
      legalName: 'Alfa Ltda.',
      tradeName: 'Mesmo Nome',
      cnpj: '45723174000110',
    })
    await persistFixture(ids[2]!, {
      legalName: 'Beta Ltda.',
      tradeName: 'Beta',
      cnpj: '11222333000181',
    })
    const query = servicesFor(readOnly).query

    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await query.list({
        limit: 1,
        sortBy: 'legalName',
        sortDirection: 'asc',
        ...(cursor ? { cursor } : {}),
      })
      expect(page.ok).toBe(true)
      if (!page.ok) break
      seen.push(page.data.items[0]!.id)
      cursor = page.data.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toEqual(ids)

    for (const limit of [1, 100]) {
      await expect(query.list({ limit })).resolves.toMatchObject({ ok: true })
    }
    for (const limit of [0, 101]) {
      await expect(query.list({ limit })).resolves.toMatchObject({
        ok: false,
        error: { category: 'validation' },
      })
    }
    await expect(query.list({ sortBy: 'notes' })).resolves.toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })
    await expect(query.list({ cursor: 'not-a-cursor' })).resolves.toEqual({
      ok: false,
      error: {
        category: 'validation',
        issues: [{ path: ['cursor'], message: 'Cursor inválido.' }],
      },
    })
  })

  it('supports every allowed sort plus legal-name, trade-name, and formatted-CNPJ searches and archive filters', async () => {
    const alpha = await persistFixture('10000000-0000-4000-8000-000000000001', {
      legalName: 'Alfa Química Ltda.',
      tradeName: 'Brilho Alfa',
      cnpj: '41142260000189',
    })
    const beta = await persistFixture('10000000-0000-4000-8000-000000000002', {
      legalName: 'Beta Industrial Ltda.',
      tradeName: 'Espuma Beta',
      cnpj: '45723174000110',
    })
    await repository().archive(beta.id, { actorUserId: admin.id, occurredAt })
    const query = servicesFor(representative).query

    for (const [search, expectedId] of [
      ['Química', alpha.id],
      ['Espuma', beta.id],
      ['45.723.174/0001-10', beta.id],
    ] as const) {
      await expect(
        query.list({ filters: { search, archiveState: 'all' } }),
      ).resolves.toMatchObject({ ok: true, data: { items: [{ id: expectedId }] } })
    }
    await expect(query.list({})).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: alpha.id }] },
    })
    await expect(
      query.list({ filters: { archiveState: 'archived' } }),
    ).resolves.toMatchObject({ ok: true, data: { items: [{ id: beta.id }] } })
    await expect(
      query.list({ filters: { archiveState: 'all' } }),
    ).resolves.toMatchObject({ ok: true, data: { items: expect.any(Array) } })

    for (const sortBy of [
      'legalName',
      'tradeName',
      'cnpj',
      'createdAt',
      'updatedAt',
    ] as const) {
      for (const sortDirection of ['asc', 'desc'] as const) {
        const result = await query.list({
          sortBy,
          sortDirection,
          filters: { archiveState: 'all' },
        })
        expect(result).toMatchObject({ ok: true, data: { items: expect.any(Array) } })
      }
    }
  })

  it('hides missing and archived detail equally while preserving archived rows and references', async () => {
    const industry = await persistFixture('10000000-0000-4000-8000-000000000001', {
      legalName: 'Referenciada Ltda.',
      tradeName: 'Referenciada',
      cnpj: '41142260000189',
    })
    const productId = '20000000-0000-4000-8000-000000000001'
    await harness.sql`
      INSERT INTO products (
        id, industry_id, internal_code, description, unit, commission_override,
        created_by, updated_by
      ) VALUES (
        ${productId}, ${industry.id}, 'IND-REF-1', 'Produto referenciado', 'UN',
        99.123456, 'integration-test', 'integration-test'
      )
    `
    const query = servicesFor(admin).query
    const detail = await query.detail({ id: industry.id })
    expect(detail).toMatchObject({
      ok: true,
      data: { defaultCommissionPercentage: '7.500000' },
    })
    if (!detail.ok) throw new Error('expected active industry detail')
    expect(detail.data).not.toHaveProperty('commissionOverride')

    await repository().archive(industry.id, { actorUserId: admin.id, occurredAt })

    const notFound = { ok: false, error: { category: 'not-found' } } as const
    await expect(query.detail({ id: industry.id })).resolves.toEqual(notFound)
    await expect(
      query.detail({ id: '10000000-0000-4000-8000-000000000099' }),
    ).resolves.toEqual(notFound)
    expect(await repository().findById(industry.id)).toMatchObject({
      id: industry.id,
      defaultCommissionPercentage: '7.500000',
      archivedAt: occurredAt.toISOString(),
    })
    expect('delete' in repository()).toBe(false)

    await harness.sql`ALTER TABLE industries DISABLE TRIGGER industries_prevent_hard_delete_trg`
    await expect(
      harness.sql`DELETE FROM industries WHERE id = ${industry.id}`,
    ).rejects.toMatchObject({ code: '23503' })
    expect(await harness.sql`SELECT industry_id FROM products WHERE id = ${productId}`).toEqual([
      { industry_id: industry.id },
    ])
  })

  it('rolls back entity persistence when PostgreSQL rejects the required success audit event', async () => {
    await harness.sql.unsafe(`
      CREATE FUNCTION fail_industry_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic industry audit failure'; END $$;
      CREATE TRIGGER fail_industry_audit_trg BEFORE INSERT ON catalog_audit
      FOR EACH ROW EXECUTE FUNCTION fail_industry_audit();
    `)

    await expect(servicesFor(admin).mutation.create(baseInput)).resolves.toMatchObject({
      ok: false,
      error: { category: 'unexpected' },
    })
    expect(await harness.sql`SELECT id FROM industries`).toEqual([])
    expect(await auditRows()).toEqual([])
  })
})
