/**
 * WhatsApp conversion contract.
 *
 * There is exactly one way to build a WhatsApp URL for this site. Every CTA
 * that opens WhatsApp (form submit, floating action, contact row, footer)
 * routes through {@link buildWhatsAppUrl}. Keep this module pure and free of
 * React/DOM so it is trivially unit-testable and reusable by a future
 * TanStack Start server function.
 */

/** Anchor used as the soft-conversion fallback while no real number exists. */
export const CONTACT_ANCHOR = '#contato'

/** Exact default greeting used when the lead form has no name. */
export const DEFAULT_WHATSAPP_MESSAGE =
  'Olá! Gostaria de falar com a Weyne Representações.'

export type LeadMessageInput = {
  nome?: string
  empresa?: string
  mensagem?: string
}

/** Strip everything but digits from a public/display number. */
export function normalizeWhatsAppNumber(input: string): string {
  return input.replace(/\D/g, '')
}

/**
 * A number is usable when it is all-digits, plausibly international
 * (10–15 digits, matching E.164), and not the known prototype placeholder
 * or an all-zero significant part.
 */
export function isUsableWhatsAppNumber(input: string): boolean {
  const digits = normalizeWhatsAppNumber(input)
  if (digits.length < 10 || digits.length > 15) return false
  if (digits === '5500000000000') return false
  // Reject numbers whose national part is entirely zeros (e.g. 55 + 00000...).
  const nationalPart = digits.slice(2)
  if (nationalPart.length > 0 && /^0+$/.test(nationalPart)) return false
  return true
}

/**
 * Build a canonical `https://wa.me/<digits>?text=<encoded>` URL.
 * Throws when the number is empty so callers never produce a broken link.
 */
export function buildWhatsAppUrl(number: string, message: string): string {
  const digits = normalizeWhatsAppNumber(number)
  if (!digits) throw new Error('WhatsApp number is not configured')
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`
}

/**
 * Compose the pt-BR lead message from validated form fields, preserving
 * accents and line breaks (encoding is handled by {@link buildWhatsAppUrl}).
 */
export function buildLeadMessage(input: LeadMessageInput): string {
  const nome = input.nome?.trim() ?? ''
  const empresa = input.empresa?.trim() ?? ''
  const mensagem = input.mensagem?.trim() ?? ''

  if (!nome) return DEFAULT_WHATSAPP_MESSAGE

  const intro = `Olá! Sou ${nome}${empresa ? ` (${empresa})` : ''}.`
  return mensagem ? `${intro}\n\n${mensagem}` : intro
}

/**
 * Resolve an href for a "start a WhatsApp conversation" control.
 * Returns a real wa.me URL (default greeting) when the number is usable,
 * otherwise the contact-section anchor — which is the prototype's exact
 * placeholder behavior until the client supplies a number.
 */
export function resolveWhatsAppHref(number: string): string {
  if (!isUsableWhatsAppNumber(number)) return CONTACT_ANCHOR
  return buildWhatsAppUrl(number, DEFAULT_WHATSAPP_MESSAGE)
}
