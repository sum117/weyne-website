import { HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { createS3QuotePdfArtifactStorage } from '@/lib/quotes/pdf-artifact-storage.server'
import { parseS3Config } from '@/lib/storage/s3.server'

const config = parseS3Config({
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'private-bucket',
  S3_ACCESS_KEY_ID: 'access',
  S3_SECRET_ACCESS_KEY: 'secret',
})

const input = {
  key: 'quote-pdfs/artifact/checksum.pdf',
  bytes: Buffer.from('%PDF-1.7\n%%EOF'),
  checksum: 'd0f9d5a869bf645c1f08c4ad81c9fc2ee6496fa4bfe1e2dd14f470077c76c3e5',
  contentType: 'application/pdf' as const,
  metadata: { artifactId: 'artifact' },
}

describe('S3 quote PDF immutable storage', () => {
  it('creates private bytes with a conditional write and checksum metadata', async () => {
    const commands: unknown[] = []
    const storage = createS3QuotePdfArtifactStorage(
      {
        async send(command) {
          commands.push(command)
          return {}
        },
      },
      config,
    )

    await expect(storage.putImmutable(input)).resolves.toEqual({
      kind: 'created',
      checksum: input.checksum,
      sizeBytes: input.bytes.byteLength,
    })
    expect(commands).toHaveLength(1)
    expect(commands[0]).toBeInstanceOf(PutObjectCommand)
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: 'private-bucket',
      Key: input.key,
      ContentType: 'application/pdf',
      IfNoneMatch: '*',
      Metadata: {
        artifactid: 'artifact',
        outputchecksum: input.checksum,
      },
    })
  })

  it('returns the existing immutable object only when bytes match', async () => {
    const commands: unknown[] = []
    const storage = createS3QuotePdfArtifactStorage(
      {
        async send(command) {
          commands.push(command)
          if (command instanceof PutObjectCommand) {
            throw Object.assign(new Error('precondition failed'), {
              name: 'PreconditionFailed',
              $metadata: { httpStatusCode: 412 },
            })
          }
          return {
            ContentLength: input.bytes.byteLength,
            Metadata: { outputchecksum: input.checksum },
          }
        },
      },
      config,
    )

    await expect(storage.putImmutable(input)).resolves.toEqual({
      kind: 'existing',
      checksum: input.checksum,
      sizeBytes: input.bytes.byteLength,
    })
    expect(commands[1]).toBeInstanceOf(HeadObjectCommand)
  })

  it('reports an immutable conflict instead of overwriting different bytes', async () => {
    const storage = createS3QuotePdfArtifactStorage(
      {
        async send(command) {
          if (command instanceof PutObjectCommand) {
            throw Object.assign(new Error('precondition failed'), {
              $metadata: { httpStatusCode: 412 },
            })
          }
          return {
            ContentLength: 99,
            Metadata: { outputchecksum: 'different' },
          }
        },
      },
      config,
    )

    await expect(storage.putImmutable(input)).resolves.toEqual({
      kind: 'conflict',
      checksum: 'different',
      sizeBytes: 99,
    })
  })
})
