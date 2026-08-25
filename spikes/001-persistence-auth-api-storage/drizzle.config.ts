import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/business-schema.ts'],
  out: './drizzle',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://weyne@127.0.0.1:55432/weyne_spike',
  },
})
