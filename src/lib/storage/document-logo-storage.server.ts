import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { isDocumentLogoObjectKey } from '@/domain/settings/document-logo-assets'
import type { DocumentLogoStorage } from '@/lib/settings/document-logo-service.server'
import type { S3Config } from '@/lib/storage/s3.server'

/**
 * Private S3-compatible adapter for document logo assets. Objects live under
 * opaque `document-logos/<uuid>` keys in the configured private bucket; the
 * signed URLs returned here are ephemeral capabilities and must never be
 * persisted. No public object URL is ever produced.
 */
export function createS3DocumentLogoStorage(
  client: S3Client,
  config: S3Config,
): DocumentLogoStorage {
  const bucket = config.bucket.trim()
  if (!bucket) throw new Error('Private document logo bucket is required')

  function assertPrivateKey(key: string): void {
    if (!isDocumentLogoObjectKey(key)) {
      throw new Error('Document logo object key must be an opaque private identifier')
    }
  }

  return Object.freeze({
    async signUpload(input: Readonly<{
      key: string
      mimeType: string
      sizeBytes: number
      expiresInSeconds: number
      now: Date
    }>) {
      assertPrivateKey(input.key)
      const url = await getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          ContentType: input.mimeType,
          ContentLength: input.sizeBytes,
        }),
        { expiresIn: input.expiresInSeconds },
      )
      return {
        url,
        expiresAt: addSeconds(input.now, input.expiresInSeconds),
      }
    },

    async signDownload(input: Readonly<{
      key: string
      expiresInSeconds: number
      now: Date
    }>) {
      assertPrivateKey(input.key)
      const url = await getSignedUrl(
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
      assertPrivateKey(key)
      let result
      try {
        result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }))
      } catch (error) {
        if (isMissingObjectError(error)) return null
        throw error
      }
      if (!result.Body) return null
      return new Uint8Array(await result.Body.transformToByteArray())
    },

    async putPrivate(input: Readonly<{
      key: string
      bytes: Uint8Array
      mimeType: string
    }>) {
      assertPrivateKey(input.key)
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: input.key,
          Body: input.bytes,
          ContentLength: input.bytes.byteLength,
          ContentType: input.mimeType,
        }),
      )
    },

    async delete(key: string) {
      assertPrivateKey(key)
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
