import { describe, expect, it } from 'vitest'
import {
  COLLECTION_FILTER_OPERATORS,
  DEFAULT_COLLECTION_LIMIT,
  MAX_COLLECTION_LIMIT,
  createCollectionInputSchema,
} from '@/domain/primitives/collection'

const collectionSchema = createCollectionInputSchema({
  filterFields: ['status', 'customerId', 'createdAt'] as const,
  sortFields: ['number', 'createdAt', 'status'] as const,
  defaultSortField: 'createdAt',
})

describe('collection input schema', () => {
  it('applies conservative deterministic defaults', () => {
    expect(DEFAULT_COLLECTION_LIMIT).toBe(25)
    expect(MAX_COLLECTION_LIMIT).toBe(100)
    expect(collectionSchema.parse({})).toEqual({
      limit: 25,
      filters: [],
      sort: { field: 'createdAt', direction: 'asc' },
    })
  })

  it('accepts the pagination boundaries and a non-empty cursor', () => {
    expect(collectionSchema.parse({ limit: '1' }).limit).toBe(1)
    expect(collectionSchema.parse({ limit: '100' }).limit).toBe(100)
    expect(collectionSchema.parse({ cursor: '  next-page  ' }).cursor).toBe(
      'next-page',
    )
  })

  it.each([0, 101, -1, 1.5, '', 'abc'])('rejects invalid limit %j', (limit) => {
    expect(collectionSchema.safeParse({ limit }).success).toBe(false)
  })

  it('accepts every operator with its permitted value shape', () => {
    expect(COLLECTION_FILTER_OPERATORS).toEqual([
      'eq',
      'neq',
      'contains',
      'in',
      'gte',
      'lte',
      'isNull',
    ])

    const result = collectionSchema.parse({
      filters: [
        { field: 'status', operator: 'eq', value: 'approved' },
        { field: 'status', operator: 'neq', value: 'cancelled' },
        { field: 'customerId', operator: 'contains', value: 'cliente' },
        { field: 'status', operator: 'in', value: ['sent', 'approved'] },
        { field: 'createdAt', operator: 'gte', value: '2026-01-01' },
        { field: 'createdAt', operator: 'lte', value: '2026-12-31' },
        { field: 'customerId', operator: 'isNull', value: false },
      ],
    })

    expect(result.filters).toHaveLength(7)
  })

  it('rejects forbidden filter and sort fields without changing their case', () => {
    expect(
      collectionSchema.safeParse({
        filters: [{ field: 'representativeId', operator: 'eq', value: 'x' }],
      }).success,
    ).toBe(false)
    expect(
      collectionSchema.safeParse({ sort: { field: 'grandTotal', direction: 'asc' } })
        .success,
    ).toBe(false)
    expect(
      collectionSchema.safeParse({ sort: { field: 'CreatedAt', direction: 'asc' } })
        .success,
    ).toBe(false)
  })

  it.each([
    { field: 'status', operator: 'equals', value: 'sent' },
    { field: 'status', operator: 'in', value: [] },
    { field: 'status', operator: 'in', value: [''] },
    { field: 'status', operator: 'contains', value: '' },
    { field: 'status', operator: 'isNull', value: 'true' },
    { field: 'status', operator: 'eq', value: ['sent'] },
  ])('rejects malformed filter %j', (filter) => {
    const result = collectionSchema.safeParse({ filters: [filter] })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(
        /informe|não|deve|válid/i,
      )
    }
  })

  it('normalizes duplicate values and exact duplicate filters in first-seen order', () => {
    expect(
      collectionSchema.parse({
        filters: [
          {
            field: 'status',
            operator: 'in',
            value: ['sent', 'approved', 'sent'],
          },
          { field: 'status', operator: 'eq', value: 'draft' },
          { field: 'status', operator: 'eq', value: 'draft' },
        ],
      }).filters,
    ).toEqual([
      { field: 'status', operator: 'in', value: ['sent', 'approved'] },
      { field: 'status', operator: 'eq', value: 'draft' },
    ])
  })

  it('uses only explicit sort directions and rejects unknown top-level keys', () => {
    expect(
      collectionSchema.parse({ sort: { field: 'number', direction: 'desc' } }).sort,
    ).toEqual({ field: 'number', direction: 'desc' })
    expect(
      collectionSchema.safeParse({
        sort: { field: 'number', direction: 'DESC' },
      }).success,
    ).toBe(false)
    const unknownKey = collectionSchema.safeParse({ page: 2 })
    expect(unknownKey.success).toBe(false)
    if (!unknownKey.success) {
      expect(unknownKey.error.issues[0]?.message).toBe(
        'A consulta contém campos não permitidos',
      )
    }
  })
})
