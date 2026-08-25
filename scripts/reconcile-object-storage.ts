import {
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { parseDatabaseConfig } from '../src/lib/db/config.server'
import {
  buildObjectStorageReconciliation,
  createFakeReconciliationInput,
  type ObjectReference,
  type StorageInventoryObject,
} from '../src/lib/storage/reconciliation'
import {
  createInMemoryOrderAttachmentCleanupSink,
  reconcileOrderAttachments,
  type OrderAttachmentCleanupSink,
  type OrderAttachmentReconciliationSource,
  type OrderAttachmentRecord,
  type StorageObjectRecord,
} from '../src/lib/storage/order-attachment-reconciliation'
import { createS3Client, parseS3Config } from '../src/lib/storage/s3.server'

const isFakeRun = process.argv.includes('--fake')
const applyMode = process.argv.includes('--apply')
const orderAttachmentsOnly = process.argv.includes('--source=order-attachments')

try {
  if (isFakeRun) {
    const report = buildObjectStorageReconciliation(
      createFakeReconciliationInput(new Date()),
    )
    console.log(JSON.stringify(report))
    process.exitCode = report.status === 'discrepancies' ? 2 : 0
  } else if (orderAttachmentsOnly) {
    await runOrderAttachmentReconciliation()
  } else {
    const report = await reconcileLiveStorage()
    console.log(JSON.stringify(report))
    process.exitCode = report.status === 'discrepancies' ? 2 : 0
  }
} catch (error) {
  console.error(
    JSON.stringify({
      schemaVersion: 1,
      event: 'object_storage_reconciliation_failed',
      status: 'error',
      errorType: error instanceof Error ? error.name : 'UnknownError',
      credentialsRedacted: true,
    }),
  )
  process.exitCode = 1
}

/**
 * Lifecycle-aware reconciliation for order attachments. Dry-run by default;
 * --apply performs policy cleanup through the database and storage adapters.
 */
async function runOrderAttachmentReconciliation() {
  const databaseConfig = parseDatabaseConfig(process.env)
  const s3Config = parseS3Config(process.env)
  const orphanGracePeriodMs = parseGracePeriod(process.env.STORAGE_ORPHAN_GRACE_DAYS)
  const pendingGracePeriodMs = parsePendingGracePeriod(
    process.env.STORAGE_PENDING_GRACE_MINUTES,
  )
  const sql = postgres(databaseConfig.url, { max: 1, prepare: false })
  const client = createS3Client(s3Config)

  try {
    const source = createPostgresOrderAttachmentSource(sql)
    const inventorySource = createS3InventorySource(client, s3Config.bucket)
    const cleanup = applyMode
      ? createLiveOrderAttachmentCleanupSink(sql, client, s3Config.bucket)
      : createInMemoryOrderAttachmentCleanupSink()

    const report = await reconcileOrderAttachments({
      source: { ...source, ...inventorySource },
      cleanup,
      mode: applyMode ? 'apply' : 'dry-run',
      now: new Date(),
      pendingGracePeriodMs,
      orphanGracePeriodMs,
    })

    console.log(JSON.stringify(report))
    process.exitCode =
      report.status === 'ok' || report.status === 'discrepancies' ? (report.status === 'discrepancies' ? 2 : 0) : 1
  } finally {
    client.destroy()
    await sql.end({ timeout: 5 })
  }
}

function createPostgresOrderAttachmentSource(
  sql: ReturnType<typeof postgres>,
): Pick<OrderAttachmentReconciliationSource, 'readAttachments'> {
  const pageSize = 500

  return {
    async readAttachments(cursor) {
      const offset = cursor === undefined ? 0 : Number(cursor)
      const rows = await sql<
        {
          id: string
          objectKey: string
          state: string
          createdAt: Date
          updatedAt: Date
        }[]
      >`
        select id::text as id,
               object_key as "objectKey",
               state,
               created_at as "createdAt",
               updated_at as "updatedAt"
          from order_attachments
         order by id
         limit ${pageSize}
        offset ${offset}
      `
      const records: OrderAttachmentRecord[] = rows.map((row) => ({
        id: row.id,
        objectKey: row.objectKey,
        state: row.state as OrderAttachmentRecord['state'],
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      }))
      return {
        records,
        nextCursor: records.length === pageSize ? String(offset + records.length) : null,
      }
    },
  }
}

function createS3InventorySource(
  client: ReturnType<typeof createS3Client>,
  bucket: string,
): Pick<OrderAttachmentReconciliationSource, 'readObjects'> {
  return {
    async readObjects(cursor) {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          ContinuationToken: cursor,
        }),
      )
      const records: StorageObjectRecord[] = []
      for (const object of page.Contents ?? []) {
        if (
          object.Key === undefined ||
          object.LastModified === undefined ||
          object.Size === undefined
        ) {
          throw new Error('Storage inventory returned incomplete object metadata')
        }
        records.push({
          key: object.Key,
          lastModified: object.LastModified,
          sizeBytes: object.Size,
        })
      }
      const nextCursor = page.IsTruncated ? page.NextContinuationToken ?? null : null
      if (page.IsTruncated && nextCursor === null) {
        throw new Error('Storage inventory pagination token is missing')
      }
      return { records, nextCursor }
    },
  }
}

function createLiveOrderAttachmentCleanupSink(
  sql: ReturnType<typeof postgres>,
  client: ReturnType<typeof createS3Client>,
  bucket: string,
): OrderAttachmentCleanupSink {
  return {
    async markUploadFailed(attachmentId) {
      await sql`
        update order_attachments
           set state = 'failed',
               updated_at = now()
         where id = ${attachmentId}::uuid
           and state = 'pending'
      `
    },
    async deleteOrphanedObject(objectKey) {
      await client.send(
        new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
      )
    },
  }
}

function parsePendingGracePeriod(value: string | undefined): number {
  const minutes = value === undefined ? 60 : Number(value)

  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 24 * 60) {
    throw new Error(
      'STORAGE_PENDING_GRACE_MINUTES must be an integer from 1 through 1440',
    )
  }

  return minutes * 60 * 1_000
}

async function reconcileLiveStorage() {
  const databaseConfig = parseDatabaseConfig(process.env)
  const s3Config = parseS3Config(process.env)
  const orphanGracePeriodMs = parseGracePeriod(process.env.STORAGE_ORPHAN_GRACE_DAYS)
  const sql = postgres(databaseConfig.url, {
    max: 1,
    prepare: false,
  })
  const client = createS3Client(s3Config)

  try {
    const databaseSnapshot = await sql.begin(async (transaction) => {
      await transaction`set transaction isolation level repeatable read, read only`
      const [timestamp] = await transaction<[{ capturedAt: Date }]>`
        select transaction_timestamp() as "capturedAt"
      `
      const rows = await transaction<ObjectReference[]>`
        select object_key as key, 'product_attachments' as source, id::text as "recordId"
          from product_attachments
         where deleted_at is null
           and upload_status in ('UPLOADED', 'PROCESSING', 'AVAILABLE')
        union all
        select variants.object_key as key,
               'product_photo_variants' as source,
               variants.id::text as "recordId"
          from product_photo_variants variants
          join product_attachments attachments
            on attachments.id = variants.attachment_id
         where attachments.deleted_at is null
        union all
        select object_key as key, 'quote_pdf_artifacts' as source, id::text as "recordId"
          from quote_pdf_artifacts
         where status = 'completed'
           and object_key is not null
      `

      return {
        capturedAt: timestamp!.capturedAt,
        references: rows.map((row) => ({
          key: row.key,
          source: row.source,
          recordId: row.recordId,
        })),
      }
    })
    const inventory = await listInventory(client, s3Config.bucket)
    const inventoryCapturedAt = new Date()

    return buildObjectStorageReconciliation({
      databaseCapturedAt: databaseSnapshot.capturedAt,
      inventoryCapturedAt,
      orphanGracePeriodMs,
      references: databaseSnapshot.references,
      inventory,
    })
  } finally {
    client.destroy()
    await sql.end({ timeout: 5 })
  }
}

async function listInventory(
  client: ReturnType<typeof createS3Client>,
  bucket: string,
): Promise<StorageInventoryObject[]> {
  const inventory: StorageInventoryObject[] = []
  let continuationToken: string | undefined

  do {
    const page = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        ContinuationToken: continuationToken,
      }),
    )

    for (const object of page.Contents ?? []) {
      if (
        object.Key === undefined ||
        object.LastModified === undefined ||
        object.Size === undefined
      ) {
        throw new Error('Storage inventory returned incomplete object metadata')
      }

      inventory.push({
        key: object.Key,
        lastModified: object.LastModified,
        sizeBytes: object.Size,
      })
    }

    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined
    if (page.IsTruncated && continuationToken === undefined) {
      throw new Error('Storage inventory pagination token is missing')
    }
  } while (continuationToken !== undefined)

  return inventory
}

function parseGracePeriod(value: string | undefined): number {
  const days = value === undefined ? 7 : Number(value)

  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw new Error('STORAGE_ORPHAN_GRACE_DAYS must be an integer from 1 through 90')
  }

  return days * 24 * 60 * 60 * 1_000
}
