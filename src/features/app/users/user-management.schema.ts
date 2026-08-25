import { z } from 'zod'
import { cursorPaginationSchema, entityIdSchema } from '@/lib/server/request.schema'

export const USER_MANAGEMENT_ROLES = ['admin', 'representative', 'read_only'] as const

export type UserManagementRole = (typeof USER_MANAGEMENT_ROLES)[number]

export const userManagementRoleSchema = z.enum(USER_MANAGEMENT_ROLES)

const searchSchema = z.string().trim().min(1).max(120)

export const listManagedUsersRequestSchema = z.strictObject({
  cursor: cursorPaginationSchema.shape.cursor,
  limit: cursorPaginationSchema.shape.limit,
  filters: z
    .strictObject({
      search: searchSchema,
      role: userManagementRoleSchema,
      active: z.boolean(),
    })
    .partial()
    .optional()
    .transform((filters) => filters ?? {}),
})

export type ListManagedUsersRequest = z.output<typeof listManagedUsersRequestSchema>

export const managedUserIdRequestSchema = z.strictObject({ id: entityIdSchema })

export type ManagedUserIdRequest = z.output<typeof managedUserIdRequestSchema>

export const assignUserRoleRequestSchema = z.strictObject({
  id: entityIdSchema,
  role: userManagementRoleSchema,
})

export type AssignUserRoleRequest = z.output<typeof assignUserRoleRequestSchema>

export const setUserActiveRequestSchema = z.strictObject({
  id: entityIdSchema,
  active: z.boolean(),
})

export type SetUserActiveRequest = z.output<typeof setUserActiveRequestSchema>
