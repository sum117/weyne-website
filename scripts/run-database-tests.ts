import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { resolveTestDatabaseUrl } from '../tests/support/postgres-harness'

const configuredUrl = process.env.TEST_DATABASE_URL?.trim()
const containerName = `weyne-postgres-test-${randomUUID().slice(0, 8)}`
let managedContainer = false

function docker(...args: string[]) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function cleanup() {
  if (!managedContainer) return
  docker('rm', '--force', containerName)
  managedContainer = false
}

function fail(message: string): never {
  throw new Error(message.trim())
}

let testDatabaseUrl: string

if (configuredUrl) {
  testDatabaseUrl = resolveTestDatabaseUrl({ TEST_DATABASE_URL: configuredUrl })
} else {
  const password = `test-only-${randomUUID().replaceAll('-', '')}`
  const started = docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_DB=weyne_test',
    '--publish',
    '127.0.0.1::5432',
    'postgres:17.6-alpine',
  )

  if (started.status !== 0) {
    fail(
      `Unable to start the ephemeral PostgreSQL test container. Set TEST_DATABASE_URL to an explicitly test-scoped database or start Docker.\n${started.stderr}`,
    )
  }
  managedContainer = true

  let ready = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = docker('exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'weyne_test')
    if (probe.status === 0) {
      ready = true
      break
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }

  if (!ready) {
    cleanup()
    fail('The ephemeral PostgreSQL test container did not become ready within 15 seconds')
  }

  const portResult = docker('port', containerName, '5432/tcp')
  const port = portResult.stdout.trim().match(/:(\d+)$/)?.[1]
  if (portResult.status !== 0 || !port) {
    cleanup()
    fail(`Unable to resolve the ephemeral PostgreSQL test port.\n${portResult.stderr}`)
  }

  const generatedUrl = new URL(`postgresql://postgres@127.0.0.1:${port}/weyne_test`)
  generatedUrl.password = password
  testDatabaseUrl = generatedUrl.toString()
}

const exitCleanup = () => cleanup()
process.once('exit', exitCleanup)
process.once('SIGINT', () => {
  cleanup()
  process.exit(130)
})
process.once('SIGTERM', () => {
  cleanup()
  process.exit(143)
})

try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const tests = spawn(
      process.execPath,
      [
        'x',
        'vitest',
        'run',
        '--config',
        'vitest.integration.config.ts',
        ...process.argv.slice(2),
      ],
      {
        cwd: process.cwd(),
        env: { ...process.env, TEST_DATABASE_URL: testDatabaseUrl },
        stdio: 'inherit',
      },
    )
    tests.once('error', reject)
    tests.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  process.off('exit', exitCleanup)
  cleanup()
}