import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import type { PrivateAttachmentStorage } from '@/lib/orders/attachments.server'

type S3CommandClient = Readonly<{
  send(command: unknown): Promise<unknown>
}>

type S3AttachmentStorageConfig = Readonly<{
  bucket: string
}>

/**
 * Provider-neutral private S3 adapter. It never sets a public ACL and returns
 * bytes through the authorized application service rather than a durable URL.
 */
export function createS3PrivateAttachmentStorage(
  client: S3CommandClient,
  config: S3AttachmentStorageConfig,
): PrivateAttachmentStorage {
  const bucket = config.bucket.trim()
  if (!bucket) throw new Error('Private attachment bucket is required')

  return {
    async put(input) {
      const result = await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.validatedMimeType,
          ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: input.checksumSha256,
        }),
      )
      const storedChecksum = readStringProperty(result, 'ChecksumSHA256')
      if (storedChecksum !== input.checksumSha256) {
        throw new Error('S3 upload checksum verification failed')
      }
      return {
        sizeBytes: input.bytes.byteLength,
        checksumSha256: storedChecksum,
      }
    },

    async get(key) {
      const result = await client.send(
        new GetObjectCommand({ Bucket: bucket, Key: key }),
      )
      const body = readBody(result)
      if (!body) return null
      return new Uint8Array(await body.transformToByteArray())
    },

    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  }
}

function readStringProperty(value: unknown, key: string): string | null {
  if (typeof value !== 'object' || value === null) return null
  const property = Reflect.get(value, key)
  return typeof property === 'string' ? property : null
}

function readBody(value: unknown):
  | Readonly<{ transformToByteArray(): Promise<Uint8Array> }>
  | null {
  if (typeof value !== 'object' || value === null) return null
  const body: unknown = Reflect.get(value, 'Body')
  if (typeof body !== 'object' || body === null) return null
  const transform: unknown = Reflect.get(body, 'transformToByteArray')
  if (typeof transform !== 'function') return null
  return {
    transformToByteArray: () =>
      Promise.resolve(Reflect.apply(transform, body, [])) as Promise<Uint8Array>,
  }
}
