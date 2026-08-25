import { createHash } from 'node:crypto'
import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3'
import { describe, expect, it } from 'vitest'
import { createS3PrivateAttachmentStorage } from '@/lib/storage/order-attachment-storage.server'

const bytes = Buffer.from('%PDF-1.7\nprivate object\n%%EOF')
const checksumSha256 = createHash('sha256').update(bytes).digest('base64')

function body(value: Uint8Array) {
  return { transformToByteArray: async () => value }
}

describe('S3 private attachment storage', () => {
  it('stores with an S3 checksum, privately streams bytes, and deletes by opaque key', async () => {
    const commands: unknown[] = []
    const client = {
      async send(command: unknown) {
        commands.push(command)
        if (command instanceof PutObjectCommand) return { ChecksumSHA256: checksumSha256 }
        if (command instanceof GetObjectCommand) return { Body: body(bytes) }
        if (command instanceof DeleteObjectCommand) return {}
        throw new Error('unexpected command')
      },
    }
    const storage = createS3PrivateAttachmentStorage(client, { bucket: 'private-test' })

    await expect(
      storage.put({
        key: `attachments/00000000-0000-4000-8000-000000000000/${crypto.randomUUID()}`,
        bytes,
        validatedMimeType: 'application/pdf',
        checksumSha256,
      }),
    ).resolves.toEqual({ sizeBytes: bytes.byteLength, checksumSha256 })
    await expect(storage.get('attachments/key')).resolves.toEqual(
      new Uint8Array(bytes),
    )
    await storage.delete('attachments/key')

    const put = commands[0] as PutObjectCommand
    expect(put.input).toMatchObject({
      Bucket: 'private-test',
      ContentType: 'application/pdf',
      ChecksumSHA256: checksumSha256,
    })
    expect(put.input).not.toHaveProperty('ACL', 'public-read')
    expect(commands[1]).toBeInstanceOf(GetObjectCommand)
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand)
  })

  it('rejects a checksum response that does not match the upload', async () => {
    const client = { send: async () => ({ ChecksumSHA256: 'wrong' }) }
    const storage = createS3PrivateAttachmentStorage(client, { bucket: 'private-test' })

    await expect(
      storage.put({
        key: 'attachments/key',
        bytes,
        validatedMimeType: 'application/pdf',
        checksumSha256,
      }),
    ).rejects.toThrow('S3 upload checksum verification failed')
  })
})
