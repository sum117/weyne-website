import { describe, expect, it } from 'vitest'
import {
  AUTH_BASE_PATH,
  DEFAULT_AUTHENTICATED_PATH,
  LOGIN_PATH,
  sanitizeRedirectPath,
} from '@/lib/auth/contract'

/**
 * The isomorphic auth contract is the ONE auth module the browser is allowed
 * to load, so its guarantees are asserted directly rather than through a
 * route.
 */

describe('auth contract constants', () => {
  it('pins the protocol mount point and the public paths', () => {
    expect(AUTH_BASE_PATH).toBe('/api/auth')
    expect(LOGIN_PATH).toBe('/entrar')
    expect(DEFAULT_AUTHENTICATED_PATH).toBe('/app')
  })
})

describe('sanitizeRedirectPath', () => {
  it('keeps a same-origin path, including its query and hash', () => {
    expect(sanitizeRedirectPath('/app')).toBe('/app')
    expect(sanitizeRedirectPath('/app/relatorios?tab=produtos')).toBe(
      '/app/relatorios?tab=produtos',
    )
    expect(sanitizeRedirectPath('/app#secao')).toBe('/app#secao')
  })

  it.each([
    ['a protocol-relative URL', '//evil.example/app'],
    ['a backslash-escaped authority', '/\\evil.example'],
    ['an absolute https URL', 'https://evil.example/app'],
    ['an absolute http URL', 'http://evil.example/app'],
    ['a scheme-less host', 'evil.example/app'],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a data URL', 'data:text/html,<script>alert(1)</script>'],
  ])('refuses %s', (_label, value) => {
    expect(sanitizeRedirectPath(value)).toBe(DEFAULT_AUTHENTICATED_PATH)
  })

  it.each([undefined, null, 42, {}, [], true])(
    'falls back for the non-string value %o',
    (value) => {
      expect(sanitizeRedirectPath(value)).toBe(DEFAULT_AUTHENTICATED_PATH)
    },
  )

  it('never sends a signed-in visitor back to the login page', () => {
    expect(sanitizeRedirectPath(LOGIN_PATH)).toBe(DEFAULT_AUTHENTICATED_PATH)
    expect(sanitizeRedirectPath(`${LOGIN_PATH}?redirect=%2Fapp`)).toBe(
      DEFAULT_AUTHENTICATED_PATH,
    )
  })

  it('allows a path that merely starts with the login path segment', () => {
    // `/entrarada` is a different route, not the login page.
    expect(sanitizeRedirectPath('/entrarada')).toBe('/entrarada')
  })
})
