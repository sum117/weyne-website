import { defineConfig, devices } from '@playwright/test'

/**
 * Quote workflow acceptance over production-like boundaries (kanban
 * t_391798ac).
 *
 * The suite drives the REAL quote services — PostgreSQL-backed persistence,
 * lifecycle, duplication, pricing, and PDF delivery — through a server API
 * process, and the real production UI components through a Vite fixture
 * workspace that talks to that API over HTTP. No quote API is mocked: the
 * same service modules that ship are composed here against a disposable
 * `postgres:17.6-alpine` container with an EPHEMERAL host port (never a fixed
 * port, which stale containers hold) and deterministic seeded master data.
 */

const API_PORT = resolvePort('WORKFLOW_API_PORT')
const FIXTURE_PORT = resolvePort('WORKFLOW_FIXTURE_PORT')
const API_URL = `http://127.0.0.1:${API_PORT}`
const FIXTURE_URL = `http://127.0.0.1:${FIXTURE_PORT}/fixture.html`

export default defineConfig({
  testDir: './tests/quote-workflow',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  use: {
    locale: 'pt-BR',
    colorScheme: 'light',
    contextOptions: { timezoneId: 'America/Recife', reducedMotion: 'reduce' },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: `bun tests/quote-workflow/api-server.ts --port ${API_PORT}`,
      url: `${API_URL}/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: workflowServerEnv(),
    },
    {
      command: `bunx vite --config tests/quote-workflow/vite.config.ts --port ${FIXTURE_PORT} --strictPort --host 127.0.0.1`,
      url: FIXTURE_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      env: workflowFixtureEnv(),
    },
  ],
})

/**
 * Resolves the disposable database URL. When TEST_DATABASE_URL points at an
 * explicitly test-scoped PostgreSQL instance the suite reuses it; otherwise a
 * fresh container is started on an ephemeral port and torn down by Playwright's
 * webServer lifecycle (the api-server process owns the container).
 */
function workflowServerEnv(): Record<string, string> {
  const configured = process.env.WORKFLOW_DATABASE_URL?.trim()
  const fixtureOrigin = process.env.WORKFLOW_FIXTURE_ORIGIN?.trim()
  if (configured && fixtureOrigin) {
    return {
      ...process.env,
      WORKFLOW_DATABASE_URL: configured,
      WORKFLOW_FIXTURE_ORIGIN: fixtureOrigin,
    }
  }
  // Ephemeral container provisioning happens in scripts/run-quote-workflow.ts,
  // which always sets WORKFLOW_DATABASE_URL before invoking this config.
  throw new Error(
    'WORKFLOW_DATABASE_URL and WORKFLOW_FIXTURE_ORIGIN are required — run the suite through scripts/run-quote-workflow.ts',
  )
}

function workflowFixtureEnv(): Record<string, string> {
  const apiUrl = process.env.VITE_WORKFLOW_API_URL?.trim()
  if (!apiUrl) {
    throw new Error(
      'VITE_WORKFLOW_API_URL is required — run the suite through scripts/run-quote-workflow.ts',
    )
  }
  return { ...process.env, VITE_WORKFLOW_API_URL: apiUrl }
}

function resolvePort(name: 'WORKFLOW_API_PORT' | 'WORKFLOW_FIXTURE_PORT'): number {
  const raw = process.env[name]?.trim()
  const value = Number(raw)
  if (!raw || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new Error(`${name} must be a valid TCP port — run the suite through scripts/run-quote-workflow.ts`)
  }
  return value
}
