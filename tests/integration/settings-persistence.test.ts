import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import postgres, { type Sql } from 'postgres'
import { drizzle } from 'drizzle-orm/postgres-js'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { businessSettingsSchema } from '@/domain/settings/business-settings'
import {
  createPostgresSettingsRepository,
  diffChangedFields,
} from '@/lib/settings/settings-repository.server'
import * as schema from '@/lib/db/schema'
import { resolveTestDatabaseUrl } from '../support/postgres-harness'

// The canonical migrations pin `public.*` identifiers, so this suite follows
// the canonical-schema-contract pattern: an isolated throwaway database whose
// `public` schema is recreated per test instead of the prefixed-schema harness.

const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const occurredAt = new Date('2026-08-21T12:00:00.000Z')

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

function canonicalSettings() {
  return businessSettingsSchema.parse(validSettingsInput)
}

const baseDatabaseUrl = resolveTestDatabaseUrl(process.env)
const isolatedDatabaseName = `settings_admin_${randomUUID().replaceAll('-', '')}`
const isolatedDatabaseUrl = new URL(baseDatabaseUrl)
isolatedDatabaseUrl.pathname = `/${isolatedDatabaseName}`
const administrativeClient = postgres(baseDatabaseUrl, {
  max: 1,
  prepare: false,
  connect_timeout: 10,
  idle_timeout: 5,
  onnotice: () => undefined,
})
let harness: Readonly<{ sql: Sql }>

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

async function applyCanonicalMigrations(client: Sql): Promise<void> {
  const directory = resolve(process.cwd(), 'drizzle/canonical')
  const migrationNames = (await readdir(directory))
    .filter((name) => name.endsWith('.sql'))
    .sort()
  for (const migrationName of migrationNames) {
    await client.unsafe(await readFile(resolve(directory, migrationName), 'utf8'))
  }
}

beforeAll(async () => {
  await administrativeClient.unsafe(`CREATE DATABASE ${quoteIdentifier(isolatedDatabaseName)}`)
  const client = postgres(isolatedDatabaseUrl.toString(), {
    max: 1,
    prepare: false,
    connect_timeout: 10,
    idle_timeout: 5,
    onnotice: () => undefined,
  })
  harness = Object.freeze({ sql: client })
})

beforeEach(async () => {
  await harness.sql`DROP SCHEMA public CASCADE`
  await harness.sql`CREATE SCHEMA public`
  await applyCanonicalMigrations(harness.sql)
})

afterAll(async () => {
  try {
    await harness?.sql.end({ timeout: 5 })
  } finally {
    try {
      await administrativeClient.unsafe(
        `DROP DATABASE IF EXISTS ${quoteIdentifier(isolatedDatabaseName)} WITH (FORCE)`,
      )
    } finally {
      await administrativeClient.end({ timeout: 5 })
    }
  }
})

async function seedBusinessRecord() {
  await harness.sql`
    INSERT INTO users (id, name, email, role, auth_subject)
    VALUES (${adminId}, 'Admin Fundador', ${`settings-${adminId}@example.test`}, 'admin', ${`subject-${adminId}`})
  `
  await harness.sql`
    INSERT INTO settings (key, value, created_by_user_id, updated_by_user_id)
    VALUES ('business', ${JSON.stringify(canonicalSettings())}::text::jsonb, ${adminId}, ${adminId})
  `
}

describe('settings persistence on PostgreSQL', () => {
  it('reads the canonical record with version metadata', async () => {
    await seedBusinessRecord()
    const repository = createPostgresSettingsRepository(drizzle(harness.sql, { schema }))
    const record = await repository.findRecord()
    expect(record).not.toBeNull()
    expect(record!.version).toBe(1)
    expect(record!.updatedByUserId).toBe(adminId)
    expect(record!.settings.documents.defaultQuoteValidityDays).toBe(15)
    expect(record!.settings.documents.numberingDisplay).toEqual({
      quotePrefix: 'ORC',
      orderPrefix: 'PED',
      separator: '-',
      yearDigits: 4,
      sequenceDigits: 6,
    })
  })

  it('applies a matching-version update atomically with its audit event', async () => {
    await seedBusinessRecord()
    const repository = createPostgresSettingsRepository(drizzle(harness.sql, { schema }))
    const correlationId = randomUUID()

    const result = await repository.updateRecord({
      expectedVersion: 1,
      settings: canonicalSettings(),
      actorUserId: adminId,
      occurredAt,
      correlationId,
    })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.record.version).toBe(2)

    const events = await harness.sql<{ action: string; entityType: string; metadata: Record<string, unknown> }[]>`
      SELECT action, entity_type AS "entityType", metadata
      FROM audit_events
      WHERE correlation_id = ${correlationId}
    `
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ action: 'settings.update', entityType: 'settings' })
    expect(events[0]!.metadata).toMatchObject({
      changedFields: [],
      previousVersion: 1,
      nextVersion: 2,
    })

    // The stored value stays the last-known valid canonical payload.
    const stored = await repository.findRecord()
    expect(stored!.version).toBe(2)
  })

  it('rejects stale writes without changing value, version, or audit trail', async () => {
    await seedBusinessRecord()
    const repository = createPostgresSettingsRepository(drizzle(harness.sql, { schema }))

    const first = await repository.updateRecord({
      expectedVersion: 1,
      settings: canonicalSettings(),
      actorUserId: adminId,
      occurredAt,
      correlationId: randomUUID(),
    })
    expect(first.ok).toBe(true)

    const stale = await repository.updateRecord({
      expectedVersion: 1,
      settings: businessSettingsSchema.parse({
        ...validSettingsInput,
        business: { ...validSettingsInput.business, displayName: 'Escrita Obsoleta' },
      }),
      actorUserId: adminId,
      occurredAt,
      correlationId: randomUUID(),
    })

    expect(stale).toMatchObject({ ok: false, outcome: 'conflict' })
    const record = await repository.findRecord()
    expect(record!.version).toBe(2)
    expect(record!.settings.business.displayName).toBe('Weyne Representações')
    const auditCount = await harness.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM audit_events
    `
    expect(auditCount[0]!.count).toBe('1')
  })

  it('rolls back both value and audit when the transaction fails mid-flight', async () => {
    await seedBusinessRecord()
    const repository = createPostgresSettingsRepository(drizzle(harness.sql, { schema }))

    // Force a failure after the UPDATE by violating the audit foreign key:
    // an unknown actor id makes the audit insert fail inside the same
    // transaction, so neither the new value nor a partial audit row survives.
    const outcome = await repository.updateRecord({
      expectedVersion: 1,
      settings: canonicalSettings(),
      actorUserId: randomUUID(),
      occurredAt,
      correlationId: randomUUID(),
    }).then(
      () => ({ threw: false }),
      () => ({ threw: true }),
    )

    expect(outcome.threw).toBe(true)
    const record = await repository.findRecord()
    expect(record!.version).toBe(1)
    const auditCount = await harness.sql<{ count: string }[]>`
      SELECT count(*)::text AS count FROM audit_events
    `
    expect(auditCount[0]!.count).toBe('0')
  })

  it('reports not-found when no settings row exists', async () => {
    const repository = createPostgresSettingsRepository(drizzle(harness.sql, { schema }))
    const result = await repository.updateRecord({
      expectedVersion: 1,
      settings: canonicalSettings(),
      actorUserId: adminId,
      occurredAt,
      correlationId: randomUUID(),
    })
    expect(result).toMatchObject({ ok: false, outcome: 'not-found' })
  })

  it('computes dotted changed-field paths between canonical payloads', async () => {
    const before = canonicalSettings()
    const after = businessSettingsSchema.parse({
      ...validSettingsInput,
      documents: { defaultQuoteValidityDays: 30 },
    })
    expect(diffChangedFields(before, after)).toEqual([
      'documents.defaultQuoteValidityDays',
    ])
    expect(diffChangedFields(before, before)).toEqual([])
  })
})
