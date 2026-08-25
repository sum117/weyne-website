import { S3Client } from '@aws-sdk/client-s3'
import { sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createAuth } from '../src/auth'
import { createDatabase } from '../src/database'
import {
  ensurePrivateBucket,
  getPrivateObject,
  putPrivateObject,
  type ObjectStore,
} from '../src/private-storage'
import { HeadBucketCommand } from '../src/s3'
import { createS3Client } from '../src/s3'

const databaseUrl = requireEnvironment('DATABASE_URL')
const s3Endpoint = requireEnvironment('S3_ENDPOINT')
const { client: databaseClient, db } = createDatabase(databaseUrl)
const auth = createAuth(db, {
  baseURL: 'http://127.0.0.1:3000',
  secret: requireEnvironment('BETTER_AUTH_SECRET'),
})
const store: ObjectStore = {
  bucket: requireEnvironment('S3_BUCKET'),
  client: createS3Client({
    accessKeyId: requireEnvironment('S3_ACCESS_KEY_ID'),
    endpoint: s3Endpoint,
    region: requireEnvironment('S3_REGION'),
    secretAccessKey: requireEnvironment('S3_SECRET_ACCESS_KEY'),
  }),
}

beforeAll(async () => {
  await ensurePrivateBucket(store)
})

afterAll(async () => {
  await databaseClient.end()
  store.client.destroy()
})

describe('backend architecture spike', () => {
  it('connects to PostgreSQL after Drizzle migrations have run', async () => {
    const result = await db.execute(sql<{ database: string }>`select current_database() as database`)
    expect(result[0]?.database).toBe('weyne_spike')
  })

  it('creates and validates a Better Auth session persisted in PostgreSQL', async () => {
    const email = `session-${crypto.randomUUID()}@example.test`
    const cookie = await signUp(email)
    const session = await auth.api.getSession({
      headers: new Headers({ cookie }),
    })

    expect(session?.user.email).toBe(email)
    const persisted = await db.execute(
      sql<{ count: number }>`select count(*)::int as count from session`,
    )
    expect(persisted[0]?.count).toBeGreaterThan(0)
  })


  it('puts and gets a private S3 object only for its authenticated owner', async () => {
    const ownerCookie = await signUp(
      `object-owner-${crypto.randomUUID()}@example.test`,
    )
    const strangerCookie = await signUp(
      `object-stranger-${crypto.randomUUID()}@example.test`,
    )
    const record = await putPrivateObject({
      auth,
      body: new TextEncoder().encode('private-spike-payload'),
      contentType: 'text/plain',
      db,
      headers: new Headers({ cookie: ownerCookie }),
      store,
    })

    await expect(
      getPrivateObject({
        auth,
        db,
        headers: new Headers({ cookie: ownerCookie }),
        id: record.id,
        store,
      }),
    ).resolves.toBe('private-spike-payload')

    await expect(
      getPrivateObject({
        auth,
        db,
        headers: new Headers({ cookie: strangerCookie }),
        id: record.id,
        store,
      }),
    ).rejects.toThrow('Private object not found')
  })

  it('keeps the bucket inaccessible without server credentials', async () => {
    const unauthenticatedClient = new S3Client({
      credentials: { accessKeyId: 'invalid', secretAccessKey: 'invalid' },
      endpoint: s3Endpoint,
      forcePathStyle: true,
      region: requireEnvironment('S3_REGION'),
    })

    await expect(
      unauthenticatedClient.send(
        new HeadBucketCommand({ Bucket: requireEnvironment('S3_BUCKET') }),
      ),
    ).rejects.toBeDefined()
    unauthenticatedClient.destroy()
  })
})

async function signUp(email: string) {
  const response = await auth.api.signUpEmail({
    asResponse: true,
    body: {
      email,
      name: 'Spike user',
      password: 'correct horse battery staple',
    },
  })
  expect(response.status).toBe(200)

  const setCookie = response.headers.get('set-cookie')
  if (!setCookie) throw new Error('Better Auth did not create a session cookie')
  return setCookie.split(';', 1)[0]
}

function requireEnvironment(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required for the integration spike`)
  return value
}
