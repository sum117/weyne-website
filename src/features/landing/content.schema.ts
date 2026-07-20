import { isUsableWhatsAppNumber } from './whatsapp'
import type { LandingPageContent, NavItem } from './content'

/**
 * Content integrity + production-readiness validation.
 *
 * Pure (no fs / no DOM) so it runs in unit tests and in the Node/Bun content
 * check alike. Filesystem checks (brand asset existence) live in
 * scripts/check-content.ts, which layers them on top of these validators.
 */

export type Issue = { level: 'error' | 'warn'; message: string }

/** Canonical set of on-page section anchors. */
export const SECTION_IDS = [
  'topo',
  'sobre',
  'diferenciais',
  'marcas',
  'segmentos',
  'contato',
] as const

/** Known placeholder values that must never ship to production. */
export const KNOWN_PLACEHOLDERS = {
  whatsapp: '5500000000000',
  phone: '(00) 0 0000-0000',
  cnpj: '00.000.000/0001-00',
  /** Plausible but unconfirmed until the client verifies it. */
  email: 'contato@weynerepresentacoes.com.br',
} as const

const CNPJ_RE = /^\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}$/
const PREENCHER_RE = /PREENCHER/i

function hasUniqueKeys(items: ReadonlyArray<{ key: string }>): boolean {
  return new Set(items.map((i) => i.key)).size === items.length
}

function anchorTargets(nav: ReadonlyArray<NavItem>): string[] {
  return nav.map((n) => n.href.replace(/^#/, ''))
}

/**
 * Structural checks that must always hold — a failure here is a build blocker
 * in every environment.
 */
export function validateContentIntegrity(
  config: LandingPageContent,
): Issue[] {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ level: 'error', message })

  // Exact required counts.
  if (config.stats.length !== 4)
    err(`Expected exactly 4 stats, found ${config.stats.length}.`)
  if (config.differentiators.items.length !== 6)
    err(`Expected exactly 6 differentiators, found ${config.differentiators.items.length}.`)
  if (config.brands.items.length !== 8)
    err(`Expected exactly 8 brands, found ${config.brands.items.length}.`)
  if (config.segments.items.length !== 7)
    err(`Expected exactly 7 segments, found ${config.segments.items.length}.`)

  // Unique keys within each repeated list.
  if (!hasUniqueKeys(config.stats)) err('Duplicate stat keys.')
  if (!hasUniqueKeys(config.differentiators.items)) err('Duplicate differentiator keys.')
  if (!hasUniqueKeys(config.brands.items)) err('Duplicate brand keys.')
  if (!hasUniqueKeys(config.segments.items)) err('Duplicate segment keys.')

  // Unique section IDs.
  if (new Set(SECTION_IDS).size !== SECTION_IDS.length)
    err('Duplicate section IDs.')

  // Every navigation anchor (header + footer) maps to a real section.
  const validTargets = new Set<string>(SECTION_IDS)
  for (const target of [
    ...anchorTargets(config.nav),
    ...anchorTargets(config.footer.nav),
  ]) {
    if (!validTargets.has(target))
      err(`Navigation anchor "#${target}" does not map to a known section.`)
  }

  return issues
}

/**
 * Production-only checks. In development these are surfaced as warnings so the
 * page can still render clearly-marked placeholders; in production they are
 * hard errors.
 */
export function validateProductionReadiness(
  config: LandingPageContent,
): Issue[] {
  const issues: Issue[] = []
  const err = (message: string) => issues.push({ level: 'error', message })
  const warn = (message: string) => issues.push({ level: 'warn', message })
  const c = config.contactInfo

  // WhatsApp number — drives every conversion.
  if (!isUsableWhatsAppNumber(c.whatsappNumber))
    err(`WhatsApp number is missing or a placeholder ("${c.whatsappNumber}").`)

  // Phone display.
  if (c.phoneDisplay === KNOWN_PLACEHOLDERS.phone || PREENCHER_RE.test(c.phoneDisplay))
    err(`Phone display is a placeholder ("${c.phoneDisplay}").`)

  // Email — flagged unconfirmed until verified.
  if (
    c.email === KNOWN_PLACEHOLDERS.email ||
    /example\.(com|org)/i.test(c.email) ||
    PREENCHER_RE.test(c.email)
  )
    err(`Email is unconfirmed or a placeholder ("${c.email}").`)

  // CNPJ.
  if (c.cnpj === KNOWN_PLACEHOLDERS.cnpj || !CNPJ_RE.test(c.cnpj))
    err(`CNPJ is missing, malformed, or a placeholder ("${c.cnpj}").`)

  // Canonical URL + OG image (absolute, https).
  if (!config.seo.canonicalUrl || !/^https:\/\//.test(config.seo.canonicalUrl))
    err('Canonical URL is missing or not an absolute https URL.')
  if (!config.seo.ogImageAbsoluteUrl || !/^https?:\/\//.test(config.seo.ogImageAbsoluteUrl))
    err('Open Graph image absolute URL is missing.')

  // Social links — missing ones are omitted from render; flag for sign-off.
  if (!c.instagramUrl) warn('Instagram URL not provided (icon omitted).')
  if (!c.linkedinUrl) warn('LinkedIn URL not provided (icon omitted).')

  // Catch any stray PREENCHER left in a contact string.
  for (const [field, value] of Object.entries(c)) {
    if (typeof value === 'string' && PREENCHER_RE.test(value))
      err(`Contact field "${field}" still contains PREENCHER.`)
  }

  return issues
}
