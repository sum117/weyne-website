import { describe, expect, it } from 'vitest'
import {
  authorizeCatalogAction,
  type CatalogAction,
  type CatalogActor,
} from '@/lib/catalog/authorization.server'

const actors = {
  admin: { id: 'admin-a', role: 'admin' },
  representative: { id: 'representative-a', role: 'representative' },
  readOnly: { id: 'reader-a', role: 'read_only' },
} satisfies Record<string, CatalogActor>

const readActions = [
  'industry.read',
  'industry.search',
  'product.read',
  'product.search',
  'price.read',
] as const satisfies readonly CatalogAction[]

const historyActions = ['price.history.read'] as const satisfies readonly CatalogAction[]
const writeActions = [
  'industry.create',
  'industry.update',
  'industry.archive',
  'product.create',
  'product.update',
  'product.archive',
  'price.update',
] as const satisfies readonly CatalogAction[]

describe('catalog authorization policy', () => {
  it.each(readActions)('allows every existing role to perform %s', (action) => {
    expect(authorizeCatalogAction(actors.admin, action)).toBe('allow')
    expect(authorizeCatalogAction(actors.representative, action)).toBe('allow')
    expect(authorizeCatalogAction(actors.readOnly, action)).toBe('allow')
  })

  it.each(historyActions)('allows commercial roles but denies read-only users for %s', (action) => {
    expect(authorizeCatalogAction(actors.admin, action)).toBe('allow')
    expect(authorizeCatalogAction(actors.representative, action)).toBe('allow')
    expect(authorizeCatalogAction(actors.readOnly, action)).toBe('forbidden')
  })

  it.each(writeActions)('allows only administrators to perform %s', (action) => {
    expect(authorizeCatalogAction(actors.admin, action)).toBe('allow')
    expect(authorizeCatalogAction(actors.representative, action)).toBe('forbidden')
    expect(authorizeCatalogAction(actors.readOnly, action)).toBe('forbidden')
  })
})
