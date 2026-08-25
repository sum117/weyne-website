import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { createS3Client, parseS3Config } from '../src/lib/storage/s3.server'

const config = parseS3Config(process.env)

if (!config.endpoint) {
  throw new Error('S3_ENDPOINT is required for the storage smoke check')
}

const client = createS3Client(config)
const key = `_smoke/private-access-${crypto.randomUUID()}.txt`
const body = `authenticated-${crypto.randomUUID()}`

try {
  await client.send(new HeadBucketCommand({ Bucket: config.bucket }))
  await client.send(
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      Body: body,
      ContentType: 'text/plain',
    }),
  )

  const authenticatedObject = await client.send(
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
  )
  const authenticatedBody = await authenticatedObject.Body?.transformToString()

  if (authenticatedBody !== body) {
    throw new Error('Authenticated SDK read returned unexpected object content')
  }

  const bucketUrl = new URL(config.endpoint)
  bucketUrl.pathname = joinUrlPath(bucketUrl.pathname, config.bucket)
  const objectUrl = new URL(bucketUrl)
  objectUrl.pathname = joinUrlPath(objectUrl.pathname, key)

  const [anonymousBucket, anonymousObject] = await Promise.all([
    fetch(bucketUrl, { redirect: 'manual' }),
    fetch(objectUrl, { redirect: 'manual' }),
  ])

  assertAnonymousDenied('bucket', anonymousBucket.status)
  assertAnonymousDenied('object', anonymousObject.status)

  console.log(
    `Storage smoke passed: authenticated SDK access succeeded; anonymous bucket/object access returned ${anonymousBucket.status}/${anonymousObject.status}.`,
  )
} finally {
  await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
  client.destroy()
}

function assertAnonymousDenied(resource: string, status: number): void {
  if (status !== 401 && status !== 403) {
    throw new Error(
      `Anonymous ${resource} access was not explicitly denied (HTTP ${status})`,
    )
  }
}

function joinUrlPath(...parts: string[]): string {
  return `/${parts
    .flatMap((part) => part.split('/'))
    .filter(Boolean)
    .map(encodeURIComponent)
    .join('/')}`
}
