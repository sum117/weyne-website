import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Executable guard for the authenticated route boundary.
 *
 * The acceptance criterion "unauthenticated `/app` redirects to login" is one
 * `beforeLoad` away from silently regressing: a future card adding
 * `src/routes/app_.clientes.tsx` without the guard would ship an open
 * application route, and no existing test would notice. This file fails the
 * build in that case.
 *
 * It also pins the inverse: the public landing route and the Better Auth
 * protocol route must NOT be guarded.
 */

const ROUTES_DIRECTORY = resolve(process.cwd(), 'src/routes')
const GUARD_CALL = 'requireAuthenticatedRoute(location)'

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

const files = await routeFiles()

/** Every route file whose URL path lives under `/app`. */
const applicationRoutes = files.filter(
  (file) => file.name === 'app.tsx' || file.name.startsWith('app_.'),
)

describe('authenticated route boundary', () => {
  it('finds the route directory it is supposed to guard', () => {
    expect(files.length).toBeGreaterThan(3)
    expect(applicationRoutes.length).toBeGreaterThan(0)
  })

  it('guards every /app route with the shared server-side check', () => {
    const unguarded = applicationRoutes
      .filter((file) => !file.source.includes(GUARD_CALL))
      .map((file) => file.name)

    expect(
      unguarded,
      'every route under /app must call requireAuthenticatedRoute in beforeLoad',
    ).toEqual([])
  })

  it('runs the guard in beforeLoad, never in the component', () => {
    for (const file of applicationRoutes) {
      // `beforeLoad` runs before the loader and before any render, so an
      // anonymous visitor never sees protected markup. A component-level
      // check would flash the content first.
      expect(file.source, file.name).toMatch(
        /beforeLoad:\s*\(\{\s*location\s*\}\)\s*=>\s*requireAuthenticatedRoute\(location\)/,
      )
    }
  })

  it('leaves the public landing route and the auth protocol route open', () => {
    const index = files.find((file) => file.name === 'index.tsx')
    const authRoute = files.find((file) => file.name === 'api.auth.$.ts')

    expect(index?.source).not.toContain(GUARD_CALL)
    // Guarding the login endpoint itself would make signing in impossible.
    expect(authRoute?.source).not.toContain(GUARD_CALL)
  })

  it('keeps the login route reachable while anonymous', () => {
    const login = files.find((file) => file.name === 'entrar.tsx')
    expect(login).toBeDefined()
    expect(login!.source).not.toContain(GUARD_CALL)
  })

  it('marks every application route noindex', () => {
    for (const file of [...applicationRoutes, files.find((f) => f.name === 'entrar.tsx')!]) {
      expect(file.source, file.name).toContain('noindex, nofollow')
    }
  })
})
