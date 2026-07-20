import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import tailwind from 'eslint-plugin-tailwindcss'

export default tseslint.config(
  {
    ignores: [
      'dist',
      '.output',
      '.nitro',
      '.tanstack',
      'node_modules',
      'playwright-report',
      'test-results',
      'docs/**',
      'src/routeTree.gen.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Register the Tailwind plugin once, with our CSS-first entry point.
    plugins: { tailwindcss: tailwind },
    settings: {
      tailwindcss: {
        cssConfigPath: 'src/styles/app.css',
      },
    },
    rules: {
      ...(tailwind.configs.recommended.rules ?? {}),
      // The handoff mandates exact arbitrary values for prototype measurements
      // ("do not round to a nearby default token"); this rule fights that and
      // its suggestions are unreliable (e.g. leading-[1.08] -> leading-1.08 is
      // not an equivalent line-height).
      'tailwindcss/no-unnecessary-arbitrary-value': 'off',
      // False positives on the cn()/cva dynamic-class helpers.
      'tailwindcss/no-custom-classname': 'off',
      // Canonical class ordering, autofixable — kept as a warning.
      'tailwindcss/classnames-order': 'warn',
    },
  },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
    },
    rules: {
      // TypeScript already resolves identifiers; no-undef only yields false
      // positives on DOM/Node globals in .ts/.tsx files.
      'no-undef': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
    },
  },
)
