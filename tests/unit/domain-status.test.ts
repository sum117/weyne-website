import { describe, expect, it } from 'vitest'
import {
  ORDER_STATUSES,
  QUOTE_STATUSES,
  orderStatusSchema,
  quoteStatusSchema,
} from '@/domain/primitives/status'

describe('commercial document statuses', () => {
  it('accepts every canonical quote and order status', () => {
    expect(QUOTE_STATUSES).toEqual([
      'draft',
      'sent',
      'approved',
      'rejected',
      'expired',
      'converted',
      'cancelled',
    ])
    expect(ORDER_STATUSES).toEqual([
      'open',
      'confirmed',
      'invoiced',
      'completed',
      'cancelled',
    ])

    for (const status of QUOTE_STATUSES) {
      expect(quoteStatusSchema.parse(status)).toBe(status)
    }
    for (const status of ORDER_STATUSES) {
      expect(orderStatusSchema.parse(status)).toBe(status)
    }
  })

  it.each([
    ['quote', quoteStatusSchema, 'Draft'],
    ['quote', quoteStatusSchema, 'pending'],
    ['quote', quoteStatusSchema, ''],
    ['order', orderStatusSchema, 'Open'],
    ['order', orderStatusSchema, 'processing'],
    ['order', orderStatusSchema, ''],
  ])('rejects non-canonical %s status %j', (_kind, schema, value) => {
    const result = schema.safeParse(value)

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/[áãç]/i)
    }
  })
})
