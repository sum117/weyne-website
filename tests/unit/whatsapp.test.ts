import { describe, expect, it } from 'vitest'
import {
  CONTACT_ANCHOR,
  DEFAULT_WHATSAPP_MESSAGE,
  buildLeadMessage,
  buildWhatsAppUrl,
  isUsableWhatsAppNumber,
  normalizeWhatsAppNumber,
  resolveWhatsAppHref,
} from '@/features/landing/whatsapp'

describe('normalizeWhatsAppNumber', () => {
  it('strips formatting to digits only', () => {
    expect(normalizeWhatsAppNumber('+55 (81) 9 9999-8888')).toBe('5581999998888')
    expect(normalizeWhatsAppNumber('55-81-99999-8888')).toBe('5581999998888')
  })
})

describe('isUsableWhatsAppNumber', () => {
  it('accepts a plausible international number', () => {
    expect(isUsableWhatsAppNumber('5581999998888')).toBe(true)
    expect(isUsableWhatsAppNumber('+55 (81) 9 9999-8888')).toBe(true)
  })

  it('rejects empty, too short, and the known placeholder', () => {
    expect(isUsableWhatsAppNumber('')).toBe(false)
    expect(isUsableWhatsAppNumber('12345')).toBe(false)
    expect(isUsableWhatsAppNumber('5500000000000')).toBe(false)
    expect(isUsableWhatsAppNumber('55 (00) 0 0000-0000')).toBe(false)
  })
})

describe('buildWhatsAppUrl', () => {
  it('builds a wa.me URL with digits and encoded text', () => {
    expect(buildWhatsAppUrl('55 81 99999-8888', 'Oi')).toBe(
      'https://wa.me/5581999998888?text=Oi',
    )
  })

  it('URL-encodes accents, spaces, punctuation and line breaks', () => {
    const url = buildWhatsAppUrl('5581999998888', 'Olá! Sou João.\n\nPreço?')
    expect(url).toBe(
      'https://wa.me/5581999998888?text=Ol%C3%A1!%20Sou%20Jo%C3%A3o.%0A%0APre%C3%A7o%3F',
    )
    // Round-trips back to the original message.
    const text = new URL(url).searchParams.get('text')
    expect(text).toBe('Olá! Sou João.\n\nPreço?')
  })

  it('throws when the number has no digits', () => {
    expect(() => buildWhatsAppUrl('', 'x')).toThrow()
    expect(() => buildWhatsAppUrl('abc', 'x')).toThrow()
  })
})

describe('buildLeadMessage', () => {
  it('returns the exact default greeting with no name', () => {
    expect(buildLeadMessage({})).toBe(DEFAULT_WHATSAPP_MESSAGE)
    expect(buildLeadMessage({ nome: '   ' })).toBe(DEFAULT_WHATSAPP_MESSAGE)
    expect(DEFAULT_WHATSAPP_MESSAGE).toBe(
      'Olá! Gostaria de falar com a Weyne Representações.',
    )
  })

  it('composes name only', () => {
    expect(buildLeadMessage({ nome: 'Ana' })).toBe('Olá! Sou Ana.')
  })

  it('composes name + company', () => {
    expect(buildLeadMessage({ nome: 'Ana', empresa: 'Acme' })).toBe(
      'Olá! Sou Ana (Acme).',
    )
  })

  it('appends the message on its own line block', () => {
    expect(
      buildLeadMessage({ nome: 'Ana', empresa: 'Acme', mensagem: 'Quero um orçamento.' }),
    ).toBe('Olá! Sou Ana (Acme).\n\nQuero um orçamento.')
  })

  it('trims field whitespace', () => {
    expect(buildLeadMessage({ nome: '  Ana  ', mensagem: '  oi  ' })).toBe(
      'Olá! Sou Ana.\n\noi',
    )
  })
})

describe('resolveWhatsAppHref', () => {
  it('returns the contact anchor for a placeholder/empty number', () => {
    expect(resolveWhatsAppHref('5500000000000')).toBe(CONTACT_ANCHOR)
    expect(resolveWhatsAppHref('')).toBe(CONTACT_ANCHOR)
  })

  it('returns a composed wa.me URL for a usable number', () => {
    expect(resolveWhatsAppHref('5581999998888')).toBe(
      buildWhatsAppUrl('5581999998888', DEFAULT_WHATSAPP_MESSAGE),
    )
  })
})
