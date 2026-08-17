import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import type {
  CarrierCreate,
  CarrierDetail,
  CarrierListItem,
  CarrierListOutput,
  CarrierListQuery,
  CarrierUpdate,
} from '@/domain/carriers/contracts'
import type {
  CarrierRepository,
  CarrierUnitOfWork,
} from '@/domain/carriers/service.server'
import type * as databaseSchema from '@/lib/db/schema'
import { carrierAudit } from '@/lib/db/schema/carrier-audit'
import { carriers } from '@/lib/db/schema/carriers'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import {
  serializeDate,
  serializeNullableDate,
} from '@/lib/server/serialization'

export type CarrierRow = typeof carriers.$inferSelect

type CarrierDatabase = PostgresJsDatabase<typeof databaseSchema>
type CarrierTransaction = Parameters<
  Parameters<CarrierDatabase['transaction']>[0]
>[0]
type CarrierExecutor = CarrierDatabase | CarrierTransaction
type WriteMetadata = Readonly<{
  actorUserId: string
  occurredAt: Date
}>
type CreateMetadata = WriteMetadata & Readonly<{ id: string }>
type CarrierSort = CarrierListQuery['sortBy']
type CarrierSortDirection = CarrierListQuery['sortDirection']
type CarrierCursor = Readonly<{
  sortBy: CarrierSort
  sortDirection: CarrierSortDirection
  value: string
  id: string
}>

const carrierCursorCodec = createKeysetCursorCodec(
  z.strictObject({
    sortBy: z.enum(['name', 'createdAt', 'updatedAt']),
    sortDirection: z.enum(['asc', 'desc']),
    value: z.string().min(1),
    id: z.uuid(),
  }),
)

export function mapCarrierRow(row: CarrierRow): CarrierDetail {
  return Object.freeze({
    id: row.id,
    name: row.name,
    taxId: row.taxId,
    contactName: row.contactName,
    email: row.email,
    phone: row.phone,
    streetAddress: row.streetAddress,
    postalCode: row.postalCode,
    city: row.city,
    state: row.state,
    notes: row.notes,
    createdAt: serializeDate(row.createdAt),
    createdByUserId: row.createdByUserId,
    updatedAt: serializeDate(row.updatedAt),
    updatedByUserId: row.updatedByUserId,
    archivedAt: serializeNullableDate(row.archivedAt),
    archivedByUserId: row.archivedByUserId,
  })
}

function mapCarrierListItem(row: CarrierRow): CarrierListItem {
  return Object.freeze({
    id: row.id,
    name: row.name,
    taxId: row.taxId,
    email: row.email,
    phone: row.phone,
    city: row.city,
    state: row.state,
    updatedAt: serializeDate(row.updatedAt),
    archivedAt: serializeNullableDate(row.archivedAt),
  })
}

function requireReturnedRow(rows: readonly CarrierRow[]): CarrierRow {
  const row = rows[0]
  if (!row) throw new Error('Database write returned no carrier')
  return row
}

function decodeCursor(query: CarrierListQuery): CarrierCursor | undefined {
  if (!query.cursor) return undefined
  const decoded = carrierCursorCodec.decode(query.cursor)
  if (!decoded.ok) throw new RangeError('Invalid carrier cursor')
  if (
    decoded.data.sortBy !== query.sortBy ||
    decoded.data.sortDirection !== query.sortDirection
  ) {
    throw new RangeError('Carrier cursor does not match the requested ordering')
  }
  return decoded.data
}

function cursorPredicate(
  query: CarrierListQuery,
  cursor: CarrierCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined
  const comparison = query.sortDirection === 'asc' ? gt : lt

  if (query.sortBy === 'name') {
    const sortValue = sql<string>`lower(${carriers.name})`
    const cursorValue = cursor.value.toLocaleLowerCase('pt-BR')
    return or(
      comparison(sortValue, cursorValue),
      and(eq(sortValue, cursorValue), comparison(carriers.id, cursor.id)),
    )
  }

  const cursorDate = new Date(cursor.value)
  if (Number.isNaN(cursorDate.getTime())) {
    throw new RangeError('Invalid carrier date cursor')
  }
  const sortColumn =
    query.sortBy === 'createdAt' ? carriers.createdAt : carriers.updatedAt
  return or(
    comparison(sortColumn, cursorDate),
    and(eq(sortColumn, cursorDate), comparison(carriers.id, cursor.id)),
  )
}

function cursorFor(
  row: CarrierRow,
  query: Pick<CarrierListQuery, 'sortBy' | 'sortDirection'>,
): CarrierCursor {
  const value =
    query.sortBy === 'name'
      ? row.name.toLocaleLowerCase('pt-BR')
      : query.sortBy === 'createdAt'
        ? serializeDate(row.createdAt)
        : serializeDate(row.updatedAt)
  return {
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    value,
    id: row.id,
  }
}

function createCarrierRepository(executor: CarrierExecutor): CarrierRepository {
  return Object.freeze({
    async findById(id: string): Promise<CarrierDetail | null> {
      const rows = await executor
        .select()
        .from(carriers)
        .where(eq(carriers.id, id))
        .limit(1)
      return rows[0] ? mapCarrierRow(rows[0]) : null
    },

    async findActiveById(id: string): Promise<CarrierDetail | null> {
      const rows = await executor
        .select()
        .from(carriers)
        .where(and(eq(carriers.id, id), isNull(carriers.archivedAt)))
        .limit(1)
      return rows[0] ? mapCarrierRow(rows[0]) : null
    },

    async list(query: CarrierListQuery): Promise<CarrierListOutput> {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
        throw new RangeError('Carrier page size must be between 1 and 100')
      }

      const filters: SQL[] = []
      if (query.filters.archiveState === 'active') {
        filters.push(isNull(carriers.archivedAt))
      } else if (query.filters.archiveState === 'archived') {
        filters.push(isNotNull(carriers.archivedAt))
      }

      const search = query.filters.search?.trim()
      if (search) {
        filters.push(
          or(
            ilike(carriers.name, `%${search}%`),
            ilike(carriers.taxId, `%${search}%`),
            ilike(carriers.contactName, `%${search}%`),
            ilike(carriers.email, `%${search}%`),
            ilike(carriers.phone, `%${search}%`),
            ilike(carriers.city, `%${search}%`),
            ilike(carriers.state, `%${search}%`),
          )!,
        )
      }

      const decodedCursor = decodeCursor(query)
      const afterCursor = cursorPredicate(query, decodedCursor)
      if (afterCursor) filters.push(afterCursor)

      const sortExpression =
        query.sortBy === 'name'
          ? sql<string>`lower(${carriers.name})`
          : query.sortBy === 'createdAt'
            ? carriers.createdAt
            : carriers.updatedAt
      const order = query.sortDirection === 'asc' ? asc : desc
      const rows = await executor
        .select()
        .from(carriers)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(order(sortExpression), order(carriers.id))
        .limit(query.limit + 1)

      const pageRows = rows.slice(0, query.limit)
      const items = pageRows.map(mapCarrierListItem)
      const lastRow = pageRows.at(-1)
      let nextCursor: string | null = null
      if (rows.length > query.limit && lastRow) {
        nextCursor = carrierCursorCodec.encode(cursorFor(lastRow, query))
      }
      return { items, nextCursor }
    },

    async create(
      input: CarrierCreate,
      metadata: CreateMetadata,
    ): Promise<CarrierDetail> {
      const rows = await executor
        .insert(carriers)
        .values({
          id: metadata.id,
          ...input,
          createdAt: metadata.occurredAt,
          createdByUserId: metadata.actorUserId,
          updatedAt: metadata.occurredAt,
          updatedByUserId: metadata.actorUserId,
        })
        .returning()
      return mapCarrierRow(requireReturnedRow(rows))
    },

    async update(
      input: CarrierUpdate,
      metadata: WriteMetadata,
    ): Promise<CarrierDetail | null> {
      const rows = await executor
        .update(carriers)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.taxId !== undefined ? { taxId: input.taxId } : {}),
          ...(input.contactName !== undefined
            ? { contactName: input.contactName }
            : {}),
          ...(input.email !== undefined ? { email: input.email } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.streetAddress !== undefined
            ? { streetAddress: input.streetAddress }
            : {}),
          ...(input.postalCode !== undefined
            ? { postalCode: input.postalCode }
            : {}),
          ...(input.city !== undefined ? { city: input.city } : {}),
          ...(input.state !== undefined ? { state: input.state } : {}),
          ...(input.notes !== undefined ? { notes: input.notes } : {}),
          updatedAt: metadata.occurredAt,
          updatedByUserId: metadata.actorUserId,
        })
        .where(and(eq(carriers.id, input.id), isNull(carriers.archivedAt)))
        .returning()
      return rows[0] ? mapCarrierRow(rows[0]) : null
    },

    async archive(
      id: string,
      metadata: WriteMetadata,
    ): Promise<CarrierDetail | null> {
      const rows = await executor
        .update(carriers)
        .set({
          archivedAt: metadata.occurredAt,
          archivedByUserId: metadata.actorUserId,
          updatedAt: metadata.occurredAt,
          updatedByUserId: metadata.actorUserId,
        })
        .where(and(eq(carriers.id, id), isNull(carriers.archivedAt)))
        .returning()
      return rows[0] ? mapCarrierRow(rows[0]) : null
    },

    async appendAudit(event) {
      await executor.insert(carrierAudit).values({
        actorUserId: event.actor.id,
        actorRole: event.actor.role,
        carrierId: event.carrierId,
        action: event.action,
        occurredAt: new Date(event.occurredAt),
        metadata: event.metadata,
      })
    },
  })
}

export function createPostgresCarrierRepository(
  database: CarrierDatabase,
): CarrierRepository {
  return createCarrierRepository(database)
}

export function createCarrierPersistence(database: CarrierDatabase): Readonly<{
  repository: CarrierRepository
  unitOfWork: CarrierUnitOfWork
}> {
  return Object.freeze({
    repository: createCarrierRepository(database),
    unitOfWork: {
      transaction: (work) =>
        database.transaction((transaction) => work(createCarrierRepository(transaction))),
    },
  })
}
