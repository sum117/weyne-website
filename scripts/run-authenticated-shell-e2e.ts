import { randomUUID } from 'node:crypto'
import { spawn, spawnSync } from 'node:child_process'
import {
  AUTHENTICATED_SHELL_BASE_URL,
  AUDIT_E2E_SCHEMA,
} from '../tests/e2e/authenticated-shell.fixture'

const containerName = `weyne-authenticated-shell-e2e-${randomUUID().slice(0, 8)}`
const databaseName = 'weyne_authenticated_shell_test'
const databaseUser = 'postgres'
const databasePassword = `e2e-only-${randomUUID().replaceAll('-', '')}`
let containerStarted = false

function docker(...args: string[]) {
  return spawnSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function fail(message: string): never {
  throw new Error(message.trim())
}

async function run(command: string, args: string[], environment: NodeJS.ProcessEnv): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: environment,
      stdio: 'inherit',
    })
    child.once('error', reject)
    child.once('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? 'an unknown status'}`))
    })
  })
}

async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const probe = docker('exec', containerName, 'pg_isready', '-U', databaseUser, '-d', databaseName)
    if (probe.status === 0) return
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  fail('Authenticated-shell e2e database did not become ready within 15 seconds')
}

function cleanup() {
  if (!containerStarted) return
  docker('rm', '--force', containerName)
  containerStarted = false
}

try {
  const started = docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    containerName,
    '--env',
    `POSTGRES_DB=${databaseName}`,
    '--env',
    `POSTGRES_PASSWORD=${databasePassword}`,
    '--publish',
    '127.0.0.1::5432',
    'postgres:17.6-alpine',
  )
  if (started.status !== 0) {
    fail(`Unable to start authenticated-shell e2e database.\n${started.stderr}`)
  }
  containerStarted = true
  await waitForDatabase()

  const port = docker('port', containerName, '5432/tcp').stdout.trim().match(/:(\d+)$/)?.[1]
  if (!port) fail('Unable to resolve the authenticated-shell e2e database port')

  const databaseUrl = new URL(`postgresql://${databaseUser}@127.0.0.1:${port}/${databaseName}`)
  databaseUrl.password = databasePassword
  const environment = {
    ...process.env,
    BETTER_AUTH_URL: AUTHENTICATED_SHELL_BASE_URL,
    DATABASE_URL: databaseUrl.toString(),
    E2E_DATABASE_URL: databaseUrl.toString(),
    NODE_ENV: 'development',
    WEYNE_DB_SCHEMA: AUDIT_E2E_SCHEMA,
  }

  await run(process.execPath, ['scripts/prepare-authenticated-shell-e2e.ts'], environment)
  await run(
    process.execPath,
    ['x', 'playwright', 'test', '--config=playwright.authenticated-shell.config.ts'],
    environment,
  )
} finally {
  cleanup()
}
