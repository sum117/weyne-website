import { createServerOnlyFn } from '@tanstack/react-start'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import * as schema from './schema'
import { createConnectionManager } from './connection-manager.server'
import { parseDatabaseConfig } from './config.server'

export type Database = PostgresJsDatabase<typeof schema>

const databaseManager = createConnectionManager<Database>({
  loadConfig: () => parseDatabaseConfig(process.env),
  connect: (config) => {
    // Bounded pool + server-side guards. `max` caps concurrent connections;
    // `connection` options are PostgreSQL session parameters enforced by the
    // server, so a runaway query or forgotten transaction can never pin a
    // connection forever.
    const client = postgres(config.url, {
      max: config.pool.max,
      idle_timeout: config.pool.idleTimeoutSeconds,
      connect_timeout: config.pool.connectTimeoutSeconds,
      max_lifetime: 60 * 30,
      connection: {
        statement_timeout: config.pool.statementTimeoutMs,
        idle_in_transaction_session_timeout:
          config.pool.idleInTransactionTimeoutMs,
      },
    })
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
