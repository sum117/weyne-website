import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import {
  createProductPhotoProcessingService,
  processProductPhotoBytes,
  ProductPhotoProcessingError,
  type ProductPhotoProcessingRepository,
  type ProductPhotoVariantMetadata,
} from '@/lib/attachments/product-photo-processing.server'

const fixturePath = (name: string) =>
  new URL(`../fixtures/product-images/${name}`, import.meta.url)

const sha256Base64 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('base64')

describe('product photo byte processing', () => {
  it('normalizes EXIF orientation and emits bounded metadata-free WebP variants', async () => {
    const original = await readFile(fixturePath('rotated-exif.jpg'))

    const result = await processProductPhotoBytes({
      bytes: original,
      expectedChecksumSha256: sha256Base64(original),
      expectedMimeType: 'image/jpeg',
    })

    expect(result.source).toEqual({
      checksumSha256: sha256Base64(original),
      height: 800,
      mimeType: 'image/jpeg',
      orientation: 6,
      width: 1200,
    })
    expect(result.variants.map(({ bytes: _bytes, ...metadata }) => metadata)).toEqual([
      {
        checksumSha256: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
        height: 320,
        key: 'THUMBNAIL',
        mimeType: 'image/webp',
        sizeBytes: expect.any(Number),
        width: 213,
      },
      {
        checksumSha256: expect.stringMatching(/^[A-Za-z0-9+/]{43}=$/),
        height: 1200,
        key: 'DISPLAY',
        mimeType: 'image/webp',
        sizeBytes: expect.any(Number),
        width: 800,
      },
    ])

    for (const variant of result.variants) {
      expect(variant.checksumSha256).toBe(sha256Base64(variant.bytes))
      const metadata = await sharp(variant.bytes).metadata()
      expect(metadata.format).toBe('webp')
      expect(metadata.orientation).toBeUndefined()
      expect(metadata.exif).toBeUndefined()
    }
  })

  it.each([
    ['corrupt.jpg', 'image/jpeg', 'image_decode_failed'],
    ['unsupported.tiff', 'image/tiff', 'unsupported_image_format'],
    ['animated.gif', 'image/gif', 'animated_image_not_supported'],
  ])('rejects %s explicitly instead of emitting misleading variants', async (name, mimeType, code) => {
    const bytes = await readFile(fixturePath(name))

    await expect(
      processProductPhotoBytes({
        bytes,
        expectedChecksumSha256: sha256Base64(bytes),
        expectedMimeType: mimeType,
      }),
    ).rejects.toMatchObject({ code })
  })

  it.each([
    ['too-wide.png', 'image_dimensions_exceeded'],
    ['too-many-pixels.png', 'image_pixels_exceeded'],
  ])('rejects unsafe decoded dimensions from %s', async (name, code) => {
    const bytes = await readFile(fixturePath(name))

    await expect(
      processProductPhotoBytes({
        bytes,
        expectedChecksumSha256: sha256Base64(bytes),
        expectedMimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code })
  })

  it('rejects checksum and actual-content mismatches before exposing output', async () => {
    const bytes = await readFile(fixturePath('rotated-exif.jpg'))

    await expect(
      processProductPhotoBytes({
        bytes,
        expectedChecksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
        expectedMimeType: 'image/jpeg',
      }),
    ).rejects.toBeInstanceOf(ProductPhotoProcessingError)
    await expect(
      processProductPhotoBytes({
        bytes,
        expectedChecksumSha256: sha256Base64(bytes),
        expectedMimeType: 'image/png',
      }),
    ).rejects.toMatchObject({ code: 'content_type_mismatch' })
  })

  it('rejects stored byte-size mismatches and objects above the photo upload policy', async () => {
    const bytes = await readFile(fixturePath('rotated-exif.jpg'))
    await expect(
      processProductPhotoBytes({
        bytes,
        expectedChecksumSha256: sha256Base64(bytes),
        expectedMimeType: 'image/jpeg',
        expectedSizeBytes: bytes.byteLength + 1,
      }),
    ).rejects.toMatchObject({ code: 'size_mismatch' })

    const oversized = new Uint8Array(10 * 1024 * 1024 + 1)
    await expect(
      processProductPhotoBytes({
        bytes: oversized,
        expectedChecksumSha256: sha256Base64(oversized),
        expectedMimeType: 'image/jpeg',
        expectedSizeBytes: oversized.byteLength,
      }),
    ).rejects.toMatchObject({ code: 'file_too_large' })
  })
})

describe('product photo processing lifecycle', () => {
  it('persists private variants once and returns the completed result on repeat processing', async () => {
    const bytes = await readFile(fixturePath('rotated-exif.jpg'))
    const attachment = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      objectKey: 'attachments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256Base64(bytes),
    }
    let status: 'UPLOADED' | 'PROCESSING' | 'AVAILABLE' | 'FAILED' = 'UPLOADED'
    let persisted: readonly ProductPhotoVariantMetadata[] = []
    let writes = 0
    const repository: ProductPhotoProcessingRepository = {
      async claim(attachmentId) {
        expect(attachmentId).toBe(attachment.id)
        if (status === 'AVAILABLE') return { kind: 'available', variants: persisted }
        status = 'PROCESSING'
        return { kind: 'process', attachment }
      },
      async complete(attachmentId, variants) {
        expect(attachmentId).toBe(attachment.id)
        persisted = variants
        status = 'AVAILABLE'
      },
      async fail() {
        status = 'FAILED'
      },
    }
    const storage = {
      async read(key: string) {
        expect(key).toBe(attachment.objectKey)
        return bytes
      },
      async putPrivate() {
        writes += 1
      },
      async delete() {},
    }
    const service = createProductPhotoProcessingService({ repository, storage })

    const first = await service.process(attachment.id)
    const repeated = await service.process(attachment.id)

    expect(status).toBe('AVAILABLE')
    expect(writes).toBe(2)
    expect(first).toEqual(repeated)
    expect(first).toHaveLength(2)
    expect(
      first.every((variant) =>
        /^attachments\/[0-9a-f-]+\/[0-9a-f-]+$/.test(variant.objectKey),
      ),
    ).toBe(true)
    expect(first.every((variant) => !('bytes' in variant))).toBe(true)
  })

  it('removes partial private variants and marks the attachment failed when storage fails', async () => {
    const bytes = await readFile(fixturePath('rotated-exif.jpg'))
    const attachment = {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      objectKey: 'attachments/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      mimeType: 'image/jpeg',
      sizeBytes: bytes.byteLength,
      checksumSha256: sha256Base64(bytes),
    }
    const deleted: string[] = []
    const failures: string[] = []
    let writeAttempt = 0
    const repository: ProductPhotoProcessingRepository = {
      async claim() {
        return { kind: 'process', attachment }
      },
      async complete() {},
      async fail(_attachmentId, code) {
        failures.push(code)
      },
    }
    const service = createProductPhotoProcessingService({
      repository,
      storage: {
        async read() {
          return bytes
        },
        async putPrivate() {
          writeAttempt += 1
          if (writeAttempt === 2) throw new Error('storage unavailable')
        },
        async delete(key) {
          deleted.push(key)
        },
      },
    })

    await expect(service.process(attachment.id)).rejects.toThrow('storage unavailable')

    expect(deleted).toHaveLength(1)
    expect(failures).toEqual(['variant_storage_failed'])
  })
})
