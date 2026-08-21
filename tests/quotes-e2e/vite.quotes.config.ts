import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'

/**
 * Serves the quote lifecycle browser fixture with the same plugin set as the
 * visual QA harness. The node:crypto alias lets the real server-side quote
 * services (sha256 payload hashing, randomUUID) run unmodified in the browser
 * against the in-memory stores, so the exercised code paths are production
 * code, not re-implementations.
 */
export default defineConfig({
  appType: 'mpa',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tsConfigPaths(), viteReact(), tailwindcss()],
  resolve: {
    alias: {
      'node:crypto': fileURLToPath(
        new URL('./shim-node-crypto.ts', import.meta.url),
      ),
    },
  },
})
