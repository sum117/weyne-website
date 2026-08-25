import { defineConfig, devices } from '@playwright/test'

const FIXTURE_PORT = 3202
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}/fixture.html`

/**
 * Quote lifecycle browser coverage. Runs against a deterministic in-browser
 * workspace fixture (real production components + real lifecycle/duplication
 * services over in-memory stores), so scenarios are reproducible without a
 * database while still exercising the integrated UI behavior.
 *
 * Server-side concurrency guarantees (row locks, serialized retries,
 * idempotency races) are proven by tests/integration/quote-lifecycle.test.ts
 * and the focused unit suites; this suite asserts the resulting UI conflict
 * behavior instead of re-proving server concurrency through a browser.
 */
export default defineConfig({
  testDir: '.',
  testMatch: 'quotes.spec.ts',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: FIXTURE_URL,
    locale: 'pt-BR',
    colorScheme: 'light',
    contextOptions: {
      timezoneId: 'America/Recife',
      reducedMotion: 'reduce',
    },
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `bunx vite --config vite.quotes.config.ts --port ${FIXTURE_PORT} --strictPort`,
    url: FIXTURE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
})
