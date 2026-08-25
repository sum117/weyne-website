import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

describe('RBAC service-boundary policy', () => {
  it('uses centralized capabilities rather than local actor-role comparisons', async () => {
    const sources = await Promise.all(
      [
        'src/features/app/users/user-management.service.server.ts',
        'src/lib/catalog/authorization.server.ts',
        'src/lib/settings/document-logo-service.server.ts',
      ].map(async (path) => ({ path, source: await readFile(resolve(root, path), 'utf8') })),
    )

    for (const { path, source } of sources) {
      expect(source, path).toContain('hasCapability')
      expect(source, path).not.toMatch(/actor\.role\s*!?={2,3}\s*['"](?:admin|representative|read_only)['"]/)
    }
  })

  it('checks settings reads and writes against their distinct matrix capabilities', async () => {
    const source = await readFile(resolve(root, 'src/lib/settings/settings-service.server.ts'), 'utf8')

    expect(source).toContain("authorizeActor(actor, 'settings.read')")
    expect(source).toContain("authorizeActor(actor, 'settings.update')")
  })
})