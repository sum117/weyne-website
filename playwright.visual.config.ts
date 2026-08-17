import { defineConfig, devices } from '@playwright/test'

const port = 3200
const fixturePort = 3201

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  reporter: 'list',
  timeout: 30_000,
  expect: {
    timeout: 7_000,
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
      maxDiffPixelRatio: 0.001,
    },
  },
  use: {
    baseURL: `http://localhost:${port}`,
    locale: 'pt-BR',
    timezoneId: 'America/Recife',
    colorScheme: 'light',
    reducedMotion: 'reduce',
    deviceScaleFactor: 1,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], deviceScaleFactor: 1 },
    },
  ],
  webServer: [
    {
      command: `bun run dev -- --port ${port}`,
      url: `http://localhost:${port}`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
    {
      command: `bunx vite --config vite.visual.config.ts --port ${fixturePort}`,
      url: `http://localhost:${fixturePort}/tests/visual/fixture.html`,
      reuseExistingServer: !process.env.CI,
      timeout: 90_000,
    },
  ],
})