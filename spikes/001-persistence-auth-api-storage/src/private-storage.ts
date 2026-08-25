import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { and, eq } from 'drizzle-orm'

import type { createAuth } from './auth'
import { privateObject } from './business-schema'
import type { Database } from './database'

type Auth = ReturnType<typeof createAuth>

export type ObjectStore = Readonly<{
  bucket: string
  client: S3Client
}>

export async function ensurePrivateBucket(store: ObjectStore) {
  try {
    await store.client.send(new HeadBucketCommand({ Bucket: store.bucket }))
  } catch {
    await store.client.send(new CreateBucketCommand({ Bucket: store.bucket }))
  }
}

export async function putPrivateObject(input: {
  auth: Auth
  body: Uint8Array
  contentType: string
  db: Database
  headers: Headers
  store: ObjectStore
}) {
  const session = await requireSession(input.auth, input.headers)
  const objectKey = `users/${session.user.id}/${crypto.randomUUID()}`

  await input.store.client.send(
    new PutObjectCommand({
      Body: input.body,
      Bucket: input.store.bucket,
      ContentType: input.contentType,
      Key: objectKey,
    }),
  )
  const [record] = await input.db
    .insert(privateObject)
    .values({ objectKey, ownerUserId: session.user.id })
    .returning()

  return record
}

export async function getPrivateObject(input: {
  auth: Auth
  db: Database
  headers: Headers
  id: string
  store: ObjectStore
}) {
  const session = await requireSession(input.auth, input.headers)
  const [record] = await input.db
    .select()
    .from(privateObject)
    .where(
      and(
        eq(privateObject.id, input.id),
        eq(privateObject.ownerUserId, session.user.id),
      ),
    )
    .limit(1)

  if (!record) throw new Error('Private object not found')

  const response = await input.store.client.send(
    new GetObjectCommand({
      Bucket: input.store.bucket,
      Key: record.objectKey,
    }),
  )

  return response.Body?.transformToString() ?? ''
}

async function requireSession(auth: Auth, headers: Headers) {
  const session = await auth.api.getSession({ headers })
  if (!session) throw new Error('Authentication required')
  return session
}
