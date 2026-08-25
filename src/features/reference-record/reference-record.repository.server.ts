import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import type * as databaseSchema from '@/lib/db/schema'
import {
  referenceRecordEvents,
  referenceRecords,
} from '@/lib/db/schema/reference-record'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import { containsPattern } from '@/lib/server/sql-pattern'
import {
  serializeDate,
  serializeDecimal,
  serializeNullableDate,
} from '@/lib/server/serialization'
import type {
  ReferenceRecord,
  ReferenceRecordCursor,
  ReferenceRecordListQuery,
} from './reference-record'
import type {
  ReferenceRecordRepository,
  ReferenceRecordUnitOfWork,
} from './reference-record.service'

export type ReferenceRecordRow = typeof referenceRecords.$inferSelect

type ReferenceDatabase = PostgresJsDatabase<typeof databaseSchema>
type ReferenceTransaction = Parameters<
  Parameters<ReferenceDatabase['transaction']>[0]
>[0]
type ReferenceExecutor = ReferenceDatabase | ReferenceTransaction

const cursorSchema = z.strictObject({
  sortBy: z.enum(['name', 'createdAt']),
  sortDirection: z.enum(['asc', 'desc']),
  value: z.string().min(1),
  id: z.uuid(),
})

export const referenceRecordCursorCodec = createKeysetCursorCodec(cursorSchema)

function versionToNumber(value: bigint): number {
  const version = Number(value)
  if (!Number.isSafeInteger(version) || version < 1) {
    throw new RangeError('Reference record version is outside the supported range')
  }
  return version
}

export function mapReferenceRecordRow(row: ReferenceRecordRow): ReferenceRecord {
  return Object.freeze({
    id: row.id,
    name: row.name,
    budget: serializeDecimal(row.budget),
    version: versionToNumber(row.version),
    createdAt: serializeDate(row.createdAt),
    updatedAt: serializeDate(row.updatedAt),
    archivedAt: serializeNullableDate(row.archivedAt),
  })
}

function requireReturnedRow(
  rows: readonly ReferenceRecordRow[],
): ReferenceRecordRow {
  const row = rows[0]
  if (!row) throw new Error('Database write returned no reference record')
  return row
}

function cursorPredicate(
  query: Omit<ReferenceRecordListQuery, 'cursor'> &
    Readonly<{ cursor?: ReferenceRecordCursor }>,
): SQL | undefined {
  const cursor = query.cursor
  if (!cursor) return undefined
  const comparison = query.sortDirection === 'asc' ? gt : lt

  if (query.sortBy === 'name') {
    const sortValue = sql<string>`lower(${referenceRecords.name})`
    return or(
      comparison(sortValue, cursor.value.toLocaleLowerCase('en-US')),
      and(
        eq(sortValue, cursor.value.toLocaleLowerCase('en-US')),
        comparison(referenceRecords.id, cursor.id),
      ),
    )
  }

  const cursorDate = new Date(cursor.value)
  if (Number.isNaN(cursorDate.getTime())) {
    throw new RangeError('Invalid createdAt cursor')
  }
  return or(
    comparison(referenceRecords.createdAt, cursorDate),
    and(
      eq(referenceRecords.createdAt, cursorDate),
      comparison(referenceRecords.id, cursor.id),
    ),
  )
}

function cursorFor(
  record: ReferenceRecord,
  query: Pick<ReferenceRecordListQuery, 'sortBy' | 'sortDirection'>,
): ReferenceRecordCursor {
  return {
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    value:
      query.sortBy === 'name'
        ? record.name.toLocaleLowerCase('en-US')
        : record.createdAt,
    id: record.id,
  }
}

function createRepository(executor: ReferenceExecutor): ReferenceRecordRepository {
  return {
    async findActiveById(id) {
      const rows = await executor
        .select()
        .from(referenceRecords)
        .where(and(eq(referenceRecords.id, id), isNull(referenceRecords.archivedAt)))
        .limit(1)
      return rows[0] ? mapReferenceRecordRow(rows[0]) : null
    },

    async list(query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
        throw new RangeError('Reference record page size must be between 1 and 100')
      }

      const filters: SQL[] = [isNull(referenceRecords.archivedAt)]
      const nameContains = query.filters.nameContains?.trim()
      if (nameContains) {
        filters.push(ilike(referenceRecords.name, containsPattern(nameContains)))
      }
      const afterCursor = cursorPredicate(query)
      if (afterCursor) filters.push(afterCursor)

      const sortExpression =
        query.sortBy === 'name'
          ? sql<string>`lower(${referenceRecords.name})`
          : referenceRecords.createdAt
      const order = query.sortDirection === 'asc' ? asc : desc
      const rows = await executor
        .select()
        .from(referenceRecords)
        .where(and(...filters))
        .orderBy(order(sortExpression), order(referenceRecords.id))
        .limit(query.limit + 1)

      const hasNextPage = rows.length > query.limit
      const items = rows.slice(0, query.limit).map(mapReferenceRecordRow)
      const last = items.at(-1)
      return {
        items,
        nextCursor: hasNextPage && last ? cursorFor(last, query) : null,
      }
    },

    async create(input) {
      const now = new Date(input.now)
      const rows = await executor
        .insert(referenceRecords)
        .values({
          id: input.id,
          name: input.name,
          budget: input.budget,
          createdAt: now,
          createdBy: input.actor,
          updatedAt: now,
          updatedBy: input.actor,
        })
        .returning()
      return mapReferenceRecordRow(requireReturnedRow(rows))
    },

    async update(input) {
      const rows = await executor
        .update(referenceRecords)
        .set({
          name: input.name,
          budget: input.budget,
          updatedAt: new Date(input.now),
          updatedBy: input.actor,
          version: sql`${referenceRecords.version} + 1`,
        })
        .where(
          and(
            eq(referenceRecords.id, input.id),
            eq(referenceRecords.version, BigInt(input.expectedVersion)),
            isNull(referenceRecords.archivedAt),
          ),
        )
        .returning()
      return rows[0] ? mapReferenceRecordRow(rows[0]) : null
    },

    async archive(input) {
      const now = new Date(input.now)
      const rows = await executor
        .update(referenceRecords)
        .set({
          archivedAt: now,
          archivedBy: input.actor,
          updatedAt: now,
          updatedBy: input.actor,
          version: sql`${referenceRecords.version} + 1`,
        })
        .where(
          and(
            eq(referenceRecords.id, input.id),
            eq(referenceRecords.version, BigInt(input.expectedVersion)),
            isNull(referenceRecords.archivedAt),
          ),
        )
        .returning()
      return rows[0] ? mapReferenceRecordRow(rows[0]) : null
    },

    async appendEvent(event) {
      await executor.insert(referenceRecordEvents).values({
        recordId: event.recordId,
        operation: event.operation,
        actor: event.actor,
        version: BigInt(event.version),
        occurredAt: new Date(event.occurredAt),
      })
    },
  }
}

export function createReferenceRecordPersistence(database: ReferenceDatabase): Readonly<{
  repository: ReferenceRecordRepository
  unitOfWork: ReferenceRecordUnitOfWork
}> {
  return Object.freeze({
    repository: createRepository(database),
    unitOfWork: {
      transaction: (work) =>
        database.transaction((transaction) => work(createRepository(transaction))),
    },
  })
}
