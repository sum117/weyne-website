import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  PERFORMANCE_FIXTURE_PROFILES,
  createPerformanceFixture,
  summarizePerformanceFixture,
} from '../../scripts/performance/fixtures'

function digest(value: unknown) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

describe('performance fixtures', () => {
  it('generates the smoke profile deterministically from a seed', () => {
    const first = createPerformanceFixture({ profile: 'smoke', seed: 11 })
    const second = createPerformanceFixture({ profile: 'smoke', seed: 11 })
    const different = createPerformanceFixture({ profile: 'smoke', seed: 12 })

    expect(digest(first)).toBe(digest(second))
    expect(digest(first)).not.toBe(digest(different))
    expect(summarizePerformanceFixture(first)).toEqual({
      tenants: 2,
      representatives: 8,
      clients: 200,
      industries: 12,
      products: 500,
      quotes: 1_000,
      quoteLines: 6_000,
      attachments: 250,
    })
  })

  it('keeps every generated relationship inside the fixture', () => {
    const fixture = createPerformanceFixture({ profile: 'smoke', seed: 42 })
    const tenantIds = new Set(fixture.tenants.map(({ id }) => id))
    const representativeIds = new Set(fixture.representatives.map(({ id }) => id))
    const clientIds = new Set(fixture.clients.map(({ id }) => id))
    const industryIds = new Set(fixture.industries.map(({ id }) => id))
    const productIds = new Set(fixture.products.map(({ id }) => id))
    const quoteIds = new Set(fixture.quotes.map(({ id }) => id))

    expect(fixture.representatives.every(({ tenantId }) => tenantIds.has(tenantId))).toBe(true)
    expect(fixture.clients.every(({ tenantId }) => tenantIds.has(tenantId))).toBe(true)
    expect(fixture.industries.every(({ tenantId }) => tenantIds.has(tenantId))).toBe(true)
    expect(
      fixture.products.every(
        ({ tenantId, industryId }) => tenantIds.has(tenantId) && industryIds.has(industryId),
      ),
    ).toBe(true)
    expect(
      fixture.quotes.every(
        ({ tenantId, representativeId, clientId }) =>
          tenantIds.has(tenantId) &&
          representativeIds.has(representativeId) &&
          clientIds.has(clientId),
      ),
    ).toBe(true)
    expect(
      fixture.quoteLines.every(
        ({ quoteId, productId }) => quoteIds.has(quoteId) && productIds.has(productId),
      ),
    ).toBe(true)
    expect(fixture.attachments.every(({ productId }) => productIds.has(productId))).toBe(true)
  })

  it('publishes bounded profiles and rejects unsupported scales', () => {
    expect(PERFORMANCE_FIXTURE_PROFILES.standard).toEqual({
      tenants: 4,
      representatives: 40,
      clients: 5_000,
      industries: 40,
      products: 10_000,
      quotes: 25_000,
      linesPerQuote: 6,
      attachments: 5_000,
    })
    expect(() =>
      createPerformanceFixture({ profile: 'unbounded' as 'smoke', seed: 1 }),
    ).toThrow(/Unknown performance fixture profile/)
  })
})
