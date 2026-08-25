import { defineConfig } from 'drizzle-kit'
import { parseDatabaseConfig } from './src/lib/db/config.server'

const database = parseDatabaseConfig(process.env)

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/lib/db/schema/canonical.ts',
  out: './drizzle/canonical',
  dbCredentials: {
    url: database.url,
  },
  strict: true,
  verbose: true,
})
