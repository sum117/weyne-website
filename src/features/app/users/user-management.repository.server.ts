import {
  and,
  asc,
  desc,
  eq,
  gt,
  ilike,
  isNotNull,
  isNull,
  ne,
  or,
  sql,
  type SQL,
} from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import { z } from 'zod'
import type * as databaseSchema from '@/lib/db/schema'
import { auditEvents, sessions, users } from '@/lib/db/schema/canonical'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import { containsPattern } from '@/lib/server/sql-pattern'
import { serializeDate, serializeNullableDate } from '@/lib/server/serialization'
import type { ManagedUserListItem } from './user-management'
import type {
  UserManagementAuditEvent,
  UserManagementRepository,
  UserManagementUnitOfWork,
} from './user-management.service.server'
import type { UserManagementRole } from './user-management.schema'

type UsersDatabase = PostgresJsDatabase<typeof databaseSchema>
type UsersTransaction = Parameters<
  Parameters<UsersDatabase['transaction']>[0]
>[0]
type UsersExecutor = UsersDatabase | UsersTransaction

const userCursorCodec = createKeysetCursorCodec(
  z.strictObject({ createdAt: z.iso.datetime({ offset: true }), id: z.uuid() }),
)

/**
 * Narrow list projection. Selects only the columns the DTO needs — never
 * `auth_subject`, and nothing from `accounts` or `sessions` beyond an
 * aggregated last-sign-in timestamp.
 */
const lastSignIn = sql<string | null>`(
  SELECT max(s.created_at)
  FROM sessions s
  WHERE s.user_id = ${users.id}
)` as SQL<string | null>

function mapUserListItem(row: {
  id: string
  name: string
  email: string
  role: UserManagementRole
  disabledAt: Date | null
  createdAt: Date
  lastSignInAt: string | null
}): ManagedUserListItem {
  return Object.freeze({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    active: row.disabledAt === null,
    // The canonical sessions table has no sign-in timestamp; the closest
    // server-truth proxy is the most recent session creation. We expose the
    // latest session's creation time as `lastSignInAt`.
    lastSignInAt: row.lastSignInAt === null ? null : new Date(row.lastSignInAt).toISOString(),
    createdAt: serializeDate(row.createdAt),
  })
}

function cursorPredicate(
  cursor: Readonly<{ createdAt: string; id: string }> | null,
): SQL | undefined {
  if (!cursor) return undefined
  const cursorDate = new Date(cursor.createdAt)
  if (Number.isNaN(cursorDate.getTime())) {
    throw new RangeError('Invalid user-management cursor')
  }
  return or(
    gt(users.createdAt, cursorDate),
    and(eq(users.createdAt, cursorDate), gt(users.id, cursor.id)),
  )
}

function createUserManagementRepository(
  executor: UsersExecutor,
): UserManagementRepository {
  return Object.freeze({
    async findUserStateById(id) {
      const rows = await executor
        .select({
          id: users.id,
          role: users.role,
          disabledAt: users.disabledAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
        .for('update')
      const row = rows[0]
      return row ? Object.freeze(row) : null
    },

    async findUserDetailById(id) {
      const rows = await executor
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, id))
        .limit(1)
      const row = rows[0]
      return row ? Object.freeze(row) : null
    },

    async countActiveAdminsExcluding(id) {
      const [row] = await executor
        .select({ count: sql<number>`count(*)::integer` })
        .from(users)
        .where(and(eq(users.role, 'admin'), isNull(users.disabledAt), ne(users.id, id)))
      return row?.count ?? 0
    },

    async listUsers(query) {
      if (!Number.isInteger(query.limit) || query.limit < 1 || query.limit > 101) {
        throw new RangeError('User page size must be between 1 and 101')
      }

      const filters: SQL[] = []
      const search = query.filters.search?.trim()
      if (search) {
        const pattern = containsPattern(search)
        filters.push(or(ilike(users.name, pattern), ilike(users.email, pattern))!)
      }
      if (query.filters.role) filters.push(eq(users.role, query.filters.role))
      if (query.filters.active !== undefined) {
        filters.push(
          query.filters.active ? isNull(users.disabledAt) : isNotNull(users.disabledAt),
        )
      }
      const afterCursor = cursorPredicate(query.cursor)
      if (afterCursor) filters.push(afterCursor)

      const rows = await executor
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          disabledAt: users.disabledAt,
          createdAt: users.createdAt,
          lastSignInAt: lastSignIn,
        })
        .from(users)
        .where(filters.length > 0 ? and(...filters) : undefined)
        .orderBy(asc(users.createdAt), asc(users.id))
        .limit(query.limit)

      return rows.map(mapUserListItem)
    },

    async setRole(id, role, actorId, now) {
      await executor
        .update(users)
        .set({ role, updatedAt: now })
        .where(eq(users.id, id))
      void actorId
    },

    async setActive(id, active, actorId, now) {
      if (active) {
        await executor
          .update(users)
          .set({ disabledAt: null, disabledByUserId: null, updatedAt: now })
          .where(eq(users.id, id))
        return { revokedSessionCount: 0 }
      }

      // Deactivation revokes every live session in the same transaction:
      // existing cookies stop resolving to a valid session immediately.
      const revoked = await executor
        .delete(sessions)
        .where(eq(sessions.userId, id))
        .returning({ id: sessions.id })
      await executor
        .update(users)
        .set({ disabledAt: now, disabledByUserId: actorId, updatedAt: now })
        .where(eq(users.id, id))
      return { revokedSessionCount: revoked.length }
    },

    async revokeAllSessions(id) {
      const revoked = await executor
        .delete(sessions)
        .where(eq(sessions.userId, id))
        .returning({ id: sessions.id })
      return { revokedSessionCount: revoked.length }
    },

    async appendAudit(event: UserManagementAuditEvent) {
      await executor.insert(auditEvents).values({
        actorUserId: event.actorId,
        actorRole: event.actorRole,
        action: event.action,
        entityType: 'user',
        entityId: event.targetUserId,
        occurredAt: new Date(event.occurredAt),
        correlationId: crypto.randomUUID(),
        before: event.before,
        after: event.after,
        metadata: event.metadata,
      })
    },
  })
}

export function createUserManagementPersistence(
  database: UsersDatabase,
): Readonly<{
  repository: UserManagementRepository
  unitOfWork: UserManagementUnitOfWork
}> {
  return Object.freeze({
    repository: createUserManagementRepository(database),
    unitOfWork: {
      transaction: (work) =>
        database.transaction((transaction) => work(createUserManagementRepository(transaction))),
    },
  })
}

export { userCursorCodec, serializeNullableDate, desc }
