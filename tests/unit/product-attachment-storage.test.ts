import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { createS3ProductAttachmentStorage } from '@/lib/storage/product-attachment-storage.server'

const key = 'attachments/00000000-0000-4000-8000-000000000001'
const now = new Date('2026-08-17T18:00:00.000Z')
const bytes = Buffer.from('%PDF-1.7\nprivate\n%%EOF')
const checksumSha256 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='

function body(value: Uint8Array) {
  return { transformToByteArray: async () => value }
}

describe('S3 product attachment storage', () => {
  it('signs constrained private PUT and GET capabilities with explicit expiry', async () => {
    const signer = vi.fn(
      async (_client: unknown, command: unknown, options: { expiresIn: number }) =>
        `https://signed.test/${command instanceof PutObjectCommand ? 'put' : 'get'}?ttl=${options.expiresIn}`,
    )
    const storage = createS3ProductAttachmentStorage(
      { send: async () => ({}) },
      { bucket: 'private-products' },
      signer,
    )

    await expect(
      storage.signUpload({
        key,
        mimeType: 'application/pdf',
        sizeBytes: bytes.byteLength,
        checksumSha256,
        expiresInSeconds: 120,
        now,
      }),
    ).resolves.toEqual({
      url: 'https://signed.test/put?ttl=120',
      expiresAt: new Date('2026-08-17T18:02:00.000Z'),
    })
    await expect(
      storage.signDownload({ key, expiresInSeconds: 30, now }),
    ).resolves.toEqual({
      url: 'https://signed.test/get?ttl=30',
      expiresAt: new Date('2026-08-17T18:00:30.000Z'),
    })

    const put = signer.mock.calls[0]![1]
    expect(put).toBeInstanceOf(PutObjectCommand)
    expect((put as PutObjectCommand).input).toEqual({
      Bucket: 'private-products',
      Key: key,
      ContentLength: bytes.byteLength,
      ContentType: 'application/pdf',
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: checksumSha256,
    })
    expect((put as PutObjectCommand).input).not.toHaveProperty('ACL')
    expect(signer.mock.calls[1]![1]).toBeInstanceOf(GetObjectCommand)
  })

  it('reads, writes private processed bytes, and deletes only by opaque key', async () => {
    const commands: unknown[] = []
    const storage = createS3ProductAttachmentStorage(
      {
        async send(command: unknown) {
          commands.push(command)
          return command instanceof GetObjectCommand ? { Body: body(bytes) } : {}
        },
      },
      { bucket: 'private-products' },
      async () => 'https://signed.test',
    )

    await expect(storage.read(key)).resolves.toEqual(new Uint8Array(bytes))
    await storage.putPrivate({
      key,
      bytes,
      mimeType: 'image/webp',
      checksumSha256,
    })
    await storage.delete(key)
    expect(commands[0]).toBeInstanceOf(GetObjectCommand)
    expect(commands[1]).toBeInstanceOf(PutObjectCommand)
    expect((commands[1] as PutObjectCommand).input).toEqual({
      Body: bytes,
      Bucket: 'private-products',
      Key: key,
      ContentLength: bytes.byteLength,
      ContentType: 'image/webp',
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: checksumSha256,
    })
    expect((commands[1] as PutObjectCommand).input).not.toHaveProperty('ACL')
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand)
  })

  it('maps an S3 missing-object response to the storage null contract', async () => {
    const storage = createS3ProductAttachmentStorage(
      {
        async send() {
          throw Object.assign(new Error('missing'), {
            name: 'NoSuchKey',
            $metadata: { httpStatusCode: 404 },
          })
        },
      },
      { bucket: 'private-products' },
      async () => 'https://signed.test',
    )

    await expect(storage.read(key)).resolves.toBeNull()
  })
})
