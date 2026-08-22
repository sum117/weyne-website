import { describe, expect, it } from 'vitest'
import {
  AUTH_BASE_PATH,
  DEVELOPMENT_FALLBACK_KEY,
  MINIMUM_SECRET_LENGTH,
  parseAuthConfig,
} from '@/lib/auth/config.server'

const STRONG_SECRET = 'z8Qk4tR2wLp9XvB6nHc3JdF7mYs5KgTa'
const PRODUCTION = { NODE_ENV: 'production' } as const

describe('parseAuthConfig — development', () => {
  it('runs with no configuration at all', () => {
    const config = parseAuthConfig({})

    expect(config).toEqual({
      secret: DEVELOPMENT_FALLBACK_KEY,
      baseURL: `http://localhost:3000${AUTH_BASE_PATH}`,
      basePath: AUTH_BASE_PATH,
      useSecureCookies: false,
      isProduction: false,
    })
  })

  it('keeps the fallback key long enough for Better Auth', () => {
    expect(DEVELOPMENT_FALLBACK_KEY.length).toBeGreaterThanOrEqual(
      MINIMUM_SECRET_LENGTH,
    )
  })

  it('marks cookies Secure whenever the origin is https, even outside production', () => {
    expect(
      parseAuthConfig({ BETTER_AUTH_URL: 'https://staging.example.test' })
        .useSecureCookies,
    ).toBe(true)
  })

  it('derives the base URL from the origin and drops any configured path', () => {
    expect(
      parseAuthConfig({ BETTER_AUTH_URL: 'http://localhost:4000/ignored' })
        .baseURL,
    ).toBe(`http://localhost:4000${AUTH_BASE_PATH}`)
  })
})

describe('parseAuthConfig — production fails closed', () => {
  it.each([
    [{ ...PRODUCTION }, 'BETTER_AUTH_SECRET is required in production'],
    [
      { ...PRODUCTION, BETTER_AUTH_SECRET: DEVELOPMENT_FALLBACK_KEY },
      'development fallback',
    ],
    [
      { ...PRODUCTION, BETTER_AUTH_SECRET: 'too-short' },
      `at least ${MINIMUM_SECRET_LENGTH} characters`,
    ],
    [
      { ...PRODUCTION, BETTER_AUTH_SECRET: STRONG_SECRET },
      'BETTER_AUTH_URL is required in production',
    ],
    [
      {
        ...PRODUCTION,
        BETTER_AUTH_SECRET: STRONG_SECRET,
        BETTER_AUTH_URL: 'http://weyne.example',
      },
      'must use https in production',
    ],
    [
      {
        ...PRODUCTION,
        BETTER_AUTH_SECRET: STRONG_SECRET,
        BETTER_AUTH_URL: 'not-a-url',
      },
      'absolute http(s) URL',
    ],
  ])('rejects %#', (environment, message) => {
    expect(() => parseAuthConfig(environment)).toThrow(message)
  })

  it('never echoes the secret in an error message', () => {
    const secret = 'short-but-recognizable-secret-value-marker'
    try {
      parseAuthConfig({ ...PRODUCTION, BETTER_AUTH_SECRET: secret })
      expect.unreachable('expected a configuration error')
    } catch (error) {
      expect(String(error)).not.toContain(secret)
      expect(String(error)).toContain('BETTER_AUTH_URL')
    }
  })

  it('accepts a complete production environment with secure cookies', () => {
    expect(
      parseAuthConfig({
        ...PRODUCTION,
        BETTER_AUTH_SECRET: STRONG_SECRET,
        BETTER_AUTH_URL: 'https://weynerepresentacoes.com.br',
      }),
    ).toEqual({
      secret: STRONG_SECRET,
      baseURL: `https://weynerepresentacoes.com.br${AUTH_BASE_PATH}`,
      basePath: AUTH_BASE_PATH,
      useSecureCookies: true,
      isProduction: true,
    })
  })
})
