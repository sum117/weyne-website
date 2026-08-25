import { createHash } from 'node:crypto'

export type ObjectReference = Readonly<{
  key: string
  source: string
  recordId: string
}>

export type StorageInventoryObject = Readonly<{
  key: string
  lastModified: Date
  sizeBytes: number
}>

export type ReconciliationInput = Readonly<{
  databaseCapturedAt: Date
  inventoryCapturedAt: Date
  orphanGracePeriodMs: number
  references: readonly ObjectReference[]
  inventory: readonly StorageInventoryObject[]
}>

export type ReconciliationDiscrepancy = Readonly<{
  kind: 'missing_object' | 'orphaned_object'
  severity: 'critical' | 'warning'
  objectFingerprint: string
  source?: string
  recordFingerprint?: string
  sizeBytes?: number
  lastModified?: string
  nextAction:
    | 'restore_or_reconcile_database_reference'
    | 'investigate_orphan_after_grace_period'
}>

export type ObjectStorageReconciliationReport = Readonly<{
  schemaVersion: 1
  event: 'object_storage_reconciliation'
  status: 'ok' | 'discrepancies'
  destructiveActionsPerformed: false
  databaseCapturedAt: string
  inventoryCapturedAt: string
  orphanGracePeriodSeconds: number
  summary: Readonly<{
    referencedObjects: number
    inventoryObjects: number
    missingObjects: number
    orphanedObjects: number
    recentUnreferencedObjects: number
  }>
  discrepancies: readonly ReconciliationDiscrepancy[]
}>

export function buildObjectStorageReconciliation(
  input: ReconciliationInput,
): ObjectStorageReconciliationReport {
  assertValidInput(input)

  const references = deduplicateReferences(input.references)
  const inventory = deduplicateInventory(input.inventory)
  const inventoryByKey = new Map(inventory.map((object) => [object.key, object]))
  const referencesByKey = new Map<string, ObjectReference[]>()

  for (const reference of references) {
    const existing = referencesByKey.get(reference.key) ?? []
    existing.push(reference)
    referencesByKey.set(reference.key, existing)
  }

  const missingKeys = [...referencesByKey.keys()]
    .filter((key) => !inventoryByKey.has(key))
    .sort()
  const graceBoundary =
    input.inventoryCapturedAt.getTime() - input.orphanGracePeriodMs
  const unreferenced = inventory.filter(
    (object) => !referencesByKey.has(object.key),
  )
  const orphaned = unreferenced
    .filter((object) => object.lastModified.getTime() <= graceBoundary)
    .sort(compareInventory)
  const recentUnreferencedObjects = unreferenced.length - orphaned.length

  const discrepancies: ReconciliationDiscrepancy[] = [
    ...missingKeys.map((key) => {
      const keyReferences = referencesByKey.get(key)!
      const sources = [...new Set(keyReferences.map(({ source }) => source))].sort()
      const records = keyReferences
        .map(({ recordId, source }) => `${source}:${recordId}`)
        .sort()

      return Object.freeze({
        kind: 'missing_object' as const,
        severity: 'critical' as const,
        objectFingerprint: fingerprint(key),
        source: sources.join(','),
        recordFingerprint: fingerprint(records.join('|')),
        nextAction: 'restore_or_reconcile_database_reference' as const,
      })
    }),
    ...orphaned.map((object) =>
      Object.freeze({
        kind: 'orphaned_object' as const,
        severity: 'warning' as const,
        objectFingerprint: fingerprint(object.key),
        sizeBytes: object.sizeBytes,
        lastModified: object.lastModified.toISOString(),
        nextAction: 'investigate_orphan_after_grace_period' as const,
      }),
    ),
  ]

  return Object.freeze({
    schemaVersion: 1 as const,
    event: 'object_storage_reconciliation' as const,
    status: discrepancies.length === 0 ? ('ok' as const) : ('discrepancies' as const),
    destructiveActionsPerformed: false as const,
    databaseCapturedAt: input.databaseCapturedAt.toISOString(),
    inventoryCapturedAt: input.inventoryCapturedAt.toISOString(),
    orphanGracePeriodSeconds: input.orphanGracePeriodMs / 1_000,
    summary: Object.freeze({
      referencedObjects: referencesByKey.size,
      inventoryObjects: inventory.length,
      missingObjects: missingKeys.length,
      orphanedObjects: orphaned.length,
      recentUnreferencedObjects,
    }),
    discrepancies: Object.freeze(discrepancies),
  })
}

export function createFakeReconciliationInput(
  capturedAt = new Date('2026-01-15T12:00:00.000Z'),
): ReconciliationInput {
  return Object.freeze({
    databaseCapturedAt: capturedAt,
    inventoryCapturedAt: capturedAt,
    orphanGracePeriodMs: 7 * 24 * 60 * 60 * 1_000,
    references: Object.freeze([
      Object.freeze({
        key: '_reconciliation-test/present',
        source: 'fake_references',
        recordId: 'fake-present',
      }),
      Object.freeze({
        key: '_reconciliation-test/missing',
        source: 'fake_references',
        recordId: 'fake-missing',
      }),
    ]),
    inventory: Object.freeze([
      Object.freeze({
        key: '_reconciliation-test/present',
        lastModified: new Date(capturedAt.getTime() - 8 * 24 * 60 * 60 * 1_000),
        sizeBytes: 7,
      }),
      Object.freeze({
        key: '_reconciliation-test/orphan',
        lastModified: new Date(capturedAt.getTime() - 8 * 24 * 60 * 60 * 1_000),
        sizeBytes: 7,
      }),
    ]),
  })
}

function deduplicateReferences(
  references: readonly ObjectReference[],
): ObjectReference[] {
  const unique = new Map<string, ObjectReference>()

  for (const reference of references) {
    unique.set(
      `${reference.key}\0${reference.source}\0${reference.recordId}`,
      reference,
    )
  }

  return [...unique.values()].sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      left.source.localeCompare(right.source) ||
      left.recordId.localeCompare(right.recordId),
  )
}

function deduplicateInventory(
  inventory: readonly StorageInventoryObject[],
): StorageInventoryObject[] {
  const unique = new Map<string, StorageInventoryObject>()

  for (const object of inventory) {
    const existing = unique.get(object.key)
    if (!existing || compareInventory(object, existing) < 0) {
      unique.set(object.key, object)
    }
  }

  return [...unique.values()].sort(compareInventory)
}

function compareInventory(
  left: StorageInventoryObject,
  right: StorageInventoryObject,
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

function assertValidInput(input: ReconciliationInput): void {
  if (
    !Number.isFinite(input.orphanGracePeriodMs) ||
    input.orphanGracePeriodMs < 0
  ) {
    throw new Error('orphanGracePeriodMs must be a non-negative finite number')
  }

  for (const reference of input.references) {
    if (!reference.key.trim() || !reference.source.trim() || !reference.recordId.trim()) {
      throw new Error('Object references require non-empty key, source, and recordId')
    }
  }

  for (const object of input.inventory) {
    if (
      !object.key.trim() ||
      !Number.isFinite(object.lastModified.getTime()) ||
      !Number.isSafeInteger(object.sizeBytes) ||
      object.sizeBytes < 0
    ) {
      throw new Error('Inventory objects require a valid key, timestamp, and size')
    }
  }
}
