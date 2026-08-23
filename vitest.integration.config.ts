import { createRequire } from 'node:module'
import path from 'node:path'
import { defineConfig } from 'vitest/config'
import tsConfigPaths from 'vite-tsconfig-paths'

const require = createRequire(import.meta.url)

/**
 * Resolves the real on-disk entry of the internal compiler plugin. The
 * package's `exports` map does not publish this subpath, so it must be
 * resolved to an absolute file path BEFORE the config is bundled (esbuild
 * enforces `exports` for any bare-specifier import in the config).
 */
function resolveCompilerPluginPath(): string {
  const pkgJsonPath = require.resolve('@tanstack/start-plugin-core/package.json')
  return path.resolve(
    path.dirname(pkgJsonPath),
    './dist/esm/vite/start-compiler-plugin/plugin.js',
  )
}

/**
 * Integration-test pipeline.
 *
 * The TanStack Start compiler plugin gives `createServerFn` calls their
 * production shape (split handler modules + RPC wiring) instead of the inert
 * client stubs Node would otherwise see. Security integration tests rely on
 * this to exercise real server-function handlers; ordinary persistence and
 * service suites are unaffected (files without `createServerFn` are not
 * transformed).
 */
export default defineConfig(async () => {
  const pluginPath = resolveCompilerPluginPath()
  const pluginModule = (await import(
    process.platform === 'win32'
      ? `file://${pluginPath.replaceAll('\\', '/')}`
      : pluginPath
  )) as {
    startCompilerPlugin: (options: unknown) => unknown
  }

  return {
    plugins: [
      tsConfigPaths(),
      // The plugin targets Vite environments; Vitest exposes a single
      // "client" environment, which is enough to enable the transforms.
      pluginModule.startCompilerPlugin({
        framework: 'react',
        providerEnvName: 'client',
        environments: [{ name: 'client', type: 'client' }],
      }) as never,
    ],
    test: {
      name: 'integration',
      environment: 'node',
      include: ['tests/integration/**/*.test.ts'],
      testTimeout: 30_000,
      hookTimeout: 30_000,
      fileParallelism: false,
    },
  }
})
