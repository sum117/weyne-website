import {
  HeadObjectCommand,
  PutObjectCommand,
  type HeadObjectCommandOutput,
} from '@aws-sdk/client-s3'
import type {
  QuotePdfArtifactStorage,
  QuotePdfArtifactStoragePutResult,
} from './pdf-artifacts.server'
import type { S3Config } from '@/lib/storage/s3.server'

interface S3CommandClient {
  send(command: PutObjectCommand | HeadObjectCommand): Promise<unknown>
}

/**
 * Stores generated PDFs in the configured private S3-compatible bucket.
 * `If-None-Match: *` is the byte immutability boundary: an existing object is
 * inspected, never overwritten, and is reusable only when checksum and size
 * match the generated output exactly.
 */
export function createS3QuotePdfArtifactStorage(
  client: S3CommandClient,
  config: S3Config,
): QuotePdfArtifactStorage {
  const storage: QuotePdfArtifactStorage = {
    async putImmutable(input): Promise<QuotePdfArtifactStoragePutResult> {
      const metadata: Record<string, string> = Object.fromEntries(
        Object.entries({
          ...input.metadata,
          outputChecksum: input.checksum,
        }).map(([key, value]) => [key.toLowerCase(), value]),
      )

      try {
        await client.send(
          new PutObjectCommand({
            Bucket: config.bucket,
            Key: input.key,
            Body: input.bytes,
            ContentType: input.contentType,
            ContentLength: input.bytes.byteLength,
            ChecksumSHA256: Buffer.from(input.checksum, 'hex').toString('base64'),
            Metadata: metadata,
            IfNoneMatch: '*',
          }),
        )
        return {
          kind: 'created',
          checksum: input.checksum,
          sizeBytes: input.bytes.byteLength,
        }
      } catch (error) {
        if (!isPreconditionFailure(error)) throw error
      }

      const existing = (await client.send(
        new HeadObjectCommand({ Bucket: config.bucket, Key: input.key }),
      )) as HeadObjectCommandOutput
      const checksum = existing.Metadata?.outputchecksum ?? ''
      const sizeBytes = existing.ContentLength ?? 0
      return {
        kind:
          checksum === input.checksum && sizeBytes === input.bytes.byteLength
            ? 'existing'
            : 'conflict',
        checksum,
        sizeBytes,
      }
    },
  }

  return Object.freeze(storage)
}

function isPreconditionFailure(error: unknown) {
  if (!error || typeof error !== 'object') return false
  const candidate = error as {
    name?: unknown
    $metadata?: { httpStatusCode?: unknown }
  }
  return (
    candidate.name === 'PreconditionFailed' ||
    candidate.$metadata?.httpStatusCode === 412
  )
}
