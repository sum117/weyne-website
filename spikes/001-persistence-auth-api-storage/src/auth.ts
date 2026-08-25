import { betterAuth } from 'better-auth'
import { drizzleAdapter } from 'better-auth/adapters/drizzle'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'

import * as schema from './schema'

export type AuthDatabase = PostgresJsDatabase<typeof schema>

export function createAuth(
  database: AuthDatabase,
  options: Readonly<{ baseURL: string; secret: string }>,
) {
  return betterAuth({
    appName: 'Weyne backend architecture spike',
    baseURL: options.baseURL,
    database: drizzleAdapter(database, { provider: 'pg', schema }),
    emailAndPassword: { enabled: true },
    secret: options.secret,
  })
}
