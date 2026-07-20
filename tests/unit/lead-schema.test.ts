import { describe, expect, it } from 'vitest'
import { leadSchema } from '@/features/landing/lead.schema'

const base = { nome: 'Carolina', empresa: '', mensagem: '' }

describe('leadSchema', () => {
  it('accepts a valid name and trims it', () => {
    const result = leadSchema.parse({ ...base, nome: '  Carolina  ' })
    expect(result.nome).toBe('Carolina')
  })

  it('requires a name of at least 2 characters', () => {
    expect(leadSchema.safeParse({ ...base, nome: 'A' }).success).toBe(false)
    expect(leadSchema.safeParse({ ...base, nome: '   ' }).success).toBe(false)
    expect(leadSchema.safeParse({ ...base, nome: '' }).success).toBe(false)
  })

  it('enforces the name maximum length', () => {
    expect(leadSchema.safeParse({ ...base, nome: 'a'.repeat(80) }).success).toBe(
      true,
    )
    expect(leadSchema.safeParse({ ...base, nome: 'a'.repeat(81) }).success).toBe(
      false,
    )
  })

  it('allows blank company and message', () => {
    const result = leadSchema.parse({ ...base, empresa: '', mensagem: '' })
    expect(result.empresa).toBe('')
    expect(result.mensagem).toBe('')
  })

  it('enforces company and message maximum lengths', () => {
    expect(
      leadSchema.safeParse({ ...base, empresa: 'x'.repeat(120) }).success,
    ).toBe(true)
    expect(
      leadSchema.safeParse({ ...base, empresa: 'x'.repeat(121) }).success,
    ).toBe(false)
    expect(
      leadSchema.safeParse({ ...base, mensagem: 'x'.repeat(600) }).success,
    ).toBe(true)
    expect(
      leadSchema.safeParse({ ...base, mensagem: 'x'.repeat(601) }).success,
    ).toBe(false)
  })

  it('trims company and message', () => {
    const result = leadSchema.parse({
      ...base,
      empresa: '  Acme  ',
      mensagem: '  oi  ',
    })
    expect(result.empresa).toBe('Acme')
    expect(result.mensagem).toBe('oi')
  })
})
