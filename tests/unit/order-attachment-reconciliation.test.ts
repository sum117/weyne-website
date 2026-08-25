import { describe, expect, it } from 'vitest'
import {
  createFakeOrderAttachmentReconciliationSource,
  createInMemoryOrderAttachmentCleanupSink,
  reconcileOrderAttachments,
  type OrderAttachmentRecord,
} from '@/lib/storage/order-attachment-reconciliation'

const now = new Date('2026-08-21T12:00:00.000Z')
const DAY_MS = 24 * 60 * 60 * 1_000

function attachment(
  overrides: Partial<OrderAttachmentRecord> & { id: string },
): OrderAttachmentRecord {
  return {
    objectKey: `attachments/11111111-1111-4111-8111-111111111111/${overrides.id}`,
    state: 'ready',
    createdAt: new Date(now.getTime() - 2 * DAY_MS),
    updatedAt: new Date(now.getTime() - 2 * DAY_MS),
    ...overrides,
  }
}

function baseOptions(
  source: ReturnType<typeof createFakeOrderAttachmentReconciliationSource>,
  overrides: Record<string, unknown> = {},
) {
  return {
    source,
    now,
    pendingGracePeriodMs: DAY_MS,
    orphanGracePeriodMs: 7 * DAY_MS,
    ...overrides,
  }
}

describe('reconcileOrderAttachments', () => {
  it('classifies every inconsistency class without exposing keys or identifiers', async () => {
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments: [
        attachment({ id: 'a-ready', state: 'ready' }),
        attachment({ id: 'a-missing', state: 'ready', objectKey: 'attachments/x/missing' }),
        attachment({
          id: 'a-abandoned-no-object',
          state: 'pending',
          createdAt: new Date(now.getTime() - 3 * DAY_MS),
          updatedAt: new Date(now.getTime() - 3 * DAY_MS),
          objectKey: 'attachments/x/abandoned-empty',
        }),
        attachment({
          id: 'a-deleting-leftover',
          state: 'deleting',
          updatedAt: new Date(now.getTime() - 9 * DAY_MS),
          objectKey: 'attachments/x/deleting-leftover',
        }),
      ],
      objects: [
        {
          key: 'attachments/11111111-1111-4111-8111-111111111111/a-ready',
          lastModified: new Date(now.getTime() - DAY_MS),
          sizeBytes: 10,
        },
        { key: 'attachments/x/deleting-leftover', lastModified: new Date(now.getTime() - 9 * DAY_MS), sizeBytes: 30 },
        { key: 'attachments/x/aged-orphan', lastModified: new Date(now.getTime() - 9 * DAY_MS), sizeBytes: 40 },
      ],
    })

    const report = await reconcileOrderAttachments(baseOptions(source))

    expect(report.status).toBe('discrepancies')
    expect(report.summary).toEqual({
      attachmentRecords: 4,
      inventoryObjects: 3,
      missingObjects: 1,
      abandonedUploads: 1,
      orphanedObjects: 2,
      inFlightUploads: 0,
      recentUnreferencedObjects: 0,
    })
    const kinds = report.discrepancies.map(({ kind }) => kind).sort()
    expect(kinds).toEqual(['abandoned_upload', 'missing_object', 'orphaned_object', 'orphaned_object'])

    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain('attachments/')
    expect(serialized).not.toContain('a-ready')
    expect(serialized).not.toContain('11111111')
    for (const discrepancy of report.discrepancies) {
      expect(discrepancy.objectFingerprint).toMatch(/^sha256:[0-9a-f]{16}$/)
    }
  })

  it('never flags active uploads or recent unreferenced objects', async () => {
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments: [
        attachment({ id: 'a-fresh-pending', state: 'pending', createdAt: now, updatedAt: now }),
        attachment({ id: 'a-ready-present', state: 'ready', objectKey: 'attachments/x/a-ready-present' }),
      ],
      objects: [
        { key: 'attachments/x/a-ready-present', lastModified: now, sizeBytes: 10 },
        // Object uploaded seconds ago whose metadata insert has not landed yet.
        { key: 'attachments/x/race-upload', lastModified: new Date(now.getTime() - 5_000), sizeBytes: 99 },
      ],
    })

    const report = await reconcileOrderAttachments(baseOptions(source))

    expect(report.status).toBe('ok')
    expect(report.summary.inFlightUploads).toBe(1)
    expect(report.summary.recentUnreferencedObjects).toBe(1)
    expect(report.summary.missingObjects).toBe(0)
    expect(report.summary.orphanedObjects).toBe(0)
    expect(report.destructiveActionsPerformed).toBe(false)
  })

  it('survives a concurrent upload racing the inventory snapshot', async () => {
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments: [attachment({ id: 'a-race', state: 'pending', createdAt: now, updatedAt: now })],
      objects: [],
    })
    // The object lands right after the metadata page was read.
    source.objects.push({
      key: 'attachments/x/a-race',
      lastModified: new Date(now.getTime() - 1_000),
      sizeBytes: 7,
    })

    const report = await reconcileOrderAttachments(baseOptions(source))

    expect(report.status).toBe('ok')
    expect(report.summary.inFlightUploads).toBe(1)
  })

  it('performs policy cleanup only in apply mode and stays idempotent across reruns', async () => {
    const buildSource = () =>
      createFakeOrderAttachmentReconciliationSource({
        attachments: [
          attachment({ id: 'a-missing', state: 'ready', objectKey: 'attachments/x/gone' }),
          attachment({
            id: 'a-abandoned',
            state: 'pending',
            createdAt: new Date(now.getTime() - 3 * DAY_MS),
            updatedAt: new Date(now.getTime() - 3 * DAY_MS),
            objectKey: 'attachments/x/abandoned',
          }),
        ],
        objects: [
          { key: 'attachments/x/aged-orphan', lastModified: new Date(now.getTime() - 9 * DAY_MS), sizeBytes: 40 },
        ],
      })

    const dryRunSource = buildSource()
    const dryRunSink = createInMemoryOrderAttachmentCleanupSink()
    const dryRunReport = await reconcileOrderAttachments(
      baseOptions(dryRunSource, { cleanup: dryRunSink }),
    )
    expect(dryRunReport.mode).toBe('dry-run')
    expect(dryRunReport.destructiveActionsPerformed).toBe(false)
    expect(dryRunSink.snapshot()).toEqual({ failedUploads: [], deletedObjects: [] })
    expect(dryRunSource.attachments[1]!.state).toBe('pending')

    const applySource = buildSource()
    const sink = createInMemoryOrderAttachmentCleanupSink()
    const markUploadFailed = sink.markUploadFailed.bind(sink)
    // Wire the sink to the source the way the live script wires it to the database.
    sink.markUploadFailed = async (attachmentId) => {
      await markUploadFailed(attachmentId)
      const record = applySource.attachments.find(({ id }) => id === attachmentId)
      if (record) {
        ;(record as { state: OrderAttachmentRecord['state'] }).state = 'failed'
      }
    }
    const firstRun = await reconcileOrderAttachments(
      baseOptions(applySource, { mode: 'apply', cleanup: sink }),
    )

    expect(firstRun.destructiveActionsPerformed).toBe(true)
    expect(firstRun.status).toBe('discrepancies')
    expect(sink.snapshot()).toEqual({
      failedUploads: ['a-abandoned'],
      deletedObjects: ['attachments/x/aged-orphan'],
    })
    expect(applySource.attachments.find(({ id }) => id === 'a-abandoned')?.state).toBe('failed')

    // Second run over the reconciled state finds nothing left to do.
    applySource.objects = []
    const secondRun = await reconcileOrderAttachments(
      baseOptions(applySource, { mode: 'apply', cleanup: sink }),
    )
    expect(secondRun.status).toBe('discrepancies') // ready row still missing its object
    expect(secondRun.summary.orphanedObjects).toBe(0)
    expect(secondRun.summary.abandonedUploads).toBe(0)
    expect(sink.snapshot().deletedObjects).toEqual(['attachments/x/aged-orphan'])
  })

  it('records partial cleanup failures and remains safe to retry', async () => {
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments: [],
      objects: [
        { key: 'attachments/x/stuck-orphan', lastModified: new Date(now.getTime() - 9 * DAY_MS), sizeBytes: 40 },
      ],
    })
    const sink = createInMemoryOrderAttachmentCleanupSink()
    sink.failNextDeleteWith(new Error('storage unavailable'))

    const report = await reconcileOrderAttachments(
      baseOptions(source, { mode: 'apply', cleanup: sink }),
    )

    expect(report.status).toBe('action_errors')
    expect(report.actionErrors).toHaveLength(1)
    expect(report.actionErrors[0]).toMatchObject({
      kind: 'orphaned_object',
      reason: 'storage_unavailable',
    })
    expect(JSON.stringify(report)).not.toContain('storage unavailable')
    expect(JSON.stringify(report)).not.toContain('stuck-orphan')

    // Retry succeeds and leaves no duplicate work behind.
    const retry = await reconcileOrderAttachments(
      baseOptions(source, { mode: 'apply', cleanup: sink }),
    )
    expect(retry.status).toBe('discrepancies')
    expect(retry.actionErrors).toEqual([])
    expect(sink.snapshot().deletedObjects).toEqual(['attachments/x/stuck-orphan'])
  })

  it('consumes paginated sources and honors the per-run page bound', async () => {
    const attachments = Array.from({ length: 5 }, (_, index) =>
      attachment({ id: `a-${index}`, objectKey: `attachments/x/a-${index}` }),
    )
    const objects = [
      ...attachments.map((record) => ({
        key: record.objectKey,
        lastModified: new Date(now.getTime() - DAY_MS),
        sizeBytes: 10,
      })),
      { key: 'attachments/x/orphan', lastModified: new Date(now.getTime() - 9 * DAY_MS), sizeBytes: 1 },
    ]
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments,
      objects,
      pageSize: 2,
    })

    const bounded = await reconcileOrderAttachments(baseOptions(source, { maxPagesPerSource: 2 }))
    expect(bounded.incomplete).toBe(true)

    const complete = await reconcileOrderAttachments(baseOptions(source))
    expect(complete.incomplete).toBe(false)
    expect(complete.summary.inventoryObjects).toBe(6)
    expect(complete.summary.orphanedObjects).toBe(1)
  })

  it('flags malformed object keys as anomalies without leaking their content', async () => {
    const source = createFakeOrderAttachmentReconciliationSource({
      attachments: [],
      objects: [
        {
          key: 'unexpected-prefix/blob.bin',
          lastModified: new Date(now.getTime() - 9 * DAY_MS),
          sizeBytes: 5,
        },
      ],
    })

    const report = await reconcileOrderAttachments(baseOptions(source))

    expect(report.status).toBe('discrepancies')
    expect(report.summary.orphanedObjects).toBe(1)
    expect(report.discrepancies[0]).toMatchObject({
      kind: 'orphaned_object',
      keyShape: 'malformed',
    })
  })
})
