import { ListObjectsV2Command } from '@aws-sdk/client-s3'
import postgres from 'postgres'
import { parseDatabaseConfig } from '../src/lib/db/config.server'
import {
  buildObjectStorageReconciliation,
  createFakeReconciliationInput,
  type ObjectReference,
  type StorageInventoryObject,
} from '../src/lib/storage/reconciliation'
import { createS3Client, parseS3Config } from '../src/lib/storage/s3.server'

const isFakeRun = process.argv.includes('--fake')

try {
  const report = isFakeRun
    ? buildObjectStorageReconciliation(createFakeReconciliationInput(new Date()))
    : await reconcileLiveStorage()

  console.log(JSON.stringify(report))
  process.exitCode = !isFakeRun && report.status === 'discrepancies' ? 2 : 0
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
