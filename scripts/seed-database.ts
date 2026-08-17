import { seedDatabase } from '../src/lib/db/seed.server'

try {
  await seedDatabase()
  console.info(JSON.stringify({ event: 'database.seed_succeeded' }))
} catch (error) {
  const message = error instanceof Error
    ? error.message.replaceAll(/postgres(?:ql)?:\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    : 'unknown seed error'
  console.error(JSON.stringify({ event: 'database.seed_failed', message }))
  process.exitCode = 1
}
