import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Executable guard for the capability-driven UI contract (card `t_d3e33344`).
 *
 * Two failure modes are pinned here:
 *
 * 1. Capability-gated routes must use the shared `requireCapableRoute` guard
 *    with an explicit matrix capability, not re-implement the check inline.
 * 2. Components and route code must never compare role strings directly
 *    (`role === 'admin'`, ternaries on `'representative'`/`'read_only'`) —
 *    visibility is derived through `capabilities.ts`. The server boundary
 *    (`*.server.ts`, domain services) legitimately branches on roles for
 *    scope/projection and stays out of this census.
 */

const ROUTES_DIRECTORY = resolve(process.cwd(), 'src/routes')

async function routeFiles(): Promise<Array<{ name: string; source: string }>> {
  const entries = await readdir(ROUTES_DIRECTORY, { withFileTypes: true })
  const files: Array<{ name: string; source: string }> = []
  for (const entry of entries) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue
    files.push({
      name: entry.name,
      source: await readFile(resolve(ROUTES_DIRECTORY, entry.name), 'utf8'),
    })
  }
  return files
}

/** Route paths that gate on a capability beyond authentication. */
const CAPABILITY_GATED_ROUTES = [
  {
    file: 'app_.configuracoes_.auditoria.tsx',
    capability: 'audit.view',
  },
  {
    file: 'app_.produtos.tsx',
    capability: 'product.view',
  },
] as const

describe('capability route guards', () => {
  it('finds the routes it is supposed to police', async () => {
    const files = await routeFiles()
    expect(files.length).toBeGreaterThan(3)
  })

  it.each(CAPABILITY_GATED_ROUTES)(
    'gates $file on the $capability capability via requireCapableRoute',
    async ({ file, capability }) => {
      const source = await readFile(
        resolve(ROUTES_DIRECTORY, file),
        'utf8',
      )
      expect(source).toContain('requireCapableRoute(location')
      expect(source).toContain(`'${capability}'`)
    },
  )

  it('never compares raw role strings in route code', async () => {
    const files = await routeFiles()
    const offenders = files.filter((file) =>
      /role\s*===\s*['"](?:admin|representative|read_only)['"]/.test(
        file.source,
      ),
    )
    expect(
      offenders.map((file) => file.name),
      'route code must consult capabilities.ts instead of comparing roles',
    ).toEqual([])
  })
})
