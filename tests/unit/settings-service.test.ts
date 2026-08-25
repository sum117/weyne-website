import { describe, expect, it } from 'vitest'
import {
  businessSettingsSchema,
  type BusinessSettings,
  type SettingsRecord,
} from '@/domain/settings/business-settings'
import type { SettingsRepository } from '@/lib/settings/settings-repository.server'
import {
  createSettingsService,
  type SettingsActor,
  type SettingsServiceAuditEvent,
} from '@/lib/settings/settings-service.server'

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const representativeId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const occurredAt = new Date('2026-08-21T12:00:00.000Z')

const admin: SettingsActor = { id: adminId, role: 'admin' }
const representative: SettingsActor = { id: representativeId, role: 'representative' }
const readOnly: SettingsActor = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', role: 'read_only' }

const validSettingsInput = {
  business: {
    displayName: 'Weyne Representações',
    legalName: 'Weyne Representações Ltda.',
    taxId: null,
    email: 'contato@weyne.com.br',
    phone: null,
    address: null,
  },
  documents: {},
}

function canonicalSettings(): BusinessSettings {
  return businessSettingsSchema.parse(validSettingsInput)
}

function record(version: number, settings: BusinessSettings): SettingsRecord {
  return {
    settings,
    version,
    updatedAt: '2026-08-20T10:00:00.000Z',
    updatedByUserId: adminId,
  }
}

class MemorySettingsRepository implements SettingsRepository {
  current: SettingsRecord | null
  failPersistence: Error | null = null
  calls = 0

  constructor(initial: SettingsRecord | null) {
    this.current = initial
  }

  async findRecord() {
    this.calls += 1
    return this.current
  }

  async updateRecord(input: Readonly<{
    expectedVersion: number
    settings: BusinessSettings
    actorUserId: string
    occurredAt: Date
    correlationId: string
  }>) {
    this.calls += 1
    if (this.failPersistence) throw this.failPersistence
    if (!this.current) return { ok: false as const, outcome: 'not-found' as const }
    if (this.current.version !== input.expectedVersion) {
      return { ok: false as const, outcome: 'conflict' as const }
    }
    const next = record(this.current.version + 1, input.settings)
    this.current = next
    return {
      ok: true as const,
      record: next,
      audit: {
        actorUserId: input.actorUserId,
        actorRole: 'admin' as const,
        action: 'settings.update' as const,
        occurredAt: input.occurredAt,
        correlationId: input.correlationId,
        before: null,
        after: input.settings,
        changedFields: ['business.displayName'],
        previousVersion: input.expectedVersion,
        nextVersion: next.version,
      },
    }
  }

  async appendAudit() {}
}

function service(overrides: Partial<{
  repository: MemorySettingsRepository
  actor: SettingsActor | null
}> = {}) {
  const repository = overrides.repository ?? new MemorySettingsRepository(record(1, canonicalSettings()))
  const events: SettingsServiceAuditEvent[] = []
  const unexpected: unknown[] = []
  const instance = createSettingsService({
    repository,
    audit: {
      async append(event) {
        events.push(event)
      },
    },
    logUnexpectedError: (cause) => unexpected.push(cause),
    createCorrelationId: () => 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    now: () => occurredAt,
  })
  return { instance, repository, events, unexpected }
}

describe('settings service authorization', () => {
  it('denies unauthenticated reads and updates', async () => {
    const { instance, events } = service()

    const read = await instance.getSettings(null)
    const update = await instance.updateSettings(null, {
      expectedVersion: 1,
      settings: validSettingsInput,
    })

    expect(read).toMatchObject({ ok: false, error: { category: 'unauthenticated' } })
    expect(update).toMatchObject({ ok: false, error: { category: 'unauthenticated' } })
    expect(events.map((event) => event.outcome)).toEqual(['unauthenticated', 'unauthenticated'])
  })

  it('denies non-admin roles without touching the record', async () => {
    for (const actor of [representative, readOnly]) {
      const { instance, repository, events } = service({ actor })
      const read = await instance.getSettings(actor)
      const update = await instance.updateSettings(actor, {
        expectedVersion: 1,
        settings: validSettingsInput,
      })
      expect(read).toMatchObject({ ok: false, error: { category: 'forbidden' } })
      expect(update).toMatchObject({ ok: false, error: { category: 'forbidden' } })
      expect(repository.calls).toBe(0)
      expect(events.every((event) => event.outcome === 'forbidden')).toBe(true)
    }
  })

  it('lets an admin read the canonical record', async () => {
    const { instance } = service()
    const result = await instance.getSettings(admin)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe(1)
      expect(result.data.settings.documents.defaultQuoteValidityDays).toBe(15)
    }
  })
})

describe('settings service update path', () => {
  it('validates payloads with the shared schema and rejects unknown keys', async () => {
    const { instance, repository } = service()

    const malformed = await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: {
        ...validSettingsInput,
        documents: { featureFlags: { newQuoteFlow: true } },
      },
    })
    expect(malformed).toMatchObject({
      ok: false,
      error: { category: 'validation' },
    })

    const staleShape = await instance.updateSettings(admin, {
      expectedVersion: 0,
      settings: validSettingsInput,
    })
    expect(staleShape).toMatchObject({ ok: false, error: { category: 'validation' } })

    expect(repository.calls).toBe(0)
  })

  it('rejects numbering counter tampering through strict validation', async () => {
    const { instance, repository } = service()
    const result = await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: {
        ...validSettingsInput,
        documents: {
          nextQuoteNumber: 9000,
          nextOrderNumber: 500,
        },
      },
    })
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } })
    expect(repository.calls).toBe(0)
  })

  it('applies a matching-version update and bumps exactly one version', async () => {
    const { instance, repository } = service()
    const changed = {
      ...validSettingsInput,
      business: { ...validSettingsInput.business, displayName: 'Weyne Representações Ltda.' },
    }
    const result = await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: changed,
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.data.version).toBe(2)
      expect(result.data.settings.business.displayName).toBe('Weyne Representações Ltda.')
    }
    expect(repository.current?.version).toBe(2)
  })

  it('rejects stale writes with a machine-readable conflict and preserves the record', async () => {
    const { instance, repository } = service()
    repository.current = record(7, canonicalSettings())

    const result = await instance.updateSettings(admin, {
      expectedVersion: 3,
      settings: validSettingsInput,
    })

    expect(result).toMatchObject({
      ok: false,
      error: { category: 'conflict', currentRecord: { version: 7 } },
    })
    expect(repository.current?.version).toBe(7)
  })

  it('keeps the last-known valid record when persistence fails', async () => {
    const { instance, repository, unexpected } = service()
    repository.failPersistence = new Error('database unavailable')

    const result = await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: validSettingsInput,
    })

    expect(result).toMatchObject({ ok: false, error: { category: 'unexpected' } })
    expect(repository.current?.version).toBe(1)
    expect(unexpected.length > 0).toBe(true)
  })

  it('reports not-found when no settings row exists yet', async () => {
    const { instance } = service({ repository: new MemorySettingsRepository(null) })
    const result = await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: validSettingsInput,
    })
    expect(result).toMatchObject({ ok: false, error: { category: 'not-found' } })
  })
})

describe('settings audit hygiene', () => {
  it('records success outcomes with changed fields and never payload values', async () => {
    const { instance, events } = service()
    await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: validSettingsInput,
    })
    const successEvent = events.find((event) => event.outcome === 'succeeded')
    expect(successEvent).toBeDefined()
    expect(successEvent!.actorId).toBe(adminId)
    expect(JSON.stringify(events)).not.toContain('weyne.com.br')
    expect(JSON.stringify(events)).not.toContain('Weyne Representações')
  })

  it('records conflict and validation outcomes without payload data', async () => {
    const { instance, events } = service()
    await instance.updateSettings(admin, {
      expectedVersion: 999,
      settings: validSettingsInput,
    })
    await instance.updateSettings(admin, {
      expectedVersion: 1,
      settings: { business: {} } as never,
    })
    expect(events.map((event) => event.outcome)).toEqual(['conflict', 'validation_failed'])
    expect(JSON.stringify(events)).not.toContain('expectedVersion')
  })
})
