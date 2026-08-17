import { afterAll, beforeAll, beforeEach, describe, expect, expectTypeOf, it } from 'vitest'
import type { ReferenceRecord } from '@/features/reference-record/reference-record'
import {
  createReferenceRecordOperations,
  type ReferenceRecordServiceContract,
} from '@/features/reference-record/reference-record.functions'
import {
  createReferenceRecordPersistence,
  referenceRecordCursorCodec,
  type ReferenceRecordRow,
} from '@/features/reference-record/reference-record.repository.server'
import { createReferenceRecordService } from '@/features/reference-record/reference-record.service'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

const IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
] as const
const TIMES = [
  '2026-08-17T12:00:00.000Z',
  '2026-08-17T12:01:00.000Z',
  '2026-08-17T12:02:00.000Z',
  '2026-08-17T12:03:00.000Z',
  '2026-08-17T12:04:00.000Z',
  '2026-08-17T12:05:00.000Z',
] as const

let harness: PostgresTestHarness
let idIndex = 0
let timeIndex = 0

beforeAll(async () => {
  harness = await createPostgresTestHarness({ schemaPrefix: 't_c81a3b6b' })
})

beforeEach(async () => {
  await harness.reset()
  idIndex = 0
  timeIndex = 0
})

afterAll(async () => {
  await harness?.close()
})

function realService(): ReferenceRecordServiceContract {
  const persistence = createReferenceRecordPersistence(harness.database)
  return createReferenceRecordService({
    ...persistence,
    cursorCodec: referenceRecordCursorCodec,
    createId: () => {
      const id = IDS[idIndex]
      if (!id) throw new Error('The deterministic ID fixture is exhausted')
      idIndex += 1
      return id
    },
    now: () => {
      const timestamp = TIMES[timeIndex]
      if (!timestamp) throw new Error('The deterministic clock fixture is exhausted')
      timeIndex += 1
      return new Date(timestamp)
    },
  })
}

function realOperations(logUnexpectedError: (cause: unknown) => void = () => undefined) {
  const service = realService()
  return createReferenceRecordOperations({
    getService: async () => service,
    logUnexpectedError,
  })
}

function expectDomainDto(record: ReferenceRecord) {
  expect(record).toEqual({
    id: expect.any(String),
    name: expect.any(String),
    budget: expect.stringMatching(/^\d+\.\d{6}$/),
    version: expect.any(Number),
    createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    updatedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    archivedAt: expect.toBeOneOf([null, expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/)]),
  })
  expect(record).not.toHaveProperty('createdBy')
  expect(record).not.toHaveProperty('updatedBy')
  expect(record).not.toHaveProperty('archivedBy')
  expectTypeOf(record).toMatchTypeOf<ReferenceRecord>()
  expectTypeOf(record).not.toMatchTypeOf<ReferenceRecordRow>()
}

async function createRecord(
  operations: ReturnType<typeof realOperations>,
  name: string,
  budget: string,
) {
  const result = await operations.create({ name, budget, actor: 'user:integration' })
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error('Expected reference record creation to succeed')
  return result.data
}

describe('reference record pattern on PostgreSQL', () => {
  it('executes create, read, keyset list, allowed filter/sort, update, and archive flows', async () => {
    const operations = realOperations()
    const beta = await createRecord(operations, 'Beta account', '100.123456')
    const alpha = await createRecord(operations, 'Alpha account', '200.000001')
    const gamma = await createRecord(operations, 'Gamma account', '300')

    expect(beta).toMatchObject({
      id: IDS[0],
      budget: '100.123456',
      version: 1,
      createdAt: TIMES[0],
      updatedAt: TIMES[0],
      archivedAt: null,
    })
    expectDomainDto(beta)

    const read = await operations.read({ id: beta.id })
    expect(read).toEqual({ ok: true, data: beta })

    const firstPage = await operations.list({
      limit: 2,
      filters: {},
      sortBy: 'name',
      sortDirection: 'asc',
    })
    expect(firstPage.ok).toBe(true)
    if (!firstPage.ok) throw new Error('Expected first list page to succeed')
    expect(firstPage.data.items.map(({ name }) => name)).toEqual([
      'Alpha account',
      'Beta account',
    ])
    expect(firstPage.data.nextCursor).toEqual(expect.any(String))
    firstPage.data.items.forEach(expectDomainDto)

    const secondPage = await operations.list({
      limit: 2,
      cursor: firstPage.data.nextCursor,
      filters: {},
      sortBy: 'name',
      sortDirection: 'asc',
    })
    expect(secondPage).toMatchObject({
      ok: true,
      data: { items: [{ id: gamma.id, name: 'Gamma account' }], nextCursor: null },
    })

    const filtered = await operations.list({
      limit: 10,
      filters: { nameContains: 'amm' },
      sortBy: 'createdAt',
      sortDirection: 'desc',
    })
    expect(filtered).toMatchObject({
      ok: true,
      data: { items: [{ id: gamma.id }], nextCursor: null },
    })

    const updated = await operations.update({
      id: beta.id,
      name: 'Beta renewed',
      budget: '999.500000',
      expectedVersion: beta.version,
      actor: 'user:integration',
    })
    expect(updated).toEqual({
      ok: true,
      data: {
        ...beta,
        name: 'Beta renewed',
        budget: '999.500000',
        version: 2,
        updatedAt: TIMES[3],
      },
    })

    const archived = await operations.archive({
      id: alpha.id,
      expectedVersion: alpha.version,
      actor: 'user:integration',
    })
    expect(archived).toEqual({
      ok: true,
      data: {
        ...alpha,
        version: 2,
        updatedAt: TIMES[4],
        archivedAt: TIMES[4],
      },
    })

    await expect(operations.read({ id: alpha.id })).resolves.toMatchObject({
      ok: false,
      error: { code: 'NOT_FOUND', status: 404 },
    })
    await expect(
      operations.archive({
        id: alpha.id,
        expectedVersion: 2,
        actor: 'user:integration',
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: 'NOT_FOUND', status: 404 } })

    const active = await operations.list({
      limit: 10,
      filters: {},
      sortBy: 'name',
      sortDirection: 'asc',
    })
    expect(active.ok && active.data.items.map(({ id }) => id)).toEqual([beta.id, gamma.id])

    const events = await harness.sql<
      { operation: string; version: string; recordId: string }[]
    >`SELECT operation, version::text AS version, record_id AS "recordId"
      FROM reference_record_events
      ORDER BY occurred_at, operation`
    expect(events).toEqual([
      { operation: 'created', version: '1', recordId: beta.id },
      { operation: 'created', version: '1', recordId: alpha.id },
      { operation: 'created', version: '1', recordId: gamma.id },
      { operation: 'updated', version: '2', recordId: beta.id },
      { operation: 'archived', version: '2', recordId: alpha.id },
    ])
  })

  it('rejects invalid and unsupported request fields before constructing database access', async () => {
    let serviceConstructions = 0
    const operations = createReferenceRecordOperations({
      getService: async () => {
        serviceConstructions += 1
        return realService()
      },
      logUnexpectedError: () => undefined,
    })

    const results = await Promise.all([
      operations.create({ name: '', budget: 'DROP TABLE reference_records', actor: '' }),
      operations.list({
        limit: 10,
        filters: { unsupported: '1=1' },
        sortBy: 'budget; DROP TABLE reference_records',
        sortDirection: 'asc',
      }),
      operations.update({
        id: IDS[0],
        name: 'Invalid version',
        budget: '1.000000',
        expectedVersion: 0,
        actor: 'user:integration',
        sql: 'SELECT * FROM secrets',
      }),
    ])

    expect(results.every((result) => !result.ok && result.error.code === 'VALIDATION_FAILED')).toBe(
      true,
    )
    expect(serviceConstructions).toBe(0)
    const [table] = await harness.sql<{ tableName: string }[]>`
      SELECT to_regclass('reference_records')::text AS "tableName"
    `
    expect(table?.tableName).toBe('reference_records')
  })

  it('returns a typed conflict for a stale token without changing data or audit history', async () => {
    const operations = realOperations()
    const created = await createRecord(operations, 'Stable account', '10.000000')
    const updated = await operations.update({
      id: created.id,
      name: 'Current account',
      budget: '20.000000',
      expectedVersion: 1,
      actor: 'user:integration',
    })
    expect(updated.ok).toBe(true)

    const stale = await operations.update({
      id: created.id,
      name: 'Stale overwrite',
      budget: '999.000000',
      expectedVersion: 1,
      actor: 'user:integration',
    })
    expect(stale).toEqual({
      ok: false,
      error: {
        code: 'CONFLICT',
        status: 409,
        message: 'Request conflicts with the current resource state.',
      },
    })

    const current = await operations.read({ id: created.id })
    expect(current).toMatchObject({
      ok: true,
      data: { name: 'Current account', budget: '20.000000', version: 2 },
    })
    const [audit] = await harness.sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM reference_record_events
      WHERE record_id = ${created.id}
    `
    expect(audit?.count).toBe(2)
  })

  it('rolls back the entity write when the second transactional step fails', async () => {
    await harness.sql.unsafe(`
      CREATE FUNCTION reject_reference_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'synthetic audit failure' USING ERRCODE = 'P0001';
      END;
      $$;
      CREATE TRIGGER reject_reference_event_trg
      BEFORE INSERT ON reference_record_events
      FOR EACH ROW EXECUTE FUNCTION reject_reference_event();
    `)
    const logged: unknown[] = []
    const operations = realOperations((cause) => logged.push(cause))

    const result = await operations.create({
      name: 'Must roll back',
      budget: '42.000000',
      actor: 'user:integration',
    })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected server error occurred.',
      },
    })
    expect(logged).toHaveLength(1)
    const [counts] = await harness.sql<{ records: number; events: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM reference_records) AS records,
        (SELECT count(*)::integer FROM reference_record_events) AS events
    `
    expect(counts).toEqual({ records: 0, events: 0 })
  })

  it('sanitizes unexpected PostgreSQL failures at the public boundary', async () => {
    const logged: unknown[] = []
    const operations = realOperations((cause) => logged.push(cause))
    await harness.sql`DROP TABLE reference_records CASCADE`

    const result = await operations.read({ id: IDS[0] })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected server error occurred.',
      },
    })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/SQL|reference_records|t_c81a3b6b|42P01|stack|cause/i)
    expect(logged).toHaveLength(1)
    expect(String(logged[0])).toContain('reference_records')
  })
})
