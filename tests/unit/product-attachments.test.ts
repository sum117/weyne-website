import { describe, expect, it } from 'vitest'
import {
  PRODUCT_ATTACHMENT_CATEGORIES,
  PRODUCT_ATTACHMENT_POLICIES,
  PRODUCT_ATTACHMENT_UPLOAD_STATUSES,
  PRODUCT_PHOTO_IMAGE_LIMITS,
  PRODUCT_PHOTO_VARIANTS,
  ProductAttachmentValidationError,
  validateProductAttachmentDraft,
  validateProductPhotoDimensions,
  validateProductPhotoSet,
} from '@/domain/products/attachments'

const checksumSha256 = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='

const photoDraft = {
  category: 'PHOTO' as const,
  objectKey: 'attachments/019c6d9a-3d70-7f51-a273-8ca76ff952bc/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalFilename: 'Frasco 5L.jpg',
  displayLabel: null,
  documentVersion: null,
  effectiveDate: null,
  mimeType: 'image/jpeg',
  sizeBytes: 1_024,
  checksumSha256,
  uploadStatus: 'PENDING' as const,
  photoPosition: 0,
  isPrimary: true,
}

const documentDraft = {
  ...photoDraft,
  category: 'TECHNICAL_SHEET' as const,
  objectKey: 'attachments/019c6d9a-3d70-7f51-a273-8ca76ff952bc/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  originalFilename: 'ficha original.pdf',
  displayLabel: 'Ficha técnica — embalagem 5 L',
  documentVersion: 'Rev. 3',
  effectiveDate: '2026-08-01',
  mimeType: 'application/pdf',
  photoPosition: null,
  isPrimary: false,
}

describe('product attachment policy contract', () => {
  it('defines the three closed categories and lifecycle statuses', () => {
    expect(PRODUCT_ATTACHMENT_CATEGORIES).toEqual([
      'PHOTO',
      'TECHNICAL_SHEET',
      'FISPQ',
    ])
    expect(PRODUCT_ATTACHMENT_UPLOAD_STATUSES).toEqual([
      'PENDING',
      'UPLOADED',
      'PROCESSING',
      'AVAILABLE',
      'FAILED',
      'DELETING',
    ])
  })

  it('centralizes MIME and byte limits by category without consulting filenames', () => {
    expect(PRODUCT_ATTACHMENT_POLICIES.PHOTO.allowedMimeTypes).toEqual([
      'image/jpeg',
      'image/png',
      'image/webp',
    ])
    expect(PRODUCT_ATTACHMENT_POLICIES.TECHNICAL_SHEET.allowedMimeTypes).toEqual([
      'application/pdf',
    ])
    expect(PRODUCT_ATTACHMENT_POLICIES.FISPQ.allowedMimeTypes).toEqual([
      'application/pdf',
    ])
    expect(PRODUCT_ATTACHMENT_POLICIES.PHOTO.maxSizeBytes).toBe(10 * 1024 * 1024)
    expect(PRODUCT_ATTACHMENT_POLICIES.TECHNICAL_SHEET.maxSizeBytes).toBe(
      25 * 1024 * 1024,
    )
  })

  it('defines bounded aspect-preserving photo variants', () => {
    expect(PRODUCT_PHOTO_VARIANTS).toEqual([
      { key: 'THUMBNAIL', maxWidth: 320, maxHeight: 320, format: 'webp' },
      { key: 'DISPLAY', maxWidth: 1600, maxHeight: 1600, format: 'webp' },
    ])
  })

  it('rejects unsupported dimensions and decompression-sized images', () => {
    expect(() => validateProductPhotoDimensions(0, 800)).toThrow(
      expect.objectContaining({ code: 'invalid_image_dimensions' }),
    )
    expect(() =>
      validateProductPhotoDimensions(PRODUCT_PHOTO_IMAGE_LIMITS.maxWidth + 1, 1),
    ).toThrow(expect.objectContaining({ code: 'image_dimensions_exceeded' }))
    expect(() => validateProductPhotoDimensions(8_000, 6_000)).toThrow(
      expect.objectContaining({ code: 'image_pixels_exceeded' }),
    )
    expect(validateProductPhotoDimensions(4_000, 4_000)).toEqual({
      width: 4_000,
      height: 4_000,
    })
  })
})

describe('product attachment metadata', () => {
  it('accepts and normalizes protected document metadata', () => {
    expect(
      validateProductAttachmentDraft({
        ...documentDraft,
        originalFilename: '  ficha original.pdf  ',
        displayLabel: '  Ficha técnica — embalagem 5 L  ',
        documentVersion: '  Rev. 3  ',
      }),
    ).toMatchObject({
      category: 'TECHNICAL_SHEET',
      originalFilename: 'ficha original.pdf',
      displayLabel: 'Ficha técnica — embalagem 5 L',
      documentVersion: 'Rev. 3',
      effectiveDate: '2026-08-01',
    })
  })

  it('supports FISPQ documents under the same document contract', () => {
    expect(
      validateProductAttachmentDraft({ ...documentDraft, category: 'FISPQ' }),
    ).toMatchObject({ category: 'FISPQ', mimeType: 'application/pdf' })
  })

  it.each([
    [{ ...documentDraft, displayLabel: ' ' }, 'document_label_required'],
    [{ ...documentDraft, effectiveDate: '31/08/2026' }, 'invalid_effective_date'],
    [{ ...documentDraft, photoPosition: 0 }, 'document_photo_fields_forbidden'],
    [{ ...photoDraft, displayLabel: 'Product hero' }, 'photo_document_fields_forbidden'],
    [{ ...photoDraft, mimeType: 'application/pdf' }, 'disallowed_mime_type'],
    [{ ...photoDraft, objectKey: 'https://bucket.example/product.jpg' }, 'invalid_object_key'],
  ])('rejects invalid category metadata with stable codes', (draft, code) => {
    expect(() => validateProductAttachmentDraft(draft)).toThrow(
      ProductAttachmentValidationError,
    )
    try {
      validateProductAttachmentDraft(draft)
    } catch (error) {
      expect(error).toMatchObject({ code })
    }
  })
})

describe('product photo ordering', () => {
  it('allows no photos and one deterministic primary among contiguous positions', () => {
    expect(validateProductPhotoSet([])).toEqual([])
    expect(
      validateProductPhotoSet([
        { id: 'photo-b', photoPosition: 1, isPrimary: false },
        { id: 'photo-a', photoPosition: 0, isPrimary: true },
      ]),
    ).toEqual([
      { id: 'photo-a', photoPosition: 0, isPrimary: true },
      { id: 'photo-b', photoPosition: 1, isPrimary: false },
    ])
  })

  it.each([
    [[{ id: 'a', photoPosition: 0, isPrimary: false }], 'primary_photo_required'],
    [
      [
        { id: 'a', photoPosition: 0, isPrimary: true },
        { id: 'b', photoPosition: 1, isPrimary: true },
      ],
      'multiple_primary_photos',
    ],
    [
      [
        { id: 'a', photoPosition: 0, isPrimary: true },
        { id: 'b', photoPosition: 2, isPrimary: false },
      ],
      'non_contiguous_photo_positions',
    ],
  ])('rejects invalid photo sets with stable codes', (photos, code) => {
    expect(() => validateProductPhotoSet(photos)).toThrow(
      expect.objectContaining({ code }),
    )
  })
})
