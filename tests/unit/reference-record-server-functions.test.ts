import { describe, expect, it, vi } from 'vitest'
import type { Result } from '@/lib/domain/result'
import { failure, success, unexpected } from '@/lib/domain/result'
import {
  createReferenceRecordOperations,
  type ReferenceRecordServiceContract,
} from '@/features/reference-record/reference-record.functions'
import type {
  ReferenceRecord,
  ReferenceRecordPage,
} from '@/features/reference-record/reference-record'

const record: ReferenceRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic account',
  budget: '123.450000',
  version: 1,
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
  archivedAt: null,
}

function createService(overrides: Partial<ReferenceRecordServiceContract> = {}) {
  return {
    read: vi.fn(async (): Promise<Result<ReferenceRecord>> => success(record)),
    list: vi.fn(
      async (): Promise<Result<ReferenceRecordPage>> =>
        success({ items: [record], nextCursor: null }),
    ),
    create: vi.fn(async (): Promise<Result<ReferenceRecord>> => success(record)),
    update: vi.fn(async (): Promise<Result<ReferenceRecord>> => success(record)),
    archive: vi.fn(async (): Promise<Result<ReferenceRecord>> => success(record)),
    ...overrides,
  } satisfies ReferenceRecordServiceContract
}

function createOperations(service: ReferenceRecordServiceContract) {
  return createReferenceRecordOperations({
    getService: async () => service,
    logUnexpectedError: vi.fn(),
  })
}

describe('reference record server operations', () => {
  it('validates a read before invoking the domain service', async () => {
    const service = createService()
    const operations = createOperations(service)

    await expect(operations.read({ id: 'not-a-uuid' })).resolves.toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', status: 400 },
    })
    expect(service.read).not.toHaveBeenCalled()

    await expect(operations.read({ id: record.id })).resolves.toEqual({
      ok: true,
      data: record,
    })
    expect(service.read).toHaveBeenCalledWith(record.id)
  })

  it('passes only parsed list filters, pagination, and allowlisted sort values', async () => {
    const service = createService()
    const operations = createOperations(service)

    await expect(
      operations.list({
        limit: '2',
        filters: { nameContains: '  account  ' },
        sortBy: 'name',
        sortDirection: 'desc',
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(service.list).toHaveBeenCalledWith({
      limit: 2,
      filters: { nameContains: 'account' },
      sortBy: 'name',
      sortDirection: 'desc',
    })

    const rejectedService = createService()
    const rejectedOperations = createOperations(rejectedService)
    const rejected = await rejectedOperations.list({
      limit: 2,
      filters: { unsupported: 'SQL fragment' },
      sortBy: 'budget',
    })
    expect(rejected).toMatchObject({
      ok: false,
      error: { code: 'VALIDATION_FAILED', status: 400 },
    })
    expect(rejectedService.list).not.toHaveBeenCalled()
  })

  it.each([
    [
      'create',
      { name: '  New account  ', budget: '42.000001', actor: ' user:test ' },
      { name: 'New account', budget: '42.000001', actor: 'user:test' },
    ],
    [
      'update',
      {
        id: record.id,
        name: '  Updated account  ',
        budget: '321.000001',
        expectedVersion: 1,
        actor: ' user:test ',
      },
      {
        id: record.id,
        name: 'Updated account',
        budget: '321.000001',
        expectedVersion: 1,
        actor: 'user:test',
      },
    ],
    [
      'archive',
      { id: record.id, expectedVersion: 1, actor: ' user:test ' },
      { id: record.id, expectedVersion: 1, actor: 'user:test' },
    ],
  ] as const)('validates and normalizes %s input', async (operation, input, expected) => {
    const service = createService()
    const operations = createOperations(service)

    await expect(operations[operation](input)).resolves.toMatchObject({ ok: true })
    expect(service[operation]).toHaveBeenCalledWith(expected)
  })

  it('rejects malformed writes without invoking the domain service', async () => {
    const service = createService()
    const operations = createOperations(service)

    const results = await Promise.all([
      operations.create({ name: '', budget: 'not-decimal', actor: '' }),
      operations.update({
        id: record.id,
        name: 'Name',
        budget: '1.00',
        expectedVersion: 0,
        actor: 'user:test',
        extra: true,
      }),
      operations.archive({ id: record.id, expectedVersion: 1.5, actor: 'user:test' }),
    ])

    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ code: 'VALIDATION_FAILED' }),
        }),
      ]),
    )
    expect(results.every((result) => !result.ok)).toBe(true)
    expect(service.create).not.toHaveBeenCalled()
    expect(service.update).not.toHaveBeenCalled()
    expect(service.archive).not.toHaveBeenCalled()
  })

  it('maps typed domain errors and sanitizes unexpected failures', async () => {
    const internal = new Error('SQLSTATE 42P01 secret schema t_c81a3b6b')
    const logUnexpectedError = vi.fn()
    const service = createService({
      read: vi.fn(async () => failure(unexpected(internal))),
    })
    const operations = createReferenceRecordOperations({
      getService: async () => service,
      logUnexpectedError,
    })

    const result = await operations.read({ id: record.id })

    expect(result).toEqual({
      ok: false,
      error: {
        code: 'INTERNAL_ERROR',
        status: 500,
        message: 'An unexpected server error occurred.',
      },
    })
    expect(JSON.stringify(result)).not.toContain('SQLSTATE')
    expect(JSON.stringify(result)).not.toContain('t_c81a3b6b')
    expect(logUnexpectedError).toHaveBeenCalledWith(internal)
  })

  it('sanitizes service construction failures too', async () => {
    const internal = new Error('DATABASE_URL contained a secret')
    const logUnexpectedError = vi.fn()
    const operations = createReferenceRecordOperations({
      getService: async () => {
        throw internal
      },
      logUnexpectedError,
    })

    const result = await operations.list({})

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', status: 500 },
    })
    expect(JSON.stringify(result)).not.toContain('DATABASE_URL')
    expect(logUnexpectedError).toHaveBeenCalledWith(internal)
  })
})
