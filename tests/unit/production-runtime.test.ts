import { describe, expect, it } from 'vitest'
import {
  cacheControlForPath,
  isImmutableAssetPath,
  productionSecurityHeaders,
} from '../../scripts/production-server'

describe('production runtime caching', () => {
  it('marks only content-hashed build assets as immutable', () => {
    expect(isImmutableAssetPath('/assets/app-Dj0nQNAb.css')).toBe(true)
    expect(isImmutableAssetPath('/assets/index-9xfzLw9B.js')).toBe(true)
    expect(isImmutableAssetPath('/assets/app.css')).toBe(false)
    expect(isImmutableAssetPath('/images/logo.png')).toBe(false)
  })

  it('never gives HTML an immutable cache policy', () => {
    expect(cacheControlForPath('/', 'text/html; charset=utf-8')).toBe(
      'no-cache',
    )
    expect(cacheControlForPath('/app', 'text/html; charset=utf-8')).toBe(
      'no-cache',
    )
  })

  it('revalidates unhashed public assets', () => {
    expect(cacheControlForPath('/images/logo.png', 'image/png')).toBe(
      'public, max-age=0, must-revalidate',
    )
  })
})

describe('production runtime security headers', () => {
  it('applies a restrictive browser policy to every response', () => {
    expect(productionSecurityHeaders).toMatchObject({
      'content-security-policy': expect.stringContaining("default-src 'self'"),
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-resource-policy': 'same-origin',
      'permissions-policy': expect.stringContaining('camera=()'),
      'referrer-policy': 'strict-origin-when-cross-origin',
      'strict-transport-security': 'max-age=31536000; includeSubDomains',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    })
  })

  it('blocks embedding, plugins, foreign form targets, and insecure loads', () => {
    const policy = productionSecurityHeaders['content-security-policy']

    expect(policy).toContain("frame-ancestors 'none'")
    expect(policy).toContain("object-src 'none'")
    expect(policy).toContain("form-action 'self'")
    expect(policy).toContain('upgrade-insecure-requests')
    expect(policy).not.toContain('script-src *')
    expect(policy).not.toContain("'unsafe-eval'")
  })
})