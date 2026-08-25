import { createHash, randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import {
  DOCUMENT_LOGO_MAX_SIZE_BYTES,
  documentLogoUploadDeclarationSchema,
} from '@/domain/settings/document-logo-assets'
import {
  createDocumentLogoService,
  createInMemoryDocumentLogoAuditSink,
  createInMemoryDocumentLogoRepository,
  createInMemoryDocumentLogoStorage,
  type DocumentLogoActivationTransaction,
  type DocumentLogoActor,
} from '@/lib/settings/document-logo-service.server'

const png = await readFile(new URL('../support/fixture-logo.png', import.meta.url))
const pngChecksumBase64 = createHash('sha256').update(png).digest('base64')
const pngChecksumHex = createHash('sha256').update(png).digest('hex')

const admin: DocumentLogoActor = { id: randomUUID(), role: 'admin' }
const representative: DocumentLogoActor = {
  id: randomUUID(),
  role: 'representative',
}
const now = new Date('2026-08-21T12:00:00.000Z')

function declaration() {
  return {
    filename: 'logo.png',
    mimeType: 'image/png' as const,
    sizeBytes: png.byteLength,
    checksumSha256: pngChecksumBase64,
  }
}

type ActivationCall = Readonly<{
  assetId: string
  expectedVersion: number
  nextVersion: number
}>

function setup(options: {
  settingsVersion?: number | null
  currentLogoAssetId?: string | null
  activationOutcome?: 'ok' | 'conflict' | 'not-found'
  stagedGraceMs?: number
} = {}) {
  let currentTime = now
  const repository = createInMemoryDocumentLogoRepository()
  const storage = createInMemoryDocumentLogoStorage()
  const audit = createInMemoryDocumentLogoAuditSink()
  const activationCalls: ActivationCall[] = []
  const activation: DocumentLogoActivationTransaction = async (input) => {
    activationCalls.push({
      assetId: input.assetId,
      expectedVersion: input.expectedVersion,
      nextVersion: input.nextVersion,
    })
    if (options.activationOutcome === 'conflict') {
      return { ok: false, outcome: 'conflict' }
    }
    if (options.activationOutcome === 'not-found') {
      return { ok: false, outcome: 'not-found' }
    }
    // Mirror the real transaction: the committed swap flips the staged asset
    // to active together with the settings reference.
    const asset = await repository.findById(input.assetId)
    if (asset) {
      await repository.insert({ ...asset, status: 'active' })
    }
    return { ok: true, version: input.nextVersion }
  }

  const service = createDocumentLogoService({
    repository,
    storage,
    audit,
    activation,
    settings: {
      currentVersion: async () =>
        options.settingsVersion === undefined ? 1 : options.settingsVersion,
      currentLogoAssetId: async () =>
        options.currentLogoAssetId === undefined
          ? null
          : options.currentLogoAssetId,
    },
    authenticate: async (actor) => actor ?? null,
    now: () => currentTime,
    stagedGraceMs: options.stagedGraceMs ?? 60_000,
  })

  async function stageAndUpload() {
    const initiated = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })
    if (!('assetId' in initiated)) throw new Error('initiation failed')
    await storage.putPrivate({
      key: `document-logos/${initiated.assetId}`,
      bytes: new Uint8Array(png),
      mimeType: 'image/png',
    })
    return initiated.assetId
  }

  return {
    activationCalls,
    audit,
    repository,
    service,
    storage,
    setNow(value: Date) {
      currentTime = value
    },
    stageAndUpload,
  }
}

describe('document logo upload declarations', () => {
  it('accepts the canonical PNG fixture declaration', () => {
    expect(documentLogoUploadDeclarationSchema.parse(declaration())).toEqual(
      declaration(),
    )
  })

  it('rejects oversized, non-image, and malformed declarations', () => {
    expect(
      documentLogoUploadDeclarationSchema.safeParse({
        ...declaration(),
        sizeBytes: DOCUMENT_LOGO_MAX_SIZE_BYTES + 1,
      }).success,
    ).toBe(false)
    expect(
      documentLogoUploadDeclarationSchema.safeParse({
        ...declaration(),
        mimeType: 'application/pdf',
      }).success,
    ).toBe(false)
    expect(
      documentLogoUploadDeclarationSchema.safeParse({
        ...declaration(),
        checksumSha256: 'not-a-checksum',
      }).success,
    ).toBe(false)
    expect(documentLogoUploadDeclarationSchema.safeParse({
      ...declaration(),
      extra: true,
    }).success).toBe(false)
  })
})

describe('document logo pipeline authorization', () => {
  it('fails closed for unauthenticated callers on every mutating and read path', async () => {
    const { service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()

    await expect(
      service.initiateUpload({ actor: null, declaration: declaration() }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      service.finalizeUpload({ actor: null, assetId }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      service.activateLogo({ actor: null, assetId, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      service.previewLogo({ actor: null, assetId }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
    await expect(
      service.purgeAbandonedStagedAssets({ actor: null }),
    ).rejects.toMatchObject({ code: 'UNAUTHENTICATED' })
  })

  it('forbids non-admin actors', async () => {
    const { service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()

    await expect(
      service.initiateUpload({ actor: representative, declaration: declaration() }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.finalizeUpload({ actor: representative, assetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.activateLogo({ actor: representative, assetId, expectedVersion: 1 }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(
      service.previewLogo({ actor: representative, assetId }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('document logo upload lifecycle', () => {
  it('stages an upload with a short-lived signed PUT URL and audits initiation', async () => {
    const { audit, service } = setup()
    const result = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })

    expect(result).toMatchObject({
      assetId: expect.any(String),
      upload: { method: 'PUT', url: expect.stringContaining('signed-upload.test') },
    })
    expect(audit.snapshot()).toHaveLength(1)
    expect(audit.snapshot()[0]).toMatchObject({
      action: 'document_logo.upload.initiated',
      actorId: admin.id,
      outcome: 'OK',
    })
  })

  it('reuses the staged object when the same bytes are re-declared', async () => {
    const { repository, service } = setup()
    const first = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })
    if (!('assetId' in first)) throw new Error('first initiation failed')
    const second = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })

    expect(second).toMatchObject({ assetId: first.assetId })
    expect(repository.snapshot()).toHaveLength(1)
  })

  it('finalizes a valid upload with verified dimensions', async () => {
    const { service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()

    const finalized = await service.finalizeUpload({ actor: admin, assetId })
    expect(finalized).toMatchObject({
      id: assetId,
      status: 'staged',
      mimeType: 'image/png',
      width: 8,
      height: 8,
    })
  })

  it('rejects corrupted bytes with CHECKSUM_MISMATCH and keeps the previous logo usable', async () => {
    const { audit, repository, service, stageAndUpload, storage } = setup({
      currentLogoAssetId: '0aaaaaaaaaaa4aaa8aaaaaaaaaaaaa01',
    })
    const previousActive = {
      id: '0aaaaaaaaaaa4aaa8aaaaaaaaaaaaa01',
      status: 'active' as const,
      objectKey: 'document-logos/0aaaaaaaaaaa4aaa8aaaaaaaaaaaaa01',
      originalFilename: 'anterior.png',
      mimeType: 'image/png',
      sizeBytes: BigInt(png.byteLength),
      checksumSha256: pngChecksumHex,
      width: 8,
      height: 8,
      createdAt: now,
      createdByUserId: admin.id,
    }
    // The previously active logo remains in place: metadata and bytes seeded
    // so the render path can prove it stays usable after a failed upload.
    repository.seed(previousActive)
    storage.seed(previousActive.objectKey, new Uint8Array(png))

    const assetId = await stageAndUpload()
    // Corrupt the stored object after staging, keeping the declared size so
    // the checksum check (not the size gate) is what rejects it.
    const tampered = new Uint8Array(png.byteLength)
    tampered.fill(0x5a)
    await storage.putPrivate({
      key: `document-logos/${assetId}`,
      bytes: tampered,
      mimeType: 'image/png',
    })

    const failed = await service.finalizeUpload({ actor: admin, assetId })
    expect(failed).toEqual({ error: 'CHECKSUM_MISMATCH' })
    expect(audit.snapshot().at(-1)).toMatchObject({
      action: 'document_logo.upload.failed',
      outcome: 'CHECKSUM_MISMATCH',
    })

    // The render path still serves the previous active logo's verified bytes.
    const rendered = await service.readActiveLogoForRender({
      assetId: previousActive.id,
    })
    expect(rendered).not.toBeNull()
  })

  it('rejects non-image content at finalization', async () => {
    const { service, storage } = setup()
    const initiated = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })
    if (!('assetId' in initiated)) throw new Error('initiation failed')
    await storage.putPrivate({
      key: `document-logos/${initiated.assetId}`,
      bytes: new Uint8Array(Buffer.from('definitely not an image')),
      mimeType: 'image/png',
    })

    const failed = await service.finalizeUpload({
      actor: admin,
      assetId: initiated.assetId,
    })
    expect(failed).toMatchObject({ error: expect.stringMatching(/IMAGE_DECODE|CHECKSUM|SIZE/) })
  })

  it('returns STORAGE_UNAVAILABLE instead of throwing when signing fails', async () => {
    const repository = createInMemoryDocumentLogoRepository()
    const failingStorage = {
      signUpload: async () => {
        throw new Error('s3 down')
      },
      signDownload: async () => {
        throw new Error('s3 down')
      },
      read: async () => null,
      putPrivate: async () => undefined,
      delete: async () => undefined,
    }
    const service = createDocumentLogoService({
      repository,
      storage: failingStorage,
      activation: async () => ({ ok: true as const, version: 2 }),
      settings: { currentVersion: async () => 1, currentLogoAssetId: async () => null },
      audit: createInMemoryDocumentLogoAuditSink(),
      authenticate: async (actor) => actor ?? null,
      now: () => now,
    })

    const result = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })
    expect(result).toEqual({ error: 'STORAGE_UNAVAILABLE' })
  })
})

describe('document logo activation', () => {
  it('commits atomically through the activation transaction and bumps one version', async () => {
    const { activationCalls, service, stageAndUpload } = setup({
      settingsVersion: 3,
    })
    const assetId = await stageAndUpload()

    const result = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 3,
    })

    expect(result).toMatchObject({ ok: true, version: 4 })
    expect(activationCalls).toEqual([
      { assetId, expectedVersion: 3, nextVersion: 4 },
    ])
  })

  it('refuses a stale expected version without touching the transaction', async () => {
    const { activationCalls, service, stageAndUpload } = setup({
      settingsVersion: 5,
    })
    const assetId = await stageAndUpload()

    const result = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 4,
    })

    expect(result).toEqual({ ok: false, error: 'CONFLICT' })
    expect(activationCalls).toEqual([])
  })

  it('surfaces a transaction conflict and leaves the asset staged', async () => {
    const { repository, service, stageAndUpload } = setup({
      activationOutcome: 'conflict',
    })
    const assetId = await stageAndUpload()

    const result = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 1,
    })

    expect(result).toEqual({ ok: false, error: 'CONFLICT' })
    expect(repository.snapshot()[0]).toMatchObject({ status: 'staged' })
  })

  it('reports not-found when no settings record exists', async () => {
    const { service, stageAndUpload } = setup({ settingsVersion: null })
    const assetId = await stageAndUpload()

    const result = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 1,
    })
    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' })
  })

  it('refuses to activate an already active asset', async () => {
    const { service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()
    // First activation commits; a second attempt must be refused.
    const first = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 1,
    })
    expect(first).toMatchObject({ ok: true })

    const result = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 2,
    })
    expect(result).toEqual({ ok: false, error: 'INVALID_STATE' })
  })
})

describe('document logo preview and render access', () => {
  it('issues a short-lived signed preview URL and never exposes the object key', async () => {
    const { audit, service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()

    const result = await service.previewLogo({ actor: admin, assetId })
    if (!('preview' in result)) throw new Error('preview failed')
    expect(result.preview.method).toBe('GET')
    expect(result.preview.url).toContain('signed-download.test')
    expect(JSON.stringify(result)).not.toContain(`document-logos/${assetId}`)
    expect(audit.snapshot().at(-1)).toMatchObject({
      action: 'document_logo.preview.authorized',
      outcome: 'OK',
    })
  })

  it('serves verified bytes on the render path and fails closed on corruption', async () => {
    const { service, stageAndUpload, storage } = setup()
    const assetId = await stageAndUpload()

    // Promote to active through the fake activation semantics used by tests:
    // readActiveLogoForRender requires status 'active'.
    const activated = await service.activateLogo({
      actor: admin,
      assetId,
      expectedVersion: 1,
    })
    expect(activated).toMatchObject({ ok: true })

    const rendered = await service.readActiveLogoForRender({ assetId })
    expect(rendered).not.toBeNull()
    expect(Array.from(rendered!.bytes)).toEqual(Array.from(png))

    // Corrupt the stored object: the render path must refuse it.
    await storage.putPrivate({
      key: `document-logos/${assetId}`,
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: 'image/png',
    })
    expect(await service.readActiveLogoForRender({ assetId })).toBeNull()
  })

  it('never serves a staged or purged asset on the render path', async () => {
    const { service, stageAndUpload } = setup()
    const assetId = await stageAndUpload()
    expect(await service.readActiveLogoForRender({ assetId })).toBeNull()
  })
})

describe('abandoned staged asset cleanup', () => {
  it('purges only staged assets past the grace period and deletes their objects', async () => {
    const { repository, service, setNow, stageAndUpload, storage } = setup({
      stagedGraceMs: 60_000,
    })
    // The upload is staged at t0; the clock then jumps past the grace period
    // before the sweep, making it the purge candidate.
    const staleId = await stageAndUpload()
    setNow(new Date(now.getTime() + 120_000))

    const result = await service.purgeAbandonedStagedAssets({ actor: admin })
    expect(result).toEqual({ purged: 1, failed: 0 })
    expect(storage.keys()).not.toContain(`document-logos/${staleId}`)

    // A purged asset's identity is spent: re-declaring the same bytes stages
    // a brand-new asset instead of resurrecting the purged one.
    const restaged = await service.initiateUpload({
      actor: admin,
      declaration: declaration(),
    })
    if (!('assetId' in restaged)) throw new Error('restaging failed')
    expect(restaged.assetId).not.toBe(staleId)
    expect(await repository.findById(restaged.assetId)).toMatchObject({
      status: 'staged',
      checksumSha256: pngChecksumHex,
    })
  })

  it('refuses to purge an active asset regardless of age', async () => {
    const { service, setNow, stageAndUpload } = setup({
      stagedGraceMs: 60_000,
    })
    const assetId = await stageAndUpload()
    await service.activateLogo({ actor: admin, assetId, expectedVersion: 1 })
    setNow(new Date(now.getTime() + 10 * 60_000))

    const result = await service.purgeAbandonedStagedAsset({ actor: admin, assetId })
    expect(result).toEqual({ error: 'INVALID_STATE' })
  })

  it('keeps recent staged assets within the grace period', async () => {
    const { service, stageAndUpload } = setup({ stagedGraceMs: 60_000 })
    const assetId = await stageAndUpload()

    const result = await service.purgeAbandonedStagedAsset({ actor: admin, assetId })
    expect(result).toEqual({ error: 'INVALID_STATE' })
  })
})
