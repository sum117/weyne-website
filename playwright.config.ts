import { defineConfig, devices } from '@playwright/test'

const PORT = 3191
const BASE_URL = `http://localhost:${PORT}`

/**
 * E2E runs against the production runtime. The public route is still served
 * from its prerendered HTML while application routes exercise their real SSR
 * response plus the hydrating client bundle.
 * Run a production build first: `bun run build` then `bun run test:e2e`.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: {
    command: 'node dist/server/runtime.js',
    url: `${BASE_URL}/healthz`,
    env: {
      DATABASE_URL:
        'postgresql://weyne_test:weyne_test@127.0.0.1:5432/weyne_test',
      HOST: '127.0.0.1',
      PORT: String(PORT),
    },
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
