import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  plugins: [tsConfigPaths()],
  test: {
    name: 'unit',
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx'],
    // Rendering-heavy jsdom/PDF tests share workers with the full suite. Keep
    // a bounded CI-wide allowance; individual pathological renders retain
    // their stricter explicit limits where declared.
    testTimeout: 15_000,
  },
})
