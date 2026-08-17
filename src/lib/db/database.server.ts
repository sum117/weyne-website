import { createServerOnlyFn } from '@tanstack/react-start'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { createConnectionManager } from './connection-manager.server'
import { parseDatabaseConfig } from './config.server'

export type Database = PostgresJsDatabase<typeof schema>

const databaseManager = createConnectionManager<Database>({
  loadConfig: () => parseDatabaseConfig(process.env),
  connect: ({ url }) => {
    const client = postgres(url)
    const database = drizzle(client, { schema })

    return {
      database,
      close: () => client.end({ timeout: 5 }),
    }
  },
})

/** Returns the process-wide typed Drizzle database, creating it lazily. */
export const getDatabase = createServerOnlyFn(() =>
  databaseManager.getDatabase(),
)

/** Closes the process-wide pool. Safe to call repeatedly in tests and scripts. */
export const closeDatabase = createServerOnlyFn(() => databaseManager.close())
