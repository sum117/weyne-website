import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

/**
 * Serves the quote editor E2E fixtures (tests/e2e/fixtures/*.html) with the
 * same plugin chain as the visual fixture server. Deterministic, no backend:
 * components consume an in-memory QuoteDataService defined in the fixture.
 */
export default defineConfig({
  appType: 'mpa',
  plugins: [tsConfigPaths(), viteReact(), tailwindcss()],
})
