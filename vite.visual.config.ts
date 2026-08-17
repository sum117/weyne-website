import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import tsConfigPaths from 'vite-tsconfig-paths'

export default defineConfig({
  appType: 'mpa',
  plugins: [tsConfigPaths(), viteReact(), tailwindcss()],
})