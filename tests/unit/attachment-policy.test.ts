import { describe, expect, it } from 'vitest'
import {
  AttachmentPolicyError,
  createAttachmentObjectKey,
  createAttachmentPolicy,
  validateUploadDeclaration,
} from '@/lib/attachments/policy.server'

const policy = createAttachmentPolicy({
  allowedMimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  maxSizeBytes: 5_000_000,
})

const validDeclaration = {
  mimeType: 'application/pdf',
  sizeBytes: 1_024,
  checksumSha256: '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=',
}

describe('attachment upload policy', () => {
  it('accepts boundary sizes and normalizes an allowed MIME value', () => {
    expect(
      validateUploadDeclaration(policy, {
        ...validDeclaration,
        mimeType: '  APPLICATION/PDF  ',
        sizeBytes: policy.maxSizeBytes,
      }),
    ).toEqual({
      ...validDeclaration,
      sizeBytes: policy.maxSizeBytes,
    })

    expect(
      validateUploadDeclaration(policy, {
        ...validDeclaration,
        sizeBytes: 1,
      }).sizeBytes,
    ).toBe(1)
  })

  it.each([
    [undefined, 'missing_declaration'],
    [{}, 'invalid_mime_type'],
    [{ ...validDeclaration, mimeType: 'image/gif' }, 'disallowed_mime_type'],
    [{ ...validDeclaration, mimeType: 'application/pdf; charset=utf-8' }, 'invalid_mime_type'],
    [{ ...validDeclaration, mimeType: 'application/pdf\nimage/png' }, 'invalid_mime_type'],
    [{ ...validDeclaration, sizeBytes: 0 }, 'invalid_size'],
    [{ ...validDeclaration, sizeBytes: 1.5 }, 'invalid_size'],
    [{ ...validDeclaration, sizeBytes: 5_000_001 }, 'file_too_large'],
    [{ ...validDeclaration, checksumSha256: undefined }, 'invalid_checksum'],
    [{ ...validDeclaration, checksumSha256: 'not-base64' }, 'invalid_checksum'],
    [
      { ...validDeclaration, checksumSha256: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
      'invalid_checksum',
    ],
    [
      { ...validDeclaration, checksumSha256: '___________________________________________=' },
      'invalid_checksum',
    ],
  ])('rejects invalid declarations before use', (declaration, expectedCode) => {
    expect(() => validateUploadDeclaration(policy, declaration)).toThrow(
      AttachmentPolicyError,
    )

    try {
      validateUploadDeclaration(policy, declaration)
    } catch (error) {
      expect(error).toMatchObject({ code: expectedCode })
    }
  })

  it('validates policy configuration instead of silently weakening it', () => {
    expect(() =>
      createAttachmentPolicy({ allowedMimeTypes: [], maxSizeBytes: 1 }),
    ).toThrow(expect.objectContaining({ code: 'invalid_policy' }))
    expect(() =>
      createAttachmentPolicy({
        allowedMimeTypes: ['application/pdf; charset=utf-8'],
        maxSizeBytes: 1,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_policy' }))
    expect(() =>
      createAttachmentPolicy({
        allowedMimeTypes: ['application/pdf'],
        maxSizeBytes: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'invalid_policy' }))
  })
})

describe('attachment object keys', () => {
  it('generates unique opaque UUID keys without extensions', () => {
    const keys = Array.from({ length: 1_000 }, () => createAttachmentObjectKey())

    expect(new Set(keys)).toHaveLength(keys.length)
    for (const key of keys) {
      expect(key).toMatch(
        /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      )
      expect(key).not.toContain('.')
    }
  })

  it('allows only an opaque UUID as an optional scope', () => {
    const scopeId = '019c6d9a-3d70-7f51-a273-8ca76ff952bc'
    const key = createAttachmentObjectKey({ scopeId })

    expect(key).toMatch(
      new RegExp(
        `^attachments/${scopeId}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
      ),
    )
  })

  it.each([
    'customer@example.com',
    'Maria da Silva',
    'PED-2042-000001',
    '../tenant',
    'invoice.pdf',
  ])('cannot place user-provided names in generated keys: %s', (scopeId) => {
    expect(() => createAttachmentObjectKey({ scopeId })).toThrow(
      expect.objectContaining({ code: 'invalid_scope' }),
    )
  })
})
