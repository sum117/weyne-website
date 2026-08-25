import { describe, expect, it } from 'vitest'
import { uuidSchema } from '@/domain/primitives/uuid'

describe('uuidSchema', () => {
  it('accepts canonical UUIDs and rejects invalid values', () => {
    expect(uuidSchema.parse('550e8400-e29b-41d4-a716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
    expect(uuidSchema.safeParse('not-a-uuid').success).toBe(false)
  })
})
