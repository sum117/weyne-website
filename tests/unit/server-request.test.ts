import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  createListRequestSchema,
  entityIdRequestSchema,
  parseRequest,
} from '@/lib/server/request.schema'

const listRequestSchema = createListRequestSchema({
  filters: {
    status: z.enum(['active', 'archived']),
    ownerId: z.uuid(),
  },
  sortFields: ['createdAt', 'name'] as const,
  defaultSort: 'createdAt',
  defaultDirection: 'desc',
})

describe('shared request schemas', () => {
  it('parses strict identifier requests', () => {
    const id = 'df5f1b80-1e5b-4a38-bc9f-bf552ef056a4'

    expect(entityIdRequestSchema.parse({ id })).toEqual({ id })
    expect(entityIdRequestSchema.safeParse({ id: 'not-a-uuid' }).success).toBe(
      false,
    )
    expect(entityIdRequestSchema.safeParse({ id, rawSql: 'drop table' }).success).toBe(
      false,
    )
  })

  it('applies bounded pagination and explicit sort defaults', () => {
    expect(listRequestSchema.parse({})).toEqual({
      limit: 25,
      filters: {},
      sortBy: 'createdAt',
      sortDirection: 'desc',
    })
    expect(listRequestSchema.parse({ limit: '50', cursor: 'opaque-cursor' })).toMatchObject(
      { limit: 50, cursor: 'opaque-cursor' },
    )
    expect(listRequestSchema.safeParse({ limit: 101 }).success).toBe(false)
  })

  it('rejects non-allowlisted filter and sort fields', () => {
    expect(
      listRequestSchema.safeParse({ filters: { status: 'active' } }).success,
    ).toBe(true)
    expect(
      listRequestSchema.safeParse({ filters: { internalColumn: 'secret' } }).success,
    ).toBe(false)
    expect(listRequestSchema.safeParse({ sortBy: 'rawSql' }).success).toBe(false)
    expect(listRequestSchema.safeParse({ direction: 'asc' }).success).toBe(false)
  })

  it('converts Zod failures into typed validation results', () => {
    const result = parseRequest(entityIdRequestSchema, { id: 'invalid' })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.category).toBe('validation')
      if (result.error.category === 'validation') {
        expect(result.error.issues[0]?.path).toEqual(['id'])
        expect(result.error.issues[0]?.message).toBeTruthy()
      }
    }
  })
})
