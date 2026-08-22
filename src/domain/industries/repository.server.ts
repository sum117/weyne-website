import {
  and,
  asc,
  desc,
  eq,
  ilike,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import type {
  IndustryCreate,
  IndustryDetail,
  IndustryListQuery,
  IndustryUpdate,
} from '@/domain/industries/contracts'
import type {
  IndustryAuditEvent,
  IndustryMutationRepository,
  IndustryUnitOfWork,
} from '@/domain/industries/mutation-service.server'
import type * as databaseSchema from '@/lib/db/schema'
import {
  catalogAudit,
  industries,
  industryProfiles,
} from '@/lib/db/schema/catalog'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import { containsPattern } from '@/lib/server/sql-pattern'
import {
  serializeDate,
  serializeDecimal,
  serializeNullableDate,
} from '@/lib/server/serialization'

export type IndustryRow = typeof industries.$inferSelect
export type IndustryProfileRow = typeof industryProfiles.$inferSelect

type IndustryJoinedRow = Readonly<{
  industry: IndustryRow
  profile: IndustryProfileRow
}>
type IndustryDatabase = PostgresJsDatabase<typeof databaseSchema>
type IndustryTransaction = Parameters<
  Parameters<IndustryDatabase['transaction']>[0]
>[0]
type IndustryExecutor = IndustryDatabase | IndustryTransaction
type WriteMetadata = Readonly<{
  actorUserId: string
  occurredAt: Date
}>
type CreateMetadata = WriteMetadata & Readonly<{ id: string }>
type IndustrySort = IndustryListQuery['sortBy']
type IndustryCursor = Readonly<{
  sortBy: IndustrySort
  sortDirection: IndustryListQuery['sortDirection']
  value: string
  id: string
}>

const industryCursorCodec = createKeysetCursorCodec(
  z.strictObject({
    sortBy: z.enum(['legalName', 'tradeName', 'cnpj', 'createdAt', 'updatedAt']),
    sortDirection: z.enum(['asc', 'desc']),
    value: z.string().min(1),
    id: z.uuid(),
  }),
)

export function mapIndustryRow(row: IndustryJoinedRow): IndustryDetail {
  const { industry, profile } = row
  return Object.freeze({
    id: industry.id,
    legalName: industry.legalName,
    tradeName: profile.tradeName,
    cnpj: profile.cnpj,
    address: Object.freeze({
      street: profile.street,
      number: profile.addressNumber,
      complement: profile.addressComplement,
      district: profile.district,
      city: profile.city,
      state: profile.state,
      postalCode: profile.postalCode,
      countryCode: profile.countryCode as 'BR',
    }),
    defaultCommissionPercentage: serializeDecimal(profile.defaultCommissionPercentage),
    notes: profile.notes,
    createdAt: serializeDate(industry.createdAt),
    createdByUserId: profile.createdByUserId,
    updatedAt: serializeDate(industry.updatedAt),
    updatedByUserId: profile.updatedByUserId,
    archivedAt: serializeNullableDate(industry.archivedAt),
    archivedByUserId: industry.archivedByUserId,
  })
}

function requireReturnedRow<T>(rows: readonly T[], entity: string): T {
  const row = rows[0]
  if (!row) throw new Error(`Database write returned no ${entity}`)
  return row
}

function decodeCursor(query: IndustryListQuery): IndustryCursor | undefined {
  if (!query.cursor) return undefined
  const decoded = industryCursorCodec.decode(query.cursor)
  if (!decoded.ok) throw new RangeError('Invalid industry cursor')
  if (
    decoded.data.sortBy !== query.sortBy ||
    decoded.data.sortDirection !== query.sortDirection
  ) {
    throw new RangeError('Industry cursor does not match the requested ordering')
  }
  return decoded.data
}

function sortExpression(sortBy: IndustrySort) {
  switch (sortBy) {
    case 'legalName':
      return sql<string>`lower(${industries.legalName})`
    case 'tradeName':
      return sql<string>`lower(${industryProfiles.tradeName})`
    case 'cnpj':
      return industryProfiles.cnpj
    case 'createdAt':
      return industries.createdAt
    case 'updatedAt':
      return industries.updatedAt
  }
}

function cursorPredicate(
  query: IndustryListQuery,
  cursor: IndustryCursor | undefined,
): SQL | undefined {
  if (!cursor) return undefined
  const operator = sql.raw(query.sortDirection === 'asc' ? '>' : '<')
  const expression = sortExpression(query.sortBy)
  const value =
    query.sortBy === 'createdAt' || query.sortBy === 'updatedAt'
      ? new Date(cursor.value)
      : query.sortBy === 'legalName' || query.sortBy === 'tradeName'
        ? cursor.value.toLocaleLowerCase('pt-BR')
        : cursor.value
  if (value instanceof Date && Number.isNaN(value.getTime())) {
    throw new RangeError('Invalid industry date cursor')
  }
  return sql`(
    ${expression} ${operator} ${value}
    OR (${expression} = ${value} AND ${industries.id} ${operator} ${cursor.id})
  )`
}

function cursorFor(row: IndustryJoinedRow, query: IndustryListQuery): IndustryCursor {
  const value =
    query.sortBy === 'legalName'
      ? row.industry.legalName.toLocaleLowerCase('pt-BR')
      : query.sortBy === 'tradeName'
        ? row.profile.tradeName.toLocaleLowerCase('pt-BR')
        : query.sortBy === 'cnpj'
          ? row.profile.cnpj
          : query.sortBy === 'createdAt'
            ? serializeDate(row.industry.createdAt)
            : serializeDate(row.industry.updatedAt)
  return {
    sortBy: query.sortBy,
    sortDirection: query.sortDirection,
    value,
    id: row.industry.id,
  }
}

function normalizedSearch(value: string): string {
  return value.replace(/[./-]/g, '').toUpperCase()
}

const joinedSelection = { industry: industries, profile: industryProfiles } as const

export function createPostgresIndustryRepository(database: IndustryExecutor) {
  return Object.freeze({
    async findById(id: string): Promise<IndustryDetail | null> {
      const rows = await database
        .select(joinedSelection)
        .from(industries)
        .innerJoin(industryProfiles, eq(industryProfiles.industryId, industries.id))
        .where(eq(industries.id, id))
        .limit(1)
      return rows[0] ? mapIndustryRow(rows[0]) : null
    },

    async findActiveById(id: string): Promise<IndustryDetail | null> {
      const rows = await database
        .select(joinedSelection)
        .from(industries)
        .innerJoin(industryProfiles, eq(industryProfiles.industryId, industries.id))
        .where(and(eq(industries.id, id), isNull(industries.archivedAt)))
        .limit(1)
      return rows[0] ? mapIndustryRow(rows[0]) : null
    },

    async findByCnpj(cnpj: string): Promise<IndustryDetail | null> {
      const rows = await database
        .select(joinedSelection)
        .from(industries)
        .innerJoin(industryProfiles, eq(industryProfiles.industryId, industries.id))
        .where(eq(industryProfiles.cnpj, normalizedSearch(cnpj)))
        .limit(1)
      return rows[0] ? mapIndustryRow(rows[0]) : null
    },

    async list(query: IndustryListQuery) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 100) {
        throw new RangeError('Industry page size must be between 1 and 100')
      }

      const filters: SQL[] = []
      if (query.filters.archiveState === 'active') {
        filters.push(isNull(industries.archivedAt))
      } else if (query.filters.archiveState === 'archived') {
        filters.push(isNotNull(industries.archivedAt))
      }

      const search = query.filters.search?.trim()
      if (search) {
        const pattern = containsPattern(search)
        const canonicalPattern = containsPattern(normalizedSearch(search))
        filters.push(
          or(
            ilike(industries.legalName, pattern),
            ilike(industryProfiles.tradeName, pattern),
            ilike(industryProfiles.cnpj, canonicalPattern),
          )!,
        )
      }

      const afterCursor = cursorPredicate(query, decodeCursor(query))
      if (afterCursor) filters.push(afterCursor)
      const expression = sortExpression(query.sortBy)
      const order = query.sortDirection === 'asc' ? asc : desc
      const rows = await database
        .select(joinedSelection)
        .from(industries)
        .innerJoin(industryProfiles, eq(industryProfiles.industryId, industries.id))
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(order(expression), order(industries.id))
        .limit(query.limit + 1)

      const pageRows = rows.slice(0, query.limit)
      const items = pageRows.map(mapIndustryRow)
      const lastRow = pageRows.at(-1)
      return {
        items,
        nextCursor:
          rows.length > query.limit && lastRow
            ? industryCursorCodec.encode(cursorFor(lastRow, query))
            : null,
      }
    },

    create(input: IndustryCreate, metadata: CreateMetadata): Promise<IndustryDetail> {
      return database.transaction(async (transaction) => {
        const industryRows = await transaction
          .insert(industries)
          .values({
            id: metadata.id,
            legalName: input.legalName,
            createdAt: metadata.occurredAt,
            updatedAt: metadata.occurredAt,
          })
          .returning()
        const profileRows = await transaction
          .insert(industryProfiles)
          .values({
            industryId: metadata.id,
            tradeName: input.tradeName,
            cnpj: input.cnpj,
            street: input.address.street,
            addressNumber: input.address.number,
            addressComplement: input.address.complement,
            district: input.address.district,
            city: input.address.city,
            state: input.address.state,
            postalCode: input.address.postalCode,
            countryCode: input.address.countryCode,
            defaultCommissionPercentage: input.defaultCommissionPercentage,
            notes: input.notes ?? null,
            createdByUserId: metadata.actorUserId,
            updatedByUserId: metadata.actorUserId,
          })
          .returning()
        return mapIndustryRow({
          industry: requireReturnedRow(industryRows, 'industry'),
          profile: requireReturnedRow(profileRows, 'industry profile'),
        })
      })
    },

    update(input: IndustryUpdate, metadata: WriteMetadata): Promise<IndustryDetail | null> {
      return database.transaction(async (transaction) => {
        const industryRows = await transaction
          .update(industries)
          .set({
            ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
            updatedAt: metadata.occurredAt,
          })
          .where(and(eq(industries.id, input.id), isNull(industries.archivedAt)))
          .returning()
        const industry = industryRows[0]
        if (!industry) return null
        const profileRows = await transaction
          .update(industryProfiles)
          .set({
            ...(input.tradeName !== undefined ? { tradeName: input.tradeName } : {}),
            ...(input.cnpj !== undefined ? { cnpj: input.cnpj } : {}),
            ...(input.address !== undefined
              ? {
                  street: input.address.street,
                  addressNumber: input.address.number,
                  addressComplement: input.address.complement,
                  district: input.address.district,
                  city: input.address.city,
                  state: input.address.state,
                  postalCode: input.address.postalCode,
                  countryCode: input.address.countryCode,
                }
              : {}),
            ...(input.defaultCommissionPercentage !== undefined
              ? { defaultCommissionPercentage: input.defaultCommissionPercentage }
              : {}),
            ...(input.notes !== undefined ? { notes: input.notes } : {}),
            updatedByUserId: metadata.actorUserId,
          })
          .where(eq(industryProfiles.industryId, input.id))
          .returning()
        return mapIndustryRow({
          industry,
          profile: requireReturnedRow(profileRows, 'industry profile'),
        })
      })
    },

    archive(id: string, metadata: WriteMetadata): Promise<IndustryDetail | null> {
      return database.transaction(async (transaction) => {
        const industryRows = await transaction
          .update(industries)
          .set({
            archivedAt: metadata.occurredAt,
            archivedBy: metadata.actorUserId,
            archivedByUserId: metadata.actorUserId,
            updatedAt: metadata.occurredAt,
          })
          .where(and(eq(industries.id, id), isNull(industries.archivedAt)))
          .returning()
        const industry = industryRows[0]
        if (!industry) return null
        const profileRows = await transaction
          .update(industryProfiles)
          .set({ updatedByUserId: metadata.actorUserId })
          .where(eq(industryProfiles.industryId, id))
          .returning()
        return mapIndustryRow({
          industry,
          profile: requireReturnedRow(profileRows, 'industry profile'),
        })
      })
    },

    async appendAudit(event: IndustryAuditEvent): Promise<void> {
      await database.insert(catalogAudit).values({
        actorId: event.actor.id,
        operation: event.action,
        targetType: 'industry',
        targetId: event.industryId,
        beforeState: event.before === null ? null : { ...event.before },
        afterState: { ...event.after },
        occurredAt: new Date(event.occurredAt),
      })
    },
  })
}

export function createPostgresIndustryPersistence(database: IndustryDatabase): Readonly<{
  repository: IndustryMutationRepository
  unitOfWork: IndustryUnitOfWork
}> {
  return Object.freeze({
    repository: createPostgresIndustryRepository(database),
    unitOfWork: Object.freeze({
      transaction: <T>(
        work: (repository: IndustryMutationRepository) => Promise<T>,
      ) =>
        database.transaction((transaction) =>
          work(createPostgresIndustryRepository(transaction)),
        ),
    }),
  })
}
