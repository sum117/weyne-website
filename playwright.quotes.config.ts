import { defineConfig, devices } from '@playwright/test'

const FIXTURE_PORT = 3195
const FIXTURE_URL = `http://localhost:${FIXTURE_PORT}/tests/e2e/fixtures/quote-editor.html`

/**
 * Browser-level coverage for the quote catalog picker and line-item editor.
 * Runs the deterministic fixture (tests/e2e/fixtures/quote-editor-fixture.tsx)
 * through Vite with the production plugin chain — no database, no backend.
 * Start it directly: `bun run test:e2e:quotes`.
 */
export default defineConfig({
  testDir: './tests/e2e/quotes',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: FIXTURE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: `bunx vite --config vite.e2e-fixtures.config.ts --port ${FIXTURE_PORT} --strictPort`,
    url: FIXTURE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 90_000,
  },
})
