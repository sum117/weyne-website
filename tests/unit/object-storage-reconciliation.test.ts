import { describe, expect, it } from 'vitest'
import {
  buildObjectStorageReconciliation,
  createFakeReconciliationInput,
} from '@/lib/storage/reconciliation'

const capturedAt = new Date('2026-08-17T12:00:00.000Z')

describe('buildObjectStorageReconciliation', () => {
  it('reports missing references and aged orphans without exposing object keys', () => {
    const report = buildObjectStorageReconciliation({
      databaseCapturedAt: capturedAt,
      inventoryCapturedAt: capturedAt,
      orphanGracePeriodMs: 24 * 60 * 60 * 1_000,
      references: [
        {
          key: 'attachments/present-object',
          source: 'product_attachments',
          recordId: 'record-present',
        },
        {
          key: 'attachments/missing-object',
          source: 'quote_pdf_artifacts',
          recordId: 'record-missing',
        },
      ],
      inventory: [
        {
          key: 'attachments/present-object',
          lastModified: new Date('2026-08-15T12:00:00.000Z'),
          sizeBytes: 10,
        },
        {
          key: 'attachments/orphan-object',
          lastModified: new Date('2026-08-15T12:00:00.000Z'),
          sizeBytes: 20,
        },
      ],
    })
    const serialized = JSON.stringify(report)

    expect(report.status).toBe('discrepancies')
    expect(report.summary).toEqual({
      referencedObjects: 2,
      inventoryObjects: 2,
      missingObjects: 1,
      orphanedObjects: 1,
      recentUnreferencedObjects: 0,
    })
    expect(report.discrepancies.map(({ kind }) => kind)).toEqual([
      'missing_object',
      'orphaned_object',
    ])
    expect(report.discrepancies[0]).toMatchObject({
      severity: 'critical',
      source: 'quote_pdf_artifacts',
      nextAction: 'restore_or_reconcile_database_reference',
    })
    expect(report.discrepancies[1]).toMatchObject({
      severity: 'warning',
      nextAction: 'investigate_orphan_after_grace_period',
    })
    expect(serialized).not.toContain('attachments/')
    expect(serialized).not.toContain('record-missing')
    expect(report.discrepancies[0]?.objectFingerprint).toMatch(/^sha256:[0-9a-f]{16}$/)
  })

  it('ignores recent unreferenced objects during the deletion grace period', () => {
    const report = buildObjectStorageReconciliation({
      databaseCapturedAt: capturedAt,
      inventoryCapturedAt: capturedAt,
      orphanGracePeriodMs: 7 * 24 * 60 * 60 * 1_000,
      references: [],
      inventory: [
        {
          key: 'attachments/in-flight-upload',
          lastModified: new Date('2026-08-16T12:00:00.000Z'),
          sizeBytes: 20,
        },
      ],
    })

    expect(report.status).toBe('ok')
    expect(report.summary.recentUnreferencedObjects).toBe(1)
    expect(report.discrepancies).toEqual([])
  })

  it('produces deterministic deduplicated output for repeated inventories', () => {
    const input = createFakeReconciliationInput(capturedAt)
    const first = buildObjectStorageReconciliation(input)
    const second = buildObjectStorageReconciliation({
      ...input,
      references: [...input.references].reverse(),
      inventory: [...input.inventory, input.inventory[0]!].reverse(),
    })

    expect(second).toEqual(first)
    expect(first.summary.missingObjects).toBe(1)
    expect(first.summary.orphanedObjects).toBe(1)
  })
})
