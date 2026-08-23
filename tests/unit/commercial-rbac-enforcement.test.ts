import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Enforcement census for the commercial RBAC card (t_03a12212).
 *
 * Every commercial server-function boundary MUST re-derive the session
 * through the centralized helpers and name a capability — a fail-closed
 * `authenticate() → null` stub or a client-supplied actor schema means the
 * endpoint is either dead (unreachable for real users) or forgeable. This
 * census fails the build if any file regresses.
 */

const ROOT = resolve(import.meta.dirname, '../..')

const BOUNDARIES: Readonly<Record<string, readonly string[]>> = {
  'src/features/app/orders/order.functions.ts': [
    'requireCommercialContext',
    'UnauthenticatedError',
    "'order.view'",
  ],
  'src/features/app/orders/order-attachment.functions.ts': [
    'requireCommercialContext',
    "'order.view_attachment'",
    "'order.add_attachment'",
    "'order.remove_attachment'",
    'DENIAL_MESSAGES.FORBIDDEN',
  ],
  'src/features/app/quotes/quote-pdf.functions.ts': [
    'requireCommercialContext',
    "'quote.generate_pdf'",
    "'quote.view'",
  ],
  'src/features/app/reports/report.functions.ts': [
    'requireCommercialContext',
    "'order.view'",
  ],
  'src/features/app/reports/commission-report.functions.ts': [
    'requireCommercialContext',
    "'order.view'",
  ],
  'src/features/app/reports/report-export.functions.ts': [
    'requireCommercialContext',
    "'export.orders'",
    'DENIAL_MESSAGES.FORBIDDEN',
  ],
}

/** Services that must decide through the centralized command authorization. */
const SERVICE_RULES: Readonly<Record<string, readonly string[]>> = {
  'src/lib/quotes/lifecycle.server.ts': ['isQuoteCommandAuthorized'],
  'src/lib/quotes/duplication.server.ts': ['isQuoteCommandAuthorized'],
  'src/lib/orders/quote-conversion.server.ts': ['evaluateQuoteCommand'],
}

async function readRepoFile(path: string): Promise<string> {
  return readFile(resolve(ROOT, path), 'utf8')
}

describe('commercial RBAC enforcement census', () => {
  it('every commercial boundary names the centralized scope helper and its capabilities', async () => {
    for (const [path, needles] of Object.entries(BOUNDARIES)) {
      const source = await readRepoFile(path)
      for (const needle of needles) {
        expect(
          source.includes(needle),
          `${path} must reference ${needle}`,
        ).toBe(true)
      }
    }
  })

  it('no commercial boundary trusts a client-supplied actor payload', async () => {
    for (const path of Object.keys(BOUNDARIES)) {
      const source = await readRepoFile(path)
      expect(
        /actorSchema|actor:\s*z\.object/.test(source),
        `${path} must not accept an actor in the request payload`,
      ).toBe(false)
    }
  })

  it('no commercial boundary still carries the fail-closed null stub', async () => {
    const stubPattern = /function authenticate\(\)[^)]*{\s*return null/
    const filesWithStubs = [
      ...Object.keys(BOUNDARIES),
      'src/features/app/reports/commission-report.functions.ts',
    ]
    for (const path of new Set(filesWithStubs)) {
      const source = await readRepoFile(path)
      expect(stubPattern.test(source), `${path} still has an authenticate() → null stub`).toBe(false)
    }
  })

  it('quote lifecycle, duplication, and conversion decide via the matrix-backed helper', async () => {
    for (const [path, needles] of Object.entries(SERVICE_RULES)) {
      const source = await readRepoFile(path)
      for (const needle of needles) {
        expect(source.includes(needle), `${path} must use ${needle}`).toBe(true)
      }
    }
  })

  it('the legacy permission-string authorizer is fully retired from services', async () => {
    for (const path of Object.keys(SERVICE_RULES)) {
      const source = await readRepoFile(path)
      expect(
        source.includes('isQuoteMutationAuthorized'),
        `${path} must not route decisions through permission strings`,
      ).toBe(false)
    }
  })

  it('exports stay denied for every role in Phase 1', async () => {
    const source = await readRepoFile('src/features/app/reports/report-export.functions.ts')
    // The Phase 1 denial gate must exist and be unconditional per role.
    expect(source.includes("'export.orders'")).toBe(true)
    expect(source.includes('requireExportCapability')).toBe(true)
  })
})
