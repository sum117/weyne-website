import { describe, expect, it } from 'vitest'
import {
  createReferenceRecordService,
  type ReferenceRecordRepository,
  type ReferenceRecordUnitOfWork,
} from '@/features/reference-record/reference-record.service'
import {
  mapReferenceRecordRow,
  type ReferenceRecordRow,
} from '@/features/reference-record/reference-record.repository.server'
import type {
  ReferenceRecord,
  ReferenceRecordEvent,
} from '@/features/reference-record/reference-record'

const firstRecord: ReferenceRecord = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Synthetic account',
  budget: '123.450000',
  version: 1,
  createdAt: '2026-08-17T12:00:00.000Z',
  updatedAt: '2026-08-17T12:00:00.000Z',
  archivedAt: null,
}

class MemoryRepository implements ReferenceRecordRepository {
  records = new Map([[firstRecord.id, firstRecord]])
  events: ReferenceRecordEvent[] = []
  failEvents = false

  async findActiveById(id: string) {
    const record = this.records.get(id)
    return record?.archivedAt === null ? record : null
  }

  async list() {
    return { items: [...this.records.values()], nextCursor: null }
  }

  async create(input: Parameters<ReferenceRecordRepository['create']>[0]) {
    const record: ReferenceRecord = {
      id: input.id,
      name: input.name,
      budget: input.budget,
      version: 1,
      createdAt: input.now,
      updatedAt: input.now,
      archivedAt: null,
    }
    this.records.set(record.id, record)
    return record
  }

  async update(input: Parameters<ReferenceRecordRepository['update']>[0]) {
    const current = this.records.get(input.id)
    if (!current || current.archivedAt !== null || current.version !== input.expectedVersion) {
      return null
    }
    const updated = {
      ...current,
      name: input.name,
      budget: input.budget,
      version: current.version + 1,
      updatedAt: input.now,
    }
    this.records.set(updated.id, updated)
    return updated
  }

  async archive(input: Parameters<ReferenceRecordRepository['archive']>[0]) {
    const current = this.records.get(input.id)
    if (!current || current.archivedAt !== null || current.version !== input.expectedVersion) {
      return null
    }
    const archived = {
      ...current,
      version: current.version + 1,
      updatedAt: input.now,
      archivedAt: input.now,
    }
    this.records.set(archived.id, archived)
    return archived
  }

  async appendEvent(event: ReferenceRecordEvent) {
    if (this.failEvents) throw new Error('synthetic event failure')
    this.events.push(event)
  }
}

function createMemoryUnitOfWork(repository: MemoryRepository): ReferenceRecordUnitOfWork {
  return {
    async transaction(work) {
      const recordsSnapshot = new Map(repository.records)
      const eventsSnapshot = [...repository.events]
      try {
        return await work(repository)
      } catch (error) {
        repository.records = recordsSnapshot
        repository.events = eventsSnapshot
        throw error
      }
    },
  }
}

function createService(repository: MemoryRepository) {
  return createReferenceRecordService({
    repository,
    unitOfWork: createMemoryUnitOfWork(repository),
    createId: () => '22222222-2222-4222-8222-222222222222',
    now: () => new Date('2026-08-17T13:00:00.000Z'),
  })
}

describe('reference record mapping', () => {
  it('maps database decimals and dates into an explicit domain DTO', () => {
    const row: ReferenceRecordRow = {
      id: firstRecord.id,
      name: firstRecord.name,
      budget: firstRecord.budget,
      version: 1n,
      createdAt: new Date(firstRecord.createdAt),
      createdBy: 'user:test',
      updatedAt: new Date(firstRecord.updatedAt),
      updatedBy: 'user:test',
      archivedAt: null,
      archivedBy: null,
    }

    expect(mapReferenceRecordRow(row)).toEqual(firstRecord)
  })
})

describe('reference record service', () => {
  it('creates the record and audit event in one transaction', async () => {
    const repository = new MemoryRepository()
    const service = createService(repository)

    const result = await service.create({
      name: 'New record',
      budget: '42.000001',
      actor: 'user:test',
    })

    expect(result).toMatchObject({
      ok: true,
      data: { name: 'New record', budget: '42.000001', version: 1 },
    })
    expect(repository.events).toMatchObject([
      { operation: 'created', actor: 'user:test', version: 1 },
    ])
  })

  it('returns a typed conflict and preserves data for a stale update', async () => {
    const repository = new MemoryRepository()
    const service = createService(repository)

    const result = await service.update({
      id: firstRecord.id,
      name: 'Stale name',
      budget: '1.000000',
      expectedVersion: 9,
      actor: 'user:test',
    })

    expect(result).toEqual({ ok: false, error: { category: 'conflict' } })
    expect(repository.records.get(firstRecord.id)).toEqual(firstRecord)
    expect(repository.events).toEqual([])
  })

  it('updates with a guarded version and records the next version', async () => {
    const repository = new MemoryRepository()
    const service = createService(repository)

    const result = await service.update({
      id: firstRecord.id,
      name: 'Updated account',
      budget: '321.000001',
      expectedVersion: 1,
      actor: 'user:test',
    })

    expect(result).toMatchObject({
      ok: true,
      data: { name: 'Updated account', budget: '321.000001', version: 2 },
    })
    expect(repository.events).toMatchObject([
      { operation: 'updated', actor: 'user:test', version: 2 },
    ])
  })

  it('lists domain records through the typed query contract', async () => {
    const repository = new MemoryRepository()
    const service = createService(repository)

    const result = await service.list({
      limit: 25,
      filters: { nameContains: 'Synthetic' },
      sortBy: 'name',
      sortDirection: 'asc',
    })

    expect(result).toEqual({
      ok: true,
      data: { items: [firstRecord], nextCursor: null },
    })
    if (result.ok) expect(result.data.items[0]).not.toHaveProperty('createdBy')
  })

  it('rolls the entity write back when the second transactional step fails', async () => {
    const repository = new MemoryRepository()
    repository.failEvents = true
    const service = createService(repository)

    const result = await service.update({
      id: firstRecord.id,
      name: 'Must roll back',
      budget: '999.000000',
      expectedVersion: 1,
      actor: 'user:test',
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.category).toBe('unexpected')
    expect(repository.records.get(firstRecord.id)).toEqual(firstRecord)
    expect(repository.events).toEqual([])
  })

  it('archives with optimistic concurrency and hides the archived record from reads', async () => {
    const repository = new MemoryRepository()
    const service = createService(repository)

    const archived = await service.archive({
      id: firstRecord.id,
      expectedVersion: 1,
      actor: 'user:test',
    })
    const read = await service.read(firstRecord.id)

    expect(archived).toMatchObject({
      ok: true,
      data: { archivedAt: '2026-08-17T13:00:00.000Z', version: 2 },
    })
    expect(read).toEqual({ ok: false, error: { category: 'not-found' } })
  })
})
