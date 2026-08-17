import { randomUUID } from 'node:crypto'
import postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { migrateDatabase } from '@/lib/db/migrate.server'
import { resolveTestDatabaseUrl } from '../support/postgres-harness'

const databaseUrl = resolveTestDatabaseUrl(process.env)
const parsedDatabaseUrl = new URL(databaseUrl)
const previousDatabaseUrl = process.env.DATABASE_URL
const client = postgres(databaseUrl, {
  max: 1,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => undefined,
})

beforeAll(async () => {
  process.env.DATABASE_URL = databaseUrl
  await migrateDatabase()
  await client`SELECT 1`
})

afterAll(async () => {
  try {
    await client.end({ timeout: 5 })
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL
    else process.env.DATABASE_URL = previousDatabaseUrl
  }
})

describe('migrated CI database', () => {
  it('is reachable with the isolated test identity', async () => {
    const [identity] = await client<{ database: string; user: string }[]>`
      SELECT current_database() AS database, current_user AS user
    `

    expect(identity).toEqual({
      database: decodeURIComponent(parsedDatabaseUrl.pathname.slice(1)),
      user: decodeURIComponent(parsedDatabaseUrl.username),
    })
  })

  it('contains a usable canonical schema applied by the migration step', async () => {
    const userId = randomUUID()
    const email = `ci-smoke-${userId}@example.test`

    await client`
      INSERT INTO public.users (id, name, email, role, auth_subject)
      VALUES (${userId}, 'CI migration smoke', ${email}, 'admin', ${`ci-smoke:${userId}`})
    `

    try {
      const [smoke] = await client<{ email: string }[]>`
        SELECT email FROM public.users WHERE id = ${userId}
      `
      const [ledger] = await client<{ count: number }[]>`
        SELECT count(*)::integer AS count
        FROM public.weyne_schema_migrations
        WHERE id IN ('0000_canonical_schema', '0001_canonical_invariants')
      `

      expect(smoke?.email).toBe(email)
      expect(ledger?.count).toBe(2)
    } finally {
      await client`DELETE FROM public.users WHERE id = ${userId}`
    }
  })
})
