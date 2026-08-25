import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createKeysetCursorCodec } from '@/lib/server/cursor.server'
import {
  serializeDate,
  serializeDecimal,
  serializeNullableDate,
} from '@/lib/server/serialization'

const cursorCodec = createKeysetCursorCodec(
  z.strictObject({
    createdAt: z.iso.datetime(),
    id: z.uuid(),
  }),
)

const keyset = {
  createdAt: '2026-08-17T12:34:56.000Z',
  id: 'df5f1b80-1e5b-4a38-bc9f-bf552ef056a4',
}

describe('server serialization primitives', () => {
  it('serializes database decimal strings without precision loss', () => {
    expect(serializeDecimal(' 12345678901234567890.00100 ')).toBe(
      '12345678901234567890.00100',
    )
    expect(() => serializeDecimal('NaN')).toThrow()
    expect(() => serializeDecimal('1e20')).toThrow()
  })

  it('serializes valid dates to stable UTC ISO strings', () => {
    expect(serializeDate(new Date('2026-08-17T09:34:56-03:00'))).toBe(
      '2026-08-17T12:34:56.000Z',
    )
    expect(serializeNullableDate(null)).toBeNull()
    expect(() => serializeDate(new Date(Number.NaN))).toThrow('Invalid date')
  })

  it('round-trips typed keyset cursors as opaque base64url values', () => {
    const encoded = cursorCodec.encode(keyset)
    const decoded = cursorCodec.decode(encoded)

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(decoded).toEqual({ ok: true, data: keyset })
  })

  it('rejects malformed and schema-invalid cursors with a safe validation result', () => {
    const malformed = cursorCodec.decode('not-json')
    const wrongShape = cursorCodec.decode(
      Buffer.from(JSON.stringify({ rawSql: 'select *' })).toString('base64url'),
    )

    for (const result of [malformed, wrongShape]) {
      expect(result).toEqual({
        ok: false,
        error: {
          category: 'validation',
          issues: [{ path: ['cursor'], message: 'Invalid cursor.' }],
        },
      })
    }
  })
})
