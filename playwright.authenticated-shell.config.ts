import { defineConfig, devices } from '@playwright/test'
import {
  AUTHENTICATED_SHELL_BASE_URL,
  AUTHENTICATED_SHELL_PORT,
} from './tests/e2e/authenticated-shell.fixture'
import { storageStatePath } from './tests/e2e/authenticated-shell.global-setup'

const databaseUrl = process.env.E2E_DATABASE_URL
if (!databaseUrl) {
  throw new Error('E2E_DATABASE_URL is required; use `bun run test:e2e:auth-shell`.')
}

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: 'authenticated-shell.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 7_000 },
  globalSetup: './tests/e2e/authenticated-shell.global-setup.ts',
  use: {
    baseURL: AUTHENTICATED_SHELL_BASE_URL,
    reducedMotion: 'reduce',
    storageState: storageStatePath,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  webServer: {
    command: 'node dist/server/runtime.js',
    url: `${AUTHENTICATED_SHELL_BASE_URL}/healthz`,
    env: {
      BETTER_AUTH_URL: AUTHENTICATED_SHELL_BASE_URL,
      DATABASE_URL: databaseUrl,
      HOST: '127.0.0.1',
      NODE_ENV: 'development',
      PORT: String(AUTHENTICATED_SHELL_PORT),
    },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
