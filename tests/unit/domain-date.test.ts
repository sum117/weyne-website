import { describe, expect, it } from 'vitest'
import {
  dateSchema,
  formatDatePtBr,
  parseDatePtBr,
} from '@/domain/primitives/date'

describe('dateSchema', () => {
  it('accepts real ISO calendar dates including leap day', () => {
    expect(dateSchema.parse('2024-02-29')).toBe('2024-02-29')
  })

  it('rejects impossible and ambiguous dates', () => {
    expect(dateSchema.safeParse('2023-02-29').success).toBe(false)
    expect(dateSchema.safeParse('2024-04-31').success).toBe(false)
    expect(dateSchema.safeParse('29/02/2024').success).toBe(false)
    expect(dateSchema.safeParse('2024-2-9').success).toBe(false)
  })
})

describe('pt-BR date boundary', () => {
  it('round-trips between display and canonical representations', () => {
    const canonical = parseDatePtBr('29/02/2024')

    expect(canonical).toBe('2024-02-29')
    expect(formatDatePtBr(canonical)).toBe('29/02/2024')
  })

  it('rejects malformed and impossible pt-BR input', () => {
    expect(() => parseDatePtBr('31/04/2024')).toThrow('Informe uma data válida')
    expect(() => parseDatePtBr('1/2/2024')).toThrow('Informe uma data válida')
    expect(() => parseDatePtBr('2024-02-01')).toThrow('Informe uma data válida')
  })
})
