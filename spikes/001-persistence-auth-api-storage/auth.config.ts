import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import { createAuth } from './src/auth'
import * as schema from './src/schema'

const sql = postgres(
  process.env.DATABASE_URL ??
    'postgresql://weyne@127.0.0.1:55432/weyne_spike',
)
const db = drizzle(sql, { schema })

export const auth = createAuth(db, {
  baseURL: 'http://127.0.0.1:3000',
  secret: requireEnvironment('BETTER_AUTH_SECRET'),
})

function requireEnvironment(name: string): string {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}
