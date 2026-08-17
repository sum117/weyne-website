import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

async function readProjectFile(path: string): Promise<string> {
  return readFile(resolve(root, path), 'utf8')
}

describe('production SSR container packaging', () => {
  it('runs the built runtime as a non-root process with a healthcheck', async () => {
    const dockerfile = await readProjectFile('Dockerfile')

    expect(dockerfile).toContain('COPY dist ./dist')
    expect(dockerfile).toContain('USER node')
    expect(dockerfile).toContain('EXPOSE 3000')
    expect(dockerfile).toContain('/healthz')
    expect(dockerfile).toContain('CMD ["node", "dist/server/runtime.js"]')
  })

  it('keeps Caddy in front of the application runtime', async () => {
    const caddyfile = await readProjectFile('deploy/Caddyfile')
    const compose = await readProjectFile('deploy/docker-compose.weyne.yml')

    expect(caddyfile).toContain('reverse_proxy app:3000')
    expect(compose).toContain('condition: service_healthy')
    expect(compose).toContain('http://127.0.0.1:80/healthz')
  })

  it('provides a credential-free local stack exposed only through Caddy', async () => {
    const compose = await readProjectFile('deploy/docker-compose.local.yml')

    expect(compose).toContain('build:')
    expect(compose).toContain('dockerfile: Dockerfile')
    expect(compose).toContain('DATABASE_URL: postgresql://local:local@database.invalid:5432/weyne')
    expect(compose).toContain('${WEYNE_HTTP_PORT:-8080}:80')
    expect(compose).toContain('./Caddyfile:/etc/caddy/Caddyfile:ro')
    expect(compose).not.toContain('cloudflared')
    expect(compose).not.toContain('CLOUDFLARE_TUNNEL_TOKEN')
  })

  it('runs a browser-backed production stack smoke check in CI', async () => {
    const packageJson = await readProjectFile('package.json')
    const smokeConfig = await readProjectFile('playwright.production.config.ts')
    const smokeTest = await readProjectFile('tests/e2e/production-smoke.spec.ts')
    const ci = await readProjectFile('.github/workflows/ci.yml')

    expect(packageJson).toContain('"test:production-smoke"')
    expect(smokeConfig).toContain("testMatch: 'production-smoke.spec.ts'")
    expect(smokeTest).toContain("page.goto('/app')")
    expect(smokeTest).toContain('cache-control')
    expect(ci).toContain('playwright install --with-deps chromium')
    expect(ci).toContain('bun run test:production-smoke')
  })

  it('keeps scheduled PostgreSQL operations independent and network-explicit', async () => {
    const operations = await readProjectFile('deploy/docker-compose.postgres-ops.yml')
    const environment = await readProjectFile('deploy/postgres-backup.env.example')
    const service = await readProjectFile(
      'deploy/systemd/weyne-postgres-backup.service',
    )

    expect(service).toContain('-f docker-compose.postgres-ops.yml')
    expect(service).not.toContain('docker-compose.weyne.yml')
    expect(operations).toContain(
      'PGHOST: ${POSTGRES_HOST:?set the PostgreSQL host or private-network alias}',
    )
    expect(operations).toContain(
      'name: ${POSTGRES_NETWORK:?set the private Docker network that reaches PostgreSQL}',
    )
    expect(environment).toContain('POSTGRES_HOST=database')
    expect(environment).toContain('POSTGRES_NETWORK=')
    expect(environment).not.toContain('WEYNE_IMAGE=')
    expect(environment).not.toContain('DATABASE_URL=')
    expect(environment).not.toContain('CLOUDFLARE_TUNNEL_TOKEN=')
  })
})
