import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.PRODUCTION_BASE_URL ?? 'http://127.0.0.1:43178'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'production-smoke.spec.ts',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  use: {
    ...devices['Desktop Chrome'],
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'chromium' }],
})
