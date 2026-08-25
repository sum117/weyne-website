import type { DatabaseConfig } from './config.server'

export type ManagedConnection<TDatabase> = Readonly<{
  database: TDatabase
  close: () => Promise<void>
}>

type ConnectionManagerOptions<TDatabase> = Readonly<{
  loadConfig: () => DatabaseConfig
  connect: (
    config: DatabaseConfig,
  ) => ManagedConnection<TDatabase> | Promise<ManagedConnection<TDatabase>>
}>

export type ConnectionManager<TDatabase> = Readonly<{
  getDatabase: () => Promise<TDatabase>
  close: () => Promise<void>
}>

export function createConnectionManager<TDatabase>(
  options: ConnectionManagerOptions<TDatabase>,
): ConnectionManager<TDatabase> {
  let connection: Promise<ManagedConnection<TDatabase>> | undefined
  let closing: Promise<void> | undefined

  async function getConnection(): Promise<ManagedConnection<TDatabase>> {
    if (closing) {
      await closing
    }

    if (!connection) {
      const pending = Promise.resolve().then(() =>
        options.connect(options.loadConfig()),
      )
      connection = pending

      void pending.catch(() => {
        if (connection === pending) {
          connection = undefined
        }
      })
    }

    return connection
  }

  async function close(): Promise<void> {
    if (closing) {
      return closing
    }

    const pending = connection
    connection = undefined

    if (!pending) {
      return
    }

    const closeOperation = pending.then((active) => active.close())
    closing = closeOperation

    try {
      await closeOperation
    } finally {
      if (closing === closeOperation) {
        closing = undefined
      }
    }
  }

  return Object.freeze({
    getDatabase: async () => (await getConnection()).database,
    close,
  })
}
