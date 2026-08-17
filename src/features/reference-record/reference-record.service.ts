import {
  conflict,
  failure,
  notFound,
  success,
  unexpected,
  type ApplicationError,
  type Result,
} from '@/lib/domain/result'
import { serializeDate } from '@/lib/server/serialization'
import type {
  ArchiveReferenceRecord,
  CreateReferenceRecord,
  ReferenceRecord,
  ReferenceRecordCursor,
  ReferenceRecordEvent,
  ReferenceRecordListQuery,
  ReferenceRecordPage,
  UpdateReferenceRecord,
} from './reference-record'

export type ReferenceRecordRepository = Readonly<{
  findActiveById: (id: string) => Promise<ReferenceRecord | null>
  list: (
    query: Omit<ReferenceRecordListQuery, 'cursor'> &
      Readonly<{ cursor?: ReferenceRecordCursor }>,
  ) => Promise<Readonly<{ items: readonly ReferenceRecord[]; nextCursor: ReferenceRecordCursor | null }>>
  create: (
    input: Readonly<{
      id: string
      name: string
      budget: string
      actor: string
      now: string
    }>,
  ) => Promise<ReferenceRecord>
  update: (
    input: Readonly<{
      id: string
      name: string
      budget: string
      expectedVersion: number
      actor: string
      now: string
    }>,
  ) => Promise<ReferenceRecord | null>
  archive: (
    input: Readonly<{
      id: string
      expectedVersion: number
      actor: string
      now: string
    }>,
  ) => Promise<ReferenceRecord | null>
  appendEvent: (event: ReferenceRecordEvent) => Promise<void>
}>

export type ReferenceRecordUnitOfWork = Readonly<{
  transaction: <T>(
    work: (repository: ReferenceRecordRepository) => Promise<T>,
  ) => Promise<T>
}>

export type ReferenceRecordCursorCodec = Readonly<{
  encode: (cursor: ReferenceRecordCursor) => string
  decode: (
    cursor: string,
  ) => Result<ReferenceRecordCursor, Extract<ApplicationError, { category: 'validation' }>>
}>

type ServiceDependencies = Readonly<{
  repository: ReferenceRecordRepository
  unitOfWork: ReferenceRecordUnitOfWork
  cursorCodec?: ReferenceRecordCursorCodec
  createId: () => string
  now: () => Date
}>

function eventFor(
  record: ReferenceRecord,
  operation: ReferenceRecordEvent['operation'],
  actor: string,
): ReferenceRecordEvent {
  return {
    recordId: record.id,
    operation,
    actor,
    version: record.version,
    occurredAt: record.updatedAt,
  }
}

export function createReferenceRecordService(dependencies: ServiceDependencies) {
  const execute = async <T>(work: () => Promise<Result<T>>): Promise<Result<T>> => {
    try {
      return await work()
    } catch (cause) {
      return failure(unexpected(cause))
    }
  }

  return Object.freeze({
    read(id: string): Promise<Result<ReferenceRecord>> {
      return execute(async () => {
        const record = await dependencies.repository.findActiveById(id)
        return record === null ? failure(notFound()) : success(record)
      })
    },

    list(query: ReferenceRecordListQuery): Promise<Result<ReferenceRecordPage>> {
      return execute(async () => {
        let cursor: ReferenceRecordCursor | undefined
        if (query.cursor) {
          if (!dependencies.cursorCodec) {
            throw new Error('A cursor codec is required for paginated reads')
          }
          const decoded = dependencies.cursorCodec.decode(query.cursor)
          if (!decoded.ok) return decoded
          cursor = decoded.data
          if (
            cursor.sortBy !== query.sortBy ||
            cursor.sortDirection !== query.sortDirection
          ) {
            return failure({
              category: 'validation',
              issues: [{ path: ['cursor'], message: 'Invalid cursor.' }],
            })
          }
        }

        const page = await dependencies.repository.list({
          limit: query.limit,
          filters: query.filters,
          sortBy: query.sortBy,
          sortDirection: query.sortDirection,
          ...(cursor ? { cursor } : {}),
        })
        return success({
          items: page.items,
          nextCursor:
            page.nextCursor === null
              ? null
              : dependencies.cursorCodec?.encode(page.nextCursor) ?? null,
        })
      })
    },

    create(input: CreateReferenceRecord): Promise<Result<ReferenceRecord>> {
      return execute(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const record = await repository.create({
            ...input,
            id: dependencies.createId(),
            now: serializeDate(dependencies.now()),
          })
          await repository.appendEvent(eventFor(record, 'created', input.actor))
          return success(record)
        }),
      )
    },

    update(input: UpdateReferenceRecord): Promise<Result<ReferenceRecord>> {
      return execute(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const record = await repository.update({
            ...input,
            now: serializeDate(dependencies.now()),
          })
          if (record === null) {
            const current = await repository.findActiveById(input.id)
            return current === null ? failure(notFound()) : failure(conflict())
          }
          await repository.appendEvent(eventFor(record, 'updated', input.actor))
          return success(record)
        }),
      )
    },

    archive(input: ArchiveReferenceRecord): Promise<Result<ReferenceRecord>> {
      return execute(() =>
        dependencies.unitOfWork.transaction(async (repository) => {
          const record = await repository.archive({
            ...input,
            now: serializeDate(dependencies.now()),
          })
          if (record === null) {
            const current = await repository.findActiveById(input.id)
            return current === null ? failure(notFound()) : failure(conflict())
          }
          await repository.appendEvent(eventFor(record, 'archived', input.actor))
          return success(record)
        }),
      )
    },
  })
}
