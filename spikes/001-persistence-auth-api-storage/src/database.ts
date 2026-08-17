import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

import * as businessSchema from './business-schema'
import * as authSchema from './schema'

const schema = { ...authSchema, ...businessSchema }

export function createDatabase(url: string) {
  const client = postgres(url, { max: 4 })
  const db = drizzle(client, { schema })
  return { client, db }
}

export type Database = ReturnType<typeof createDatabase>['db']
