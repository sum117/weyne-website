import { createHash } from 'node:crypto'

/**
 * Lifecycle-aware reconciliation between order attachment metadata and private
 * object storage. Pure and side-effect free except through the injected cleanup
 * sink; reports carry fingerprints only, never keys, filenames, or identifiers.
 */

export type OrderAttachmentState =
  | 'pending'
  | 'ready'
  | 'deleting'
  | 'deleted'
  | 'failed'

/** Non-PII metadata projection: no filenames, labels, checksums, or actor IDs. */
export type OrderAttachmentRecord = Readonly<{
  id: string
  objectKey: string
  state: OrderAttachmentState
  createdAt: Date
  updatedAt: Date
}>

export type StorageObjectRecord = Readonly<{
  key: string
  lastModified: Date
  sizeBytes: number
}>

export type OrderAttachmentReconciliationMode = 'dry-run' | 'apply'

export type ReconciliationActionKind =
  | 'missing_object'
  | 'abandoned_upload'
  | 'orphaned_object'

export type CleanupSinkErrorReason =
  | 'storage_unavailable'
  | 'metadata_unavailable'
  | 'unknown'

export interface OrderAttachmentCleanupSink {
  markUploadFailed(attachmentId: string): Promise<void>
  deleteOrphanedObject(objectKey: string): Promise<void>
}

export interface OrderAttachmentReconciliationSource {
  /** Reads one page of attachment metadata ordered by a stable key. */
  readAttachments(cursor?: string): Promise<{
    records: readonly OrderAttachmentRecord[]
    nextCursor: string | null
  }>
  /** Reads one page of storage inventory ordered by object key. */
  readObjects(cursor?: string): Promise<{
    records: readonly StorageObjectRecord[]
    nextCursor: string | null
  }>
}

export type ReconciliationDiscrepancy = Readonly<{
  kind: ReconciliationActionKind
  severity: 'critical' | 'warning'
  objectFingerprint: string
  keyShape: 'order_attachment' | 'malformed'
  sizeBytes?: number
  lastModified?: string
  nextAction:
    | 'restore_or_reconcile_database_reference'
    | 'mark_abandoned_upload_failed'
    | 'delete_orphan_after_review'
}>

export type ObjectStorageReconciliationReport = Readonly<{
  schemaVersion: 1
  event: 'order_attachment_reconciliation'
  mode: OrderAttachmentReconciliationMode
  status: 'ok' | 'discrepancies' | 'action_errors'
  destructiveActionsPerformed: boolean
  incomplete: boolean
  capturedAt: string
  pendingGracePeriodSeconds: number
  orphanGracePeriodSeconds: number
  summary: Readonly<{
    attachmentRecords: number
    inventoryObjects: number
    missingObjects: number
    abandonedUploads: number
    orphanedObjects: number
    inFlightUploads: number
    recentUnreferencedObjects: number
  }>
  actionErrors: readonly {
    kind: ReconciliationActionKind
    reason: CleanupSinkErrorReason
  }[]
  discrepancies: readonly ReconciliationDiscrepancy[]
}>

const ORDER_ATTACHMENT_KEY_PATTERN =
  /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

export function reconcileOrderAttachments(
  options: Readonly<{
    source: OrderAttachmentReconciliationSource
    cleanup?: OrderAttachmentCleanupSink
    mode?: OrderAttachmentReconciliationMode
    now: Date
    pendingGracePeriodMs: number
    orphanGracePeriodMs: number
    maxPagesPerSource?: number
  }>,
): Promise<ObjectStorageReconciliationReport> {
  assertOptions(options)

  return (async () => {
    const maxPagesPerSource = options.maxPagesPerSource ?? Number.POSITIVE_INFINITY
    let attachmentsPage = await options.source.readAttachments()
    let objectsPage = await options.source.readObjects()

    const attachments: OrderAttachmentRecord[] = [...attachmentsPage.records]
    const objectsByKey = new Map<string, StorageObjectRecord>()
    for (const record of objectsPage.records) objectsByKey.set(record.key, record)

    let attachmentPagesRead = 1
    while (
      attachmentsPage.nextCursor !== null &&
      attachmentPagesRead < maxPagesPerSource
    ) {
      attachmentsPage = await options.source.readAttachments(attachmentsPage.nextCursor)
      attachments.push(...attachmentsPage.records)
      attachmentPagesRead += 1
    }

    let objectPagesRead = 1
    while (objectsPage.nextCursor !== null && objectPagesRead < maxPagesPerSource) {
      objectsPage = await options.source.readObjects(objectsPage.nextCursor)
      for (const record of objectsPage.records) objectsByKey.set(record.key, record)
      objectPagesRead += 1
    }

    const incomplete =
      attachmentsPage.nextCursor !== null || objectsPage.nextCursor !== null

    const capturedAt = options.now
    const pendingBoundary = capturedAt.getTime() - options.pendingGracePeriodMs
    const orphanBoundary = capturedAt.getTime() - options.orphanGracePeriodMs

    const referencedKeys = new Set<string>()
    const missingKeys: { key: string; recordId: string }[] = []
    const abandonedUploads: { key: string; recordId: string }[] = []
    let inFlightUploads = 0

    for (const record of attachments) {
      if (record.state === 'ready') {
        referencedKeys.add(record.objectKey)
        if (!objectsByKey.has(record.objectKey)) {
          missingKeys.push({ key: record.objectKey, recordId: record.id })
        }
        continue
      }

      if (record.state === 'pending') {
        if (record.updatedAt.getTime() > pendingBoundary) {
          inFlightUploads += 1
        } else {
          abandonedUploads.push({ key: record.objectKey, recordId: record.id })
        }
        continue
      }

      // deleting / deleted / failed rows never reference live storage.
    }

    const discrepancies: ReconciliationDiscrepancy[] = []
    const actionErrors: { kind: ReconciliationActionKind; reason: CleanupSinkErrorReason }[] = []
    const applyMode = options.mode === 'apply'
    let destructiveActionsPerformed = false

    // Missing ready objects are critical but never auto-repaired here.
    for (const missing of missingKeys) {
      discrepancies.push({
        kind: 'missing_object',
        severity: 'critical',
        objectFingerprint: fingerprint(missing.key),
        keyShape: 'order_attachment',
        nextAction: 'restore_or_reconcile_database_reference',
      })
    }

    // Abandoned uploads: metadata past its grace window with no usable upload.
    for (const abandoned of abandonedUploads) {
      discrepancies.push({
        kind: 'abandoned_upload',
        severity: 'warning',
        objectFingerprint: fingerprint(abandoned.key),
        keyShape: ORDER_ATTACHMENT_KEY_PATTERN.test(abandoned.key)
          ? 'order_attachment'
          : 'malformed',
        nextAction: 'mark_abandoned_upload_failed',
      })

      if (applyMode && options.cleanup) {
        try {
          await options.cleanup.markUploadFailed(abandoned.recordId)
          destructiveActionsPerformed = true
        } catch {
          actionErrors.push({
            kind: 'abandoned_upload',
            reason: 'metadata_unavailable',
          })
        }
      }
    }

    // Orphan candidates: unreferenced objects past the orphan grace window.
    const allObjects = [...objectsByKey.values()]
    const unreferenced = allObjects.filter((object) => !referencedKeys.has(object.key))
    const orphanCandidates = unreferenced
      .filter((object) => object.lastModified.getTime() <= orphanBoundary)
      .sort(compareStorageObjects)
    const recentUnreferencedObjects = unreferenced.length - orphanCandidates.length

    for (const candidate of orphanCandidates) {
      discrepancies.push({
        kind: 'orphaned_object',
        severity: 'warning',
        objectFingerprint: fingerprint(candidate.key),
        keyShape: ORDER_ATTACHMENT_KEY_PATTERN.test(candidate.key)
          ? 'order_attachment'
          : 'malformed',
        sizeBytes: candidate.sizeBytes,
        lastModified: candidate.lastModified.toISOString(),
        nextAction: 'delete_orphan_after_review',
      })

      if (applyMode && options.cleanup) {
        try {
          await options.cleanup.deleteOrphanedObject(candidate.key)
          destructiveActionsPerformed = true
        } catch {
          actionErrors.push({
            kind: 'orphaned_object',
            reason: 'storage_unavailable',
          })
        }
      }
    }

    const status: ObjectStorageReconciliationReport['status'] =
      actionErrors.length > 0 ? 'action_errors' : discrepancies.length > 0 ? 'discrepancies' : 'ok'

    return Object.freeze({
      schemaVersion: 1 as const,
      event: 'order_attachment_reconciliation' as const,
      mode: options.mode ?? ('dry-run' as const),
      status,
      destructiveActionsPerformed,
      incomplete,
      capturedAt: capturedAt.toISOString(),
      pendingGracePeriodSeconds: options.pendingGracePeriodMs / 1_000,
      orphanGracePeriodSeconds: options.orphanGracePeriodMs / 1_000,
      summary: Object.freeze({
        attachmentRecords: attachments.length,
        inventoryObjects: objectsByKey.size,
        missingObjects: missingKeys.length,
        abandonedUploads: abandonedUploads.length,
        orphanedObjects: orphanCandidates.length,
        inFlightUploads,
        recentUnreferencedObjects,
      }),
      actionErrors: Object.freeze(actionErrors),
      discrepancies: Object.freeze(discrepancies),
    })
  })()
}

function assertOptions(options: {
  now: Date
  pendingGracePeriodMs: number
  orphanGracePeriodMs: number
}): void {
  if (!Number.isFinite(options.now.getTime())) {
    throw new Error('now must be a valid date')
  }
  if (
    !Number.isFinite(options.pendingGracePeriodMs) ||
    options.pendingGracePeriodMs < 0
  ) {
    throw new Error('pendingGracePeriodMs must be a non-negative finite number')
  }
  if (
    !Number.isFinite(options.orphanGracePeriodMs) ||
    options.orphanGracePeriodMs < 0
  ) {
    throw new Error('orphanGracePeriodMs must be a non-negative finite number')
  }
}

function compareStorageObjects(
  left: StorageObjectRecord,
  right: StorageObjectRecord,
): number {
  return (
    left.key.localeCompare(right.key) ||
    left.lastModified.getTime() - right.lastModified.getTime() ||
    left.sizeBytes - right.sizeBytes
  )
}

function fingerprint(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex').slice(0, 16)}`
}

/** Deterministic fake source for tests and local dry runs. */
export function createFakeOrderAttachmentReconciliationSource(options: {
  attachments: OrderAttachmentRecord[]
  objects: StorageObjectRecord[]
  pageSize?: number
}): OrderAttachmentReconciliationSource & {
  attachments: OrderAttachmentRecord[]
  objects: StorageObjectRecord[]
} {
  const pageSize = options.pageSize ?? 2
  const source: OrderAttachmentReconciliationSource & {
    attachments: OrderAttachmentRecord[]
    objects: StorageObjectRecord[]
  } = {
    attachments: options.attachments,
    objects: options.objects,

    async readAttachments(cursor) {
      const sortedAttachments = [...source.attachments].sort((left, right) =>
        left.id.localeCompare(right.id),
      )
      const start = cursor === undefined ? 0 : Number(cursor)
      const end = start + pageSize
      return {
        records: sortedAttachments.slice(start, end),
        nextCursor: end < sortedAttachments.length ? String(end) : null,
      }
    },

    async readObjects(cursor) {
      const sortedObjects = [...source.objects].sort(compareStorageObjects)
      const start = cursor === undefined ? 0 : Number(cursor)
      const end = start + pageSize
      return {
        records: sortedObjects.slice(start, end),
        nextCursor: end < sortedObjects.length ? String(end) : null,
      }
    },
  }

  return source
}

export function createInMemoryOrderAttachmentCleanupSink(): OrderAttachmentCleanupSink & {
  snapshot(): { failedUploads: string[]; deletedObjects: string[] }
  failNextDeleteWith(error: Error): void
} {
  const failedUploads: string[] = []
  const deletedObjects: string[] = []
  let nextDeleteFailure: Error | null = null

  return {
    async markUploadFailed(attachmentId) {
      failedUploads.push(attachmentId)
    },
    async deleteOrphanedObject(objectKey) {
      if (nextDeleteFailure) {
        const error = nextDeleteFailure
        nextDeleteFailure = null
        throw error
      }
      deletedObjects.push(objectKey)
    },
    failNextDeleteWith(error) {
      nextDeleteFailure = error
    },
    snapshot() {
      return { failedUploads: [...failedUploads], deletedObjects: [...deletedObjects] }
    },
  }
}
