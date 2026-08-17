import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import type { ProductAttachmentStorage } from '@/lib/products/attachments.server'

type S3CommandClient = Readonly<{
  send(command: unknown): Promise<unknown>
}>

type ProductAttachmentStorageConfig = Readonly<{
  bucket: string
}>

type SignableCommand = PutObjectCommand | GetObjectCommand
type S3Signer = (
  client: S3CommandClient,
  command: SignableCommand,
  options: Readonly<{ expiresIn: number }>,
) => Promise<string>

const defaultSigner: S3Signer = (client, command, options) =>
  getSignedUrl(client as S3Client, command, options)

/**
 * Private provider-neutral S3 adapter for product attachment capabilities.
 * The returned URLs are ephemeral; callers must never persist them.
 */
export function createS3ProductAttachmentStorage(
  client: S3CommandClient,
  config: ProductAttachmentStorageConfig,
  signer: S3Signer = defaultSigner,
): ProductAttachmentStorage {
  const bucket = config.bucket.trim()
  if (!bucket) throw new Error('Private product attachment bucket is required')

  return Object.freeze({
    async signUpload(input: Parameters<ProductAttachmentStorage['signUpload']>[0]) {
      const url = await signer(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ContentLength: input.sizeBytes,
          ContentType: input.mimeType,
          ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: input.checksumSha256,
        }),
        { expiresIn: input.expiresInSeconds },
      )
      return {
        url,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },

    async signDownload(input: Parameters<ProductAttachmentStorage['signDownload']>[0]) {
      const url = await signer(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: input.key }),
        { expiresIn: input.expiresInSeconds },
      )
      return {
        url,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },

    async read(key: string) {
      let result: unknown
      try {
        result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        if (isMissingObjectError(error)) return null
        throw error
      }
      const body = readBody(result)
      if (!body) return null
      return new Uint8Array(await body.transformToByteArray())
    },

    async putPrivate(
      input: Parameters<ProductAttachmentStorage['putPrivate']>[0],
    ) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.mimeType,
          ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: input.checksumSha256,
        }),
      )
    },

    async delete(key: string) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }))
    },
  })
}

function addSeconds(value: Date, seconds: number): Date {
  return new Date(value.getTime() + seconds * 1000)
}

function isMissingObjectError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const name = Reflect.get(error, 'name')
  const metadata = Reflect.get(error, '$metadata')
  const statusCode =
    typeof metadata === 'object' && metadata !== null
      ? Reflect.get(metadata, 'httpStatusCode')
      : undefined
  return name === 'NoSuchKey' || name === 'NotFound' || statusCode === 404
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
