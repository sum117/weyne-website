import { describe, expect, it } from 'vitest'
import { createSyntheticCatalogFactory } from '../support/factories'
import {
  redactDatabaseUrl,
  resolveTestDatabaseUrl,
} from '../support/postgres-harness'

describe('PostgreSQL integration safety', () => {
  it('never falls back to the application DATABASE_URL', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        DATABASE_URL: 'postgresql://production.example/weyne',
      }),
    ).toThrow(/TEST_DATABASE_URL is required/)
  })

  it('rejects a connection whose database name is not explicitly test-scoped', () => {
    expect(() =>
      resolveTestDatabaseUrl({
        TEST_DATABASE_URL: 'postgresql://user:super-secret@db.example/weyne',
      }),
    ).toThrow(/explicitly test-scoped database/)
  })

  it('redacts credentials from connection diagnostics', () => {
    const redacted = redactDatabaseUrl(
      'postgresql://integration:super-secret@localhost:5432/weyne_test',
    )

    expect(redacted).toContain('REDACTED')
    expect(redacted).not.toContain('super-secret')
  })
})

describe('synthetic business factories', () => {
  it('uses conspicuously non-production names, identifiers, and addresses', () => {
    const business = createSyntheticCatalogFactory('safety').business()

    expect(business.legalName).toContain('FICTÍCIA TESTE')
    expect(business.taxIdentifier).toContain('TEST-CNPJ')
    expect(business.email.endsWith('@example.invalid')).toBe(true)
    expect(business.address.street).toContain('Fictícia')
    expect(business.address.state).toBe('ZZ')
  })
})
