import { describe, expect, it } from 'vitest'
import {
  cepSchema,
  cnpjSchema,
  formatCep,
  formatCnpj,
  formatPhone,
  parseCep,
  parseCnpj,
  parsePhone,
  phoneSchema,
} from '@/domain/primitives/brazilian'

describe('CNPJ boundary', () => {
  it('normalizes canonical and formatted valid inputs', () => {
    expect(cnpjSchema.parse('41142260000189')).toBe('41142260000189')
    expect(cnpjSchema.parse('41.142.260/0001-89')).toBe('41142260000189')
  })

  it('formats canonical values for display', () => {
    expect(formatCnpj('41142260000189')).toBe('41.142.260/0001-89')
    expect(parseCnpj(formatCnpj('41142260000189'))).toBe('41142260000189')
  })

  it('rejects invalid check digits and malformed input', () => {
    expect(cnpjSchema.safeParse('41142260000180').success).toBe(false)
    expect(cnpjSchema.safeParse('41-142-260/0001-89').success).toBe(false)
    expect(cnpjSchema.safeParse(' 41.142.260/0001-89 ').success).toBe(false)
  })
})

describe('CEP boundary', () => {
  it('normalizes and formats representative CEP values', () => {
    expect(cepSchema.parse('02998-050')).toBe('02998050')
    expect(cepSchema.parse('02998050')).toBe('02998050')
    expect(formatCep('02998050')).toBe('02998-050')
    expect(parseCep(formatCep('02998050'))).toBe('02998050')
  })

  it('rejects malformed CEP values', () => {
    expect(cepSchema.safeParse('2998-050').success).toBe(false)
    expect(cepSchema.safeParse('02998 050').success).toBe(false)
  })
})

describe('Brazilian phone boundary', () => {
  it('normalizes and formats representative mobile and landline values', () => {
    expect(phoneSchema.parse('+55 (11) 98273-1182')).toBe('11982731182')
    expect(phoneSchema.parse('(11) 3972-3768')).toBe('1139723768')
    expect(phoneSchema.parse('11982731182')).toBe('11982731182')
    expect(formatPhone('11982731182')).toBe('(11) 98273-1182')
    expect(parsePhone(formatPhone('11982731182'))).toBe('11982731182')
  })

  it('rejects invalid regional numbers and malformed locale input', () => {
    expect(phoneSchema.safeParse('(23) 3972-3768').success).toBe(false)
    expect(phoneSchema.safeParse('(11)98273-1182').success).toBe(false)
    expect(phoneSchema.safeParse('55 11 98273 1182').success).toBe(false)
  })
})
