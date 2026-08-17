import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const composeFile = resolve(process.cwd(), 'deploy/docker-compose.local.yml')
const projectName = 'weyne-production-smoke'
const port = process.env.WEYNE_SMOKE_PORT?.trim() || '43178'
const environment = {
  ...process.env,
  COMPOSE_PROJECT_NAME: projectName,
  PRODUCTION_BASE_URL: `http://127.0.0.1:${port}`,
  WEYNE_HTTP_PORT: port,
}

function run(command: string, args: string[], capture = false): string {
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env: environment,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  })

  if (result.error) throw result.error
  if (result.status !== 0) {
    if (capture && result.stderr) process.stderr.write(result.stderr)
    throw new Error(`${command} exited with status ${result.status ?? 'unknown'}`)
  }

  return capture ? result.stdout : ''
}

function compose(args: string[], capture = false): string {
  return run('docker', ['compose', '-f', composeFile, ...args], capture)
}

function assertHealthyServices(): void {
  const output = compose(['ps', '--format', 'json'], true).trim()
  if (!output) throw new Error('production smoke stack reported no services')

  const parsed = output.startsWith('[')
    ? (JSON.parse(output) as Array<Record<string, string>>)
    : output.split(/\r?\n/).map((line) => JSON.parse(line) as Record<string, string>)
  const services = new Map(parsed.map((service) => [service.Service, service]))

  for (const name of ['app', 'web']) {
    const service = services.get(name)
    if (!service) throw new Error(`production smoke stack is missing ${name}`)
    if (service.State !== 'running' || service.Health !== 'healthy') {
      throw new Error(
        `${name} is not healthy (state=${service.State ?? 'unknown'}, health=${service.Health ?? 'unknown'})`,
      )
    }
  }
}

let failed = false
try {
  compose(['down', '--remove-orphans'])
  compose(['up', '-d', '--build', '--wait'])
  assertHealthyServices()
  run('bunx', [
    'playwright',
    'test',
    '--config=playwright.production.config.ts',
    '--project=chromium',
  ])
  assertHealthyServices()
  console.info('Production SSR stack, browser hydration, caching, and container health passed.')
} catch (error) {
  failed = true
  try {
    compose(['ps'])
    compose(['logs', '--no-color'])
  } catch {
    // Preserve the original smoke failure when diagnostics are unavailable.
  }
  const message = error instanceof Error ? error.message : String(error)
  console.error(`Production smoke failed: ${message}`)
} finally {
  try {
    compose(['down', '--remove-orphans'])
  } catch (error) {
    failed = true
    console.error(`Production smoke cleanup failed: ${String(error)}`)
  }
}

if (failed) process.exitCode = 1
