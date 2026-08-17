import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const composeFile = resolve(process.cwd(), 'deploy/docker-compose.database.yml')
const databaseName = 'weyne_dev'
const databaseUser = 'weyne_dev'
const port = resolvePort(process.env.WEYNE_DATABASE_PORT)
const localDatabaseUrl = `postgresql://${databaseUser}@127.0.0.1:${port}/${databaseName}`
const command = process.argv[2]

function resolvePort(value: string | undefined): string {
  const candidate = value?.trim() || '5432'
  const parsed = Number(candidate)

  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    throw new Error('WEYNE_DATABASE_PORT must be an integer between 1 and 65535')
  }

  return candidate
}

function run(commandName: string, args: string[], environment = process.env): void {
  const result = spawnSync(commandName, args, {
    cwd: process.cwd(),
    env: environment,
    stdio: 'inherit',
  })

  if (result.error) {
    throw result.error
  }

  if (result.status !== 0) {
    throw new Error(`${commandName} exited with status ${result.status ?? 'unknown'}`)
  }
}

function compose(...args: string[]): void {
  run('docker', ['compose', '-f', composeFile, ...args])
}

function isReady(): boolean {
  const result = spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      'exec',
      '-T',
      'postgres',
      'pg_isready',
      '-U',
      databaseUser,
      '-d',
      databaseName,
    ],
    { cwd: process.cwd(), env: process.env, stdio: 'ignore' },
  )

  return result.status === 0
}

async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000

  while (Date.now() < deadline) {
    if (isReady()) {
      console.info(`PostgreSQL is ready on 127.0.0.1:${port}.`)
      return
    }

    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500))
  }

  compose('ps')
  throw new Error('PostgreSQL did not become ready within 60 seconds')
}

function runDatabaseScript(script: string): void {
  run('bun', [script], {
    ...process.env,
    DATABASE_URL: localDatabaseUrl,
  })
}

async function setupDatabase(): Promise<void> {
  compose('up', '-d', 'postgres')
  await waitForDatabase()
  runDatabaseScript('scripts/migrate-database.ts')
  runDatabaseScript('scripts/seed-database.ts')
}

async function main(): Promise<void> {
  switch (command) {
    case 'up':
      compose('up', '-d', 'postgres')
      return
    case 'wait':
      await waitForDatabase()
      return
    case 'migrate':
      await waitForDatabase()
      runDatabaseScript('scripts/migrate-database.ts')
      return
    case 'seed':
      await waitForDatabase()
      runDatabaseScript('scripts/seed-database.ts')
      return
    case 'setup':
      await setupDatabase()
      return
    case 'reset':
      compose('down', '--volumes', '--remove-orphans')
      await setupDatabase()
      return
    case 'down':
      compose('down', '--remove-orphans')
      return
    default:
      throw new Error(
        'Usage: bun scripts/local-database.ts <up|wait|migrate|seed|setup|reset|down>',
      )
  }
}

try {
  await main()
} catch (error) {
  const message = error instanceof Error ? error.message : 'unknown local database error'
  console.error(`Local database command failed: ${message}`)
  process.exitCode = 1
}
