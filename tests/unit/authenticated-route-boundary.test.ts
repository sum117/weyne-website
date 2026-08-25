import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Executable guard for the authenticated route boundary.
 *
 * The acceptance criterion "unauthenticated `/app` redirects to login" is one
 * `beforeLoad` away from silently regressing: a future card adding
 * a nested child route without the parent layout would ship an open
 * application route, and no existing test would notice. This file fails the
 * build in that case.
 *
 * It also pins the inverse: the public landing route and the Better Auth
 * protocol route must NOT be guarded.
 */

const ROUTES_DIRECTORY = resolve(process.cwd(), 'src/routes')
const GENERATED_ROUTE_TREE = resolve(process.cwd(), 'src/routeTree.gen.ts')
const GUARD_CALLS = [
  'requireAuthenticatedRoute(location)',
  'requireCapableRoute(location',
]

async function routeFiles(
  directory = ROUTES_DIRECTORY,
  relativeDirectory = '',
): Promise<Array<{ name: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const files: Array<{ name: string; source: string }> = []
  for (const entry of entries) {
    const relativeName = `${relativeDirectory}${entry.name}`
    if (entry.isDirectory()) {
      files.push(
        ...(await routeFiles(resolve(directory, entry.name), `${relativeName}/`)),
      )
    } else if (/\.tsx?$/.test(entry.name)) {
      files.push({
        name: relativeName,
        source: await readFile(resolve(directory, entry.name), 'utf8'),
      })
    }
  }
  return files
}

const files = await routeFiles()

/** Every route file whose URL path lives under `/app`. */
const applicationRoutes = files.filter(
  (file) => file.name === 'app.tsx' || file.name.startsWith('app/'),
)

describe('authenticated route boundary', () => {
  it('finds the route directory it is supposed to guard', () => {
    expect(files.length).toBeGreaterThan(3)
    expect(applicationRoutes.length).toBeGreaterThan(0)
  })

  it('guards the shared /app layout before it renders nested content', () => {
    const layout = files.find((file) => file.name === 'app.tsx')

    // `beforeLoad` runs before the loader and before any render, so an
    // anonymous visitor never sees protected markup. A component-level
    // check would flash the content first.
    expect(layout?.source).toMatch(
      /beforeLoad:\s*\(\{\s*location\s*\}\)\s*=>\s*requireAuthenticatedRoute\(location\)/,
    )
    expect(layout?.source).toContain('<Outlet />')
  })

  it('keeps nested application routes under the guarded layout', async () => {
    const nestedRoutes = applicationRoutes.filter((file) => file.name.startsWith('app/'))
    const generatedTree = await readFile(GENERATED_ROUTE_TREE, 'utf8')

    expect(nestedRoutes.length).toBeGreaterThan(0)
    expect(
      files.filter((file) => file.name.startsWith('app_.')).map((file) => file.name),
      'legacy flat /app route files bypass the shared layout',
    ).toEqual([])
    expect(generatedTree).toContain('getParentRoute: () => AppRoute')
    expect(generatedTree).toContain('AppRoute._addFileChildren')

    for (const file of nestedRoutes) {
      expect(file.source, file.name).toContain('createFileRoute(')
    }
  })

  it('leaves the public landing route and the auth protocol route open', () => {
    const index = files.find((file) => file.name === 'index.tsx')
    const authRoute = files.find((file) => file.name === 'api.auth.$.ts')

    expect(index?.source).not.toContain(GUARD_CALLS[0])
    // Guarding the login endpoint itself would make signing in impossible.
    expect(authRoute?.source).not.toContain(GUARD_CALLS[0])
  })

  it('keeps the login route reachable while anonymous', () => {
    const login = files.find((file) => file.name === 'entrar.tsx')
    expect(login).toBeDefined()
    expect(login!.source).not.toContain(GUARD_CALLS[0])
  })

  it('marks every application route noindex', () => {
    for (const file of [...applicationRoutes, files.find((f) => f.name === 'entrar.tsx')!]) {
      expect(file.source, file.name).toContain('noindex, nofollow')
    }
  })
})
