/**
 * Runs the quote workflow acceptance suite against a disposable PostgreSQL
 * container on an EPHEMERAL host port (a fixed port gets held by stale
 * containers from crashed runs), then tears the container down.
 *
 *   bun scripts/run-quote-workflow.ts [-- ...playwright args]
 */
import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:net'
import postgres from 'postgres'

const containerName = `weyne-workflow-e2e-${randomUUID().slice(0, 8)}`
const password = `workflow-${randomUUID().replaceAll('-', '')}`
let managedContainer = false

function docker(...args: string[]) {
  return spawnSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

function cleanup() {
  if (!managedContainer) return
  docker('rm', '--force', containerName)
  managedContainer = false
}

function fail(message: string): never {
  throw new Error(message.trim())
}

let databaseUrl = process.env.WORKFLOW_DATABASE_URL?.trim() ?? ''

if (process.env.WORKFLOW_DATABASE_URL?.trim()) {
  databaseUrl = process.env.WORKFLOW_DATABASE_URL.trim()
} else {
  const started = docker(
    'run', '--detach', '--rm', '--name', containerName,
    '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=weyne_workflow_e2e',
    '--publish', '127.0.0.1::5432',
    'postgres:17.6-alpine',
  )
  if (started.status !== 0) {
    fail(`Unable to start the workflow PostgreSQL container.\n${started.stderr}`)
  }
  managedContainer = true

  let ready = false
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const probe = docker('exec', containerName, 'pg_isready', '-U', 'postgres', '-d', 'weyne_workflow_e2e')
    if (probe.status === 0) { ready = true; break }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  if (!ready) {
    cleanup()
    fail('The workflow PostgreSQL container did not become ready within 60 seconds')
  }

  const portResult = docker('port', containerName, '5432/tcp')
  const port = portResult.stdout.trim().match(/:(\d+)$/)?.[1]
  if (portResult.status !== 0 || !port) {
    cleanup()
    fail(`Unable to resolve the ephemeral workflow PostgreSQL port.\n${portResult.stderr}`)
  }

  const url = new URL(`postgresql://postgres@127.0.0.1:${port}/weyne_workflow_e2e`)
  url.password = password
  databaseUrl = url.toString()

  // pg_isready can pass while the database is still rejecting backends during
  // startup; require an actual query against the RESOLVED URL to succeed.
  let queryOk = false
  for (let attempt = 0; attempt < 60 && !queryOk; attempt += 1) {
    const probe = postgres(databaseUrl, { max: 1, connect_timeout: 2, onnotice: () => undefined })
    try {
      await probe`SELECT 1`
      queryOk = true
      await probe.end({ timeout: 1 })
    } catch {
      await probe.end({ timeout: 1 }).catch(() => undefined)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
  if (!queryOk) {
    cleanup()
    fail('The workflow PostgreSQL container never accepted a test query')
  }
}

const exitCleanup = () => cleanup()
process.once('exit', exitCleanup)
process.once('SIGINT', () => { cleanup(); process.exit(130) })
process.once('SIGTERM', () => { cleanup(); process.exit(143) })

async function reserveLoopbackPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to reserve a loopback port')))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

// Apply migrations + seed before the suite boots so the api-server starts on
// an already-prepared schema.
await run('bun', ['tests/quote-workflow/prepare-database.ts'])

// Playwright starts the API and Vite fixture as separate processes. Select
// unused loopback ports for each invocation so stale local dev servers cannot
// block this disposable acceptance suite.
const apiPort = await reserveLoopbackPort()
const fixturePort = await reserveLoopbackPort()
const workflowEnvironment = {
  ...process.env,
  WORKFLOW_DATABASE_URL: databaseUrl,
  WORKFLOW_API_PORT: String(apiPort),
  WORKFLOW_FIXTURE_PORT: String(fixturePort),
  WORKFLOW_FIXTURE_ORIGIN: `http://127.0.0.1:${fixturePort}`,
  WORKFLOW_FIXTURE_URL: `http://127.0.0.1:${fixturePort}/fixture.html`,
  VITE_WORKFLOW_API_URL: `http://127.0.0.1:${apiPort}`,
}

const playwrightArgs = process.argv.slice(2)
const playwrightCommand = process.execPath

try {
  process.exitCode = await new Promise<number>((resolve, reject) => {
    const test = spawn(
      playwrightCommand,
      [
        'x', 'playwright', 'test',
        '--config=playwright.quote-workflow.config.ts',
        '--project=chromium',
        ...playwrightArgs,
      ],
      {
        cwd: process.cwd(),
        env: workflowEnvironment,
        stdio: 'inherit',
        shell: false,
      },
    )
    test.once('error', reject)
    test.once('exit', (code) => resolve(code ?? 1))
  })
} finally {
  cleanup()
}

function run(command: string, args: string[]): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: { ...process.env, WORKFLOW_DATABASE_URL: databaseUrl },
      stdio: 'inherit',
      shell: process.platform === 'win32',
    })
    child.once('error', reject)
    child.once('exit', (code) => (code === 0 ? resolve(0) : process.exit(code ?? 1)))
  })
}
