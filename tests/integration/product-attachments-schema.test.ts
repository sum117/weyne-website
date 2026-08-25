import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'

import postgres, { type Sql, type TransactionSql } from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const databaseUrl = process.env.TEST_DATABASE_URL
if (!databaseUrl) {
  throw new Error('TEST_DATABASE_URL is required for database integration tests')
}

const schemaName = `attachments_${randomUUID().replaceAll('-', '')}`
let sql: Sql

beforeAll(async () => {
  sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined })
  await sql.unsafe(`CREATE SCHEMA ${schemaName}`)
  await sql.unsafe(`SET search_path TO ${schemaName}, public`)

  for (const migrationName of [
    '0001_catalog_pricing.sql',
    '0003_product_attachments.sql',
    '0003_product_attachments.sql',
  ]) {
    const migration = await readFile(
      new URL(`../../drizzle/${migrationName}`, import.meta.url),
      'utf8',
    )
    await sql.unsafe(migration)
  }
})

afterAll(async () => {
  if (!sql) return
  await sql.unsafe(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`)
  await sql.end()
})

async function createProduct(): Promise<string> {
  const industryId = randomUUID()
  const productId = randomUUID()
  await sql`INSERT INTO industries (id, legal_name) VALUES (${industryId}, 'Attachment test')`
  await sql`
    INSERT INTO products (
      id, industry_id, internal_code, description, unit, created_by, updated_by
    ) VALUES (
      ${productId}, ${industryId}, ${`ATT-${productId}`}, 'Attachment test product',
      'UN', 'integration-test', 'integration-test'
    )
  `
  return productId
}

const checksumSha256 = '47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
const scopeId = '019c6d9a-3d70-7f51-a273-8ca76ff952bc'

function objectKey(id = randomUUID()): string {
  return `attachments/${scopeId}/${id}`
}

async function insertPhoto(
  executor: Sql | TransactionSql,
  productId: string,
  position: number,
  isPrimary: boolean,
): Promise<string> {
  const id = randomUUID()
  await executor`
    INSERT INTO product_attachments (
      id, product_id, category, object_key, original_filename, mime_type,
      size_bytes, checksum_sha256, photo_position, is_primary, created_by, updated_by
    ) VALUES (
      ${id}, ${productId}, 'PHOTO', ${objectKey()}, 'Frasco 5L.jpg', 'image/jpeg',
      1024, ${checksumSha256}, ${position}, ${isPrimary}, 'integration-test', 'integration-test'
    )
  `
  return id
}

describe('product attachment migration', () => {
  it('persists protected document metadata and opaque object identifiers', async () => {
    const productId = await createProduct()
    const key = objectKey()
    await sql`
      INSERT INTO product_attachments (
        product_id, category, object_key, original_filename, display_label,
        document_version, effective_date, mime_type, size_bytes, checksum_sha256,
        created_by, updated_by
      ) VALUES (
        ${productId}, 'TECHNICAL_SHEET', ${key}, '  original.pdf  ',
        '  Ficha técnica — embalagem 5 L  ', '  Rev. 3  ', '2026-08-01',
        'application/pdf', 2048, ${checksumSha256}, 'integration-test', 'integration-test'
      )
    `

    const rows = await sql<{
      objectKey: string
      originalFilename: string
      displayLabel: string
      documentVersion: string
      effectiveDate: string
      uploadStatus: string
    }[]>`
      SELECT
        object_key AS "objectKey",
        original_filename AS "originalFilename",
        display_label AS "displayLabel",
        document_version AS "documentVersion",
        effective_date::text AS "effectiveDate",
        upload_status AS "uploadStatus"
      FROM product_attachments
      WHERE product_id = ${productId}
    `

    expect(rows).toEqual([
      {
        objectKey: key,
        originalFilename: 'original.pdf',
        displayLabel: 'Ficha técnica — embalagem 5 L',
        documentVersion: 'Rev. 3',
        effectiveDate: '2026-08-01',
        uploadStatus: 'PENDING',
      },
    ])
  })

  it('enforces category MIME and byte policies in persistence', async () => {
    const productId = await createProduct()
    await expect(sql`
      INSERT INTO product_attachments (
        product_id, category, object_key, original_filename, display_label,
        mime_type, size_bytes, checksum_sha256, created_by, updated_by
      ) VALUES (
        ${productId}, 'FISPQ', ${objectKey()}, 'document.png', 'FISPQ vigente',
        'image/png', 100, ${checksumSha256}, 'integration-test', 'integration-test'
      )
    `).rejects.toThrow()
    await expect(sql`
      INSERT INTO product_attachments (
        product_id, category, object_key, original_filename, display_label,
        mime_type, size_bytes, checksum_sha256, created_by, updated_by
      ) VALUES (
        ${productId}, 'FISPQ', ${objectKey()}, 'large.pdf', 'FISPQ vigente',
        'application/pdf', 26214401, ${checksumSha256}, 'integration-test', 'integration-test'
      )
    `).rejects.toThrow()
  })

  it('rejects raw URLs and filenames embedded in storage identifiers', async () => {
    const productId = await createProduct()
    await expect(sql`
      INSERT INTO product_attachments (
        product_id, category, object_key, original_filename, display_label,
        mime_type, size_bytes, checksum_sha256, created_by, updated_by
      ) VALUES (
        ${productId}, 'TECHNICAL_SHEET', 'https://bucket/product-name.pdf',
        'product-name.pdf', 'Ficha técnica', 'application/pdf', 100,
        ${checksumSha256}, 'integration-test', 'integration-test'
      )
    `).rejects.toThrow()
  })

  it('allows transactional reordering but requires contiguous photos and one primary', async () => {
    const productId = await createProduct()
    await sql.begin(async (transaction) => {
      await insertPhoto(transaction, productId, 1, false)
      await insertPhoto(transaction, productId, 0, true)
    })

    const rows = await sql<{ photoPosition: number; isPrimary: boolean }[]>`
      SELECT photo_position AS "photoPosition", is_primary AS "isPrimary"
      FROM product_attachments
      WHERE product_id = ${productId}
      ORDER BY photo_position
    `
    expect(rows).toEqual([
      { photoPosition: 0, isPrimary: true },
      { photoPosition: 1, isPrimary: false },
    ])

    const noPrimaryProductId = await createProduct()
    await expect(insertPhoto(sql, noPrimaryProductId, 0, false)).rejects.toThrow(
      /exactly one primary/i,
    )

    const gapProductId = await createProduct()
    await expect(insertPhoto(sql, gapProductId, 1, true)).rejects.toThrow(
      /contiguous/i,
    )
  })

  it('persists only policy variants beneath active photo attachments', async () => {
    const productId = await createProduct()
    const attachmentId = await insertPhoto(sql, productId, 0, true)
    await sql`
      INSERT INTO product_photo_variants (
        attachment_id, variant_key, object_key, mime_type, size_bytes,
        checksum_sha256, width, height
      ) VALUES (
        ${attachmentId}, 'THUMBNAIL', ${objectKey()}, 'image/webp', 512,
        ${checksumSha256}, 320, 180
      )
    `

    await expect(sql`
      INSERT INTO product_photo_variants (
        attachment_id, variant_key, object_key, mime_type, size_bytes,
        checksum_sha256, width, height
      ) VALUES (
        ${attachmentId}, 'THUMBNAIL', ${objectKey()}, 'image/webp', 512,
        ${checksumSha256}, 321, 180
      )
    `).rejects.toThrow()
  })
})
