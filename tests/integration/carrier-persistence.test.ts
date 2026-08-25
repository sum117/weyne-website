import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { carrierListInputSchema } from '@/domain/carriers/contracts'
import {
  createCarrierPersistence,
  createPostgresCarrierRepository,
} from '@/domain/carriers/repository.server'
import { createCarrierService } from '@/domain/carriers/service.server'
import { createCarrierOperations } from '@/features/app/carriers/carrier.functions'
import type { CatalogActor } from '@/lib/catalog/authorization.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

let harness: PostgresTestHarness

const actorUserId = '14ea395b-48e6-4567-b851-7cfa6f7375a4'
const createdAt = new Date('2026-08-17T12:00:00.000Z')

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'carriers',
    migrationNames: [
      '0000_migration_smoke.sql',
      '0002_quote_persistence.sql',
      '0004_carriers.sql',
      '0004_order_persistence.sql',
      '0010_order_line_commission_facts.sql',
      '0007_carrier_order_reference.sql',
      '0009_carrier_audit.sql',
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
  return createPostgresCarrierRepository(harness.database)
}

function operationsFor(actor: CatalogActor | null) {
  const persistence = createCarrierPersistence(harness.database)
  const service = createCarrierService({
    ...persistence,
    authenticate: async () => actor,
    createId: randomUUID,
    now: () => createdAt,
  })
  return createCarrierOperations({
    getService: async () => service,
    logUnexpectedError: () => undefined,
  })
}

async function createCarrier(
  name: string,
  overrides: Readonly<{
    taxId?: string
    email?: string
    city?: string
    state?: string
  }> = {},
) {
  return repository().create(
    {
      name,
      ...overrides,
    },
    {
      id: randomUUID(),
      actorUserId,
      occurredAt: createdAt,
    },
  )
}

describe('carrier persistence on PostgreSQL', () => {
  it('persists the contracted profile and resolves archived detail historically', async () => {
    const repo = repository()
    const created = await repo.create(
      {
        name: 'Transportes Aurora',
        taxId: '41142260000189',
        contactName: 'Marina Alves',
        email: 'contato@aurora.example',
        phone: '81999998888',
        streetAddress: 'Rua do Sol, 100',
        postalCode: '50010000',
        city: 'Recife',
        state: 'PE',
        notes: 'Atendimento regional',
      },
      {
        id: randomUUID(),
        actorUserId,
        occurredAt: createdAt,
      },
    )

    expect(await repo.findById(created.id)).toEqual(created)
    expect(await repo.findActiveById(created.id)).toEqual(created)

    const archived = await repo.archive(created.id, {
      actorUserId,
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    expect(archived).toMatchObject({
      id: created.id,
      archivedAt: '2026-08-18T12:00:00.000Z',
      archivedByUserId: actorUserId,
    })
    expect(await repo.findById(created.id)).toEqual(archived)
    expect(await repo.findActiveById(created.id)).toBeNull()
  })

  it('searches and filters archive visibility with the active-only default', async () => {
    const repo = repository()
    await createCarrier('Rota Sertão', { city: 'Petrolina', state: 'PE' })
    const archived = await createCarrier('Rota Litoral', {
      email: 'litoral@example.invalid',
      city: 'Recife',
      state: 'PE',
    })
    await createCarrier('Expresso Agreste', { city: 'Caruaru', state: 'PE' })
    await repo.archive(archived.id, {
      actorUserId,
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    const active = await repo.list(carrierListInputSchema.parse({}))
    expect(active.items.map((carrier) => carrier.name)).toEqual([
      'Expresso Agreste',
      'Rota Sertão',
    ])

    const searched = await repo.list(
      carrierListInputSchema.parse({
        filters: { search: 'litoral', archiveState: 'all' },
      }),
    )
    expect(searched.items).toHaveLength(1)
    expect(searched.items[0]).toMatchObject({
      id: archived.id,
      archivedAt: '2026-08-18T12:00:00.000Z',
    })

    const archivedOnly = await repo.list(
      carrierListInputSchema.parse({ filters: { archiveState: 'archived' } }),
    )
    expect(archivedOnly.items.map((carrier) => carrier.id)).toEqual([archived.id])
  })

  it('paginates every supported stable order without duplicates', async () => {
    const repo = repository()
    for (const name of ['Beta', 'Alfa', 'Gama']) await createCarrier(name)

    const firstPage = await repo.list(
      carrierListInputSchema.parse({ limit: 2, sortBy: 'name', sortDirection: 'asc' }),
    )
    expect(firstPage.items.map((carrier) => carrier.name)).toEqual(['Alfa', 'Beta'])
    expect(firstPage.nextCursor).toEqual(expect.any(String))

    const secondPage = await repo.list(
      carrierListInputSchema.parse({
        limit: 2,
        cursor: firstPage.nextCursor!,
        sortBy: 'name',
        sortDirection: 'asc',
      }),
    )
    expect(secondPage.items.map((carrier) => carrier.name)).toEqual(['Gama'])
    expect(secondPage.nextCursor).toBeNull()

    for (const sortBy of ['name', 'createdAt', 'updatedAt'] as const) {
      for (const sortDirection of ['asc', 'desc'] as const) {
        const seenIds: string[] = []
        let cursor: string | undefined
        do {
          const page = await repo.list(
            carrierListInputSchema.parse({
              limit: 1,
              ...(cursor ? { cursor } : {}),
              sortBy,
              sortDirection,
            }),
          )
          seenIds.push(...page.items.map((carrier) => carrier.id))
          cursor = page.nextCursor ?? undefined
        } while (cursor)

        expect(seenIds).toHaveLength(3)
        expect(new Set(seenIds)).toHaveLength(3)
      }
    }
  })

  it('updates partial fields and preserves quote references after archive', async () => {
    const repo = repository()
    const carrier = await createCarrier('Carga Original', {
      email: 'original@example.invalid',
    })
    const updated = await repo.update(
      { id: carrier.id, name: 'Carga Atualizada', email: null, state: 'PE' },
      {
        actorUserId,
        occurredAt: new Date('2026-08-17T13:00:00.000Z'),
      },
    )

    expect(updated).toMatchObject({
      id: carrier.id,
      name: 'Carga Atualizada',
      email: null,
      state: 'PE',
      updatedByUserId: actorUserId,
    })

    const quoteId = randomUUID()
    await harness.sql`
      INSERT INTO quotes (
        id, quote_number, owner_user_id, status, valid_until, version,
        customer_snapshot, commercial_snapshot, carrier_id
      ) VALUES (
        ${quoteId}, 'ORC-2026-000001', 'owner-1', 'draft', '2026-09-30', 1,
        ${JSON.stringify({ id: 'customer-1' })}::text::jsonb,
        ${JSON.stringify({ lines: [] })}::text::jsonb,
        ${carrier.id}
      )
    `

    await repo.archive(carrier.id, {
      actorUserId,
      occurredAt: new Date('2026-08-18T12:00:00.000Z'),
    })

    const quoteRows = await harness.sql<{ carrierId: string }[]>`
      SELECT carrier_id AS "carrierId" FROM quotes WHERE id = ${quoteId}
    `
    expect(quoteRows).toEqual([{ carrierId: carrier.id }])
    expect(await repo.findById(carrier.id)).not.toBeNull()

    await expect(
      harness.sql`DELETE FROM carriers WHERE id = ${carrier.id}`,
    ).rejects.toMatchObject({ code: '23503' })

    const orderId = randomUUID()
    await harness.sql`
      INSERT INTO orders (
        id, source_quote_id, source_quote_revision, number, number_year,
        number_sequence, status, version, client_id, client_legal_name,
        client_tax_identifier, client_address_street, client_address_number,
        client_address_district, client_address_city, client_address_state,
        client_address_postal_code, currency_code, gross_items_amount,
        per_item_discount_amount, net_items_amount, general_discount_rate,
        general_discount_amount, net_after_discounts_amount, ipi_amount,
        configured_tax_amount, freight_amount, grand_total_amount,
        commission_basis_amount, commission_amount, created_by, creation_reason,
        updated_by, status_changed_by, status_change_reason, carrier_id
      ) VALUES (
        ${orderId}, ${quoteId}, 1, 'PED-2026-000001', 2026, 1, 'open', 1,
        ${randomUUID()}, 'Cliente Referência', '41142260000189', 'Rua Um', '10',
        'Centro', 'Recife', 'PE', '50010000', 'BRL', 0, 0, 0, 0, 0, 0, 0,
        0, 0, 0, 0, 0, 'admin', 'Teste de referência', 'admin', 'admin',
        'Criação', ${carrier.id}
      )
    `
    await expect(
      harness.sql`DELETE FROM carriers WHERE id = ${carrier.id}`,
    ).rejects.toMatchObject({ code: '23503' })

    expect(await harness.sql`SELECT carrier_id FROM quotes WHERE id = ${quoteId}`).toEqual([
      { carrier_id: carrier.id },
    ])
    expect(await harness.sql`SELECT carrier_id FROM orders WHERE id = ${orderId}`).toEqual([
      { carrier_id: carrier.id },
    ])
  })
})

describe('authorized carrier operations on PostgreSQL', () => {
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

  it('commits create, detail, update, search, archive, and safe audit history', async () => {
    const operations = operationsFor(admin)
    const created = await operations.create({
      name: '  Expresso Nordeste  ',
      taxId: '41.142.260/0001-89',
      contactName: '  Marina Alves  ',
      email: 'CONTATO@EXAMPLE.COM',
      phone: '(81) 99999-8888',
      city: 'Recife',
      state: 'pe',
    })
    expect(created).toMatchObject({
      ok: true,
      data: {
        name: 'Expresso Nordeste',
        taxId: '41142260000189',
        phone: '81999998888',
        email: 'contato@example.com',
        state: 'PE',
      },
    })
    if (!created.ok) throw new Error('carrier creation unexpectedly failed')

    await expect(operations.detail({ id: created.data.id })).resolves.toEqual(created)
    await expect(
      operations.list({ filters: { search: 'nordeste', archiveState: 'all' } }),
    ).resolves.toMatchObject({
      ok: true,
      data: { items: [{ id: created.data.id, name: 'Expresso Nordeste' }] },
    })
    await expect(
      operations.update({ id: created.data.id, city: 'Olinda', email: null }),
    ).resolves.toMatchObject({
      ok: true,
      data: { id: created.data.id, city: 'Olinda', email: null },
    })
    await expect(operations.archive({ id: created.data.id })).resolves.toMatchObject({
      ok: true,
      data: { id: created.data.id, archivedAt: createdAt.toISOString() },
    })
    await expect(operations.detail({ id: created.data.id })).resolves.toMatchObject({
      ok: true,
      data: { id: created.data.id, archivedAt: createdAt.toISOString() },
    })
    await expect(operations.resolveActive({ id: created.data.id })).resolves.toEqual({
      ok: false,
      error: {
        code: 'REFERENCE_UNAVAILABLE',
        status: 409,
        message: 'A transportadora arquivada não pode ser selecionada.',
      },
    })
    await expect(
      operations.update({ id: created.data.id, city: 'Fortaleza' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'CONFLICT', status: 409 } })
    await expect(operations.archive({ id: created.data.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'CONFLICT', status: 409 },
    })

    const audit = await harness.sql<{
      action: string
      actorUserId: string
      metadata: { changedFields: string[] }
    }[]>`
      SELECT action, actor_user_id AS "actorUserId", metadata
      FROM carrier_audit
      WHERE carrier_id = ${created.data.id}
      ORDER BY occurred_at, action
    `
    expect(audit).toEqual([
      {
        action: 'carrier.archive',
        actorUserId: admin.id,
        metadata: { changedFields: ['archivedAt'] },
      },
      {
        action: 'carrier.create',
        actorUserId: admin.id,
        metadata: {
          changedFields: ['city', 'contactName', 'email', 'name', 'phone', 'state', 'taxId'],
        },
      },
      {
        action: 'carrier.update',
        actorUserId: admin.id,
        metadata: { changedFields: ['city', 'email'] },
      },
    ])
    expect(JSON.stringify(audit)).not.toContain('41142260000189')
    await expect(
      harness.sql`UPDATE carrier_audit SET metadata = '{}'::jsonb WHERE carrier_id = ${created.data.id}`,
    ).rejects.toMatchObject({ code: '55000' })
    await expect(
      harness.sql`DELETE FROM carrier_audit WHERE carrier_id = ${created.data.id}`,
    ).rejects.toMatchObject({ code: '55000' })

    expect('delete' in operations).toBe(false)
    expect('delete' in repository()).toBe(false)
  })

  it('rejects invalid, unknown, duplicate, unauthenticated, and unauthorized writes without audit', async () => {
    await expect(operationsFor(null).list({})).resolves.toEqual({
      ok: false,
      error: {
        code: 'UNAUTHENTICATED',
        status: 401,
        message: 'Autenticação necessária.',
      },
    })
    await expect(
      operationsFor(representative).create({ name: 'Sem permissão' }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'FORBIDDEN', status: 403 } })
    await expect(
      operationsFor(admin).create({
        name: 'Inválida',
        taxId: '11.111.111/1111-11',
        phone: '123',
        fleetSize: 10,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
      },
    })
    expect(await harness.sql`SELECT id FROM carriers`).toEqual([])
    expect(await harness.sql`SELECT id FROM carrier_audit`).toEqual([])

    const accepted = await operationsFor(admin).create({
      name: 'Identidade Única',
      taxId: '41.142.260/0001-89',
    })
    expect(accepted.ok).toBe(true)
    await expect(
      operationsFor(admin).create({
        name: 'Identidade Duplicada',
        taxId: '41142260000189',
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        status: 409,
        message: 'A operação conflita com o estado atual da transportadora.',
      },
    })
    expect(await harness.sql`SELECT id FROM carriers`).toHaveLength(1)
    expect(await harness.sql`SELECT id FROM carrier_audit`).toHaveLength(1)
  })

  it('allows authenticated read roles and enforces deterministic bounded pagination', async () => {
    const ids = [
      '10000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000003',
    ]
    for (const [index, id] of ids.entries()) {
      await repository().create(
        { name: index === 2 ? 'Beta' : 'Alfa' },
        { id, actorUserId: admin.id, occurredAt: createdAt },
      )
    }

    for (const actor of [representative, readOnly]) {
      const operations = operationsFor(actor)
      await expect(operations.detail({ id: ids[0] })).resolves.toMatchObject({ ok: true })
      await expect(operations.list({ limit: 1 })).resolves.toMatchObject({ ok: true })
      await expect(operations.update({ id: ids[0], city: 'Recife' })).resolves.toMatchObject({
        ok: false,
        error: { code: 'FORBIDDEN', status: 403 },
      })
    }

    const operations = operationsFor(admin)
    const seen: string[] = []
    let cursor: string | undefined
    do {
      const page = await operations.list({
        limit: 1,
        sortBy: 'name',
        sortDirection: 'asc',
        ...(cursor ? { cursor } : {}),
      })
      expect(page.ok).toBe(true)
      if (!page.ok) break
      seen.push(page.data.items[0]!.id)
      cursor = page.data.nextCursor ?? undefined
    } while (cursor)
    expect(seen).toEqual(ids)

    for (const limit of [0, 101]) {
      await expect(operations.list({ limit })).resolves.toMatchObject({
        ok: false,
        error: { code: 'VALIDATION_FAILED', status: 400 },
      })
    }
    await expect(operations.list({ cursor: 'not-a-cursor' })).resolves.toEqual({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 400,
        message: 'Os dados informados são inválidos.',
        issues: [{ path: ['cursor'], message: 'Cursor inválido.' }],
      },
    })

    const firstPage = await operations.list({ limit: 1, sortBy: 'name' })
    if (!firstPage.ok || firstPage.data.nextCursor === null) {
      throw new Error('expected a carrier cursor')
    }
    await expect(
      operations.list({
        limit: 1,
        cursor: firstPage.data.nextCursor,
        sortBy: 'createdAt',
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'VALIDATION_FAILED',
        status: 400,
        issues: [{ path: ['cursor'], message: 'Cursor inválido.' }],
      },
    })
    expect(await harness.sql`SELECT id FROM carrier_audit`).toEqual([])
  })

  it('rolls back carrier creation when PostgreSQL rejects the required audit event', async () => {
    await harness.sql.unsafe(`
      CREATE FUNCTION fail_carrier_audit() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'synthetic carrier audit failure'; END $$;
      CREATE TRIGGER fail_carrier_audit_trg BEFORE INSERT ON carrier_audit
      FOR EACH ROW EXECUTE FUNCTION fail_carrier_audit();
    `)

    await expect(
      operationsFor(admin).create({ name: 'Não pode ficar sem auditoria' }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'Não foi possível concluir a operação.',
      },
    })
    expect(await harness.sql`SELECT id FROM carriers`).toEqual([])
    expect(await harness.sql`SELECT id FROM carrier_audit`).toEqual([])
  })
})
