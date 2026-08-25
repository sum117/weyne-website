import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'
import { fileURLToPath } from 'node:url'

/**
 * Serves the quote workflow fixture with the production plugin chain. The
 * node:crypto alias lets server-side modules imported by the fixture run in
 * the browser; the API boundary itself runs in a separate Bun process.
 */
export default defineConfig({
  appType: 'mpa',
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [tsConfigPaths(), viteReact(), tailwindcss()],
  resolve: {
    alias: {
      'node:crypto': fileURLToPath(
        new URL('../quotes-e2e/shim-node-crypto.ts', import.meta.url),
      ),
    },
  },
})
