import { migrateDatabase } from '../src/lib/db/migrate.server'

try {
  await migrateDatabase()
  console.info(JSON.stringify({ event: 'migration.process_succeeded' }))
} catch (error) {
  const message = error instanceof Error
    ? error.message.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    : 'unknown migration error'
  console.error(JSON.stringify({ event: 'migration.process_failed', message }))
  process.exitCode = 1
}
