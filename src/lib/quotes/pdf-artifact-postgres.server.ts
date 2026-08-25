import type { Sql } from 'postgres'
import {
  QuotePdfGenerationError,
  type ImmutableQuotePdfSnapshot,
  type QuotePdfArtifact,
  type QuotePdfArtifactRepository,
  type QuotePdfTemplateVariant,
} from './pdf-artifacts.server'
import type {
  QuotePdfAccessScope,
  QuotePdfDeliveryIdentity,
} from './pdf-delivery.server'

type ArtifactRow = {
  id: string
  quoteId: string
  snapshotId: string
  snapshotVersion: number
  templateId: string
  templateVersion: number
  templateVariant: string
  sourceChecksum: string
  status: string
  objectKey: string | null
  mimeType: string | null
  sizeBytes: string | null
  outputChecksum: string | null
  pageCount: number | null
  attemptCount: number
  createdAt: Date | string
  generationStartedAt: Date | string
  completedAt: Date | string | null
  failedAt: Date | string | null
  errorCode: string | null
  errorMessage: string | null
  errorDetails: Record<string, number | string> | null
}

function toArtifact(row: ArtifactRow): QuotePdfArtifact {
  const variant: QuotePdfTemplateVariant =
    row.templateVariant === 'summary' ? 'summary' : 'commercial'
  return {
    id: row.id,
    quoteId: row.quoteId,
    snapshotId: row.snapshotId,
    snapshotVersion: row.snapshotVersion,
    templateId: row.templateId,
    templateVersion: row.templateVersion,
    templateVariant: variant,
    sourceChecksum: row.sourceChecksum,
    status: row.status as QuotePdfArtifact['status'],
    objectKey: row.objectKey,
    mimeType: row.mimeType === 'application/pdf' ? 'application/pdf' : null,
    sizeBytes: row.sizeBytes === null ? null : Number(row.sizeBytes),
    outputChecksum: row.outputChecksum,
    pageCount: row.pageCount,
    attemptCount: row.attemptCount,
    createdAt: asDate(row.createdAt),
    generationStartedAt: asDate(row.generationStartedAt),
    completedAt: row.completedAt === null ? null : asDate(row.completedAt),
    failedAt: row.failedAt === null ? null : asDate(row.failedAt),
    errorCode: (row.errorCode ?? null) as QuotePdfArtifact['errorCode'],
    errorMessage: row.errorMessage,
    errorDetails: row.errorDetails,
  }
}

function asDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value)
}

function isStaleClaimError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === '40001'
  )
}

/**
 * Production repository port backed by the atomic migration functions in
 * `drizzle/0006_quote_pdf_artifacts.sql`. Concurrency lives in PostgreSQL;
 * this adapter never decides claim ownership locally.
 */
export function createPostgresQuotePdfArtifactRepository(options: {
  readonly sql: Sql
  readonly schemaName: string
}): QuotePdfArtifactRepository {
  const { sql } = options
  if (!/^[a-z_][a-z0-9_]*$/i.test(options.schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${options.schemaName}`)
  }
  const quotedSchema = `"${options.schemaName}"`

  async function useSchema(): Promise<void> {
    await sql.unsafe(`SET search_path TO ${quotedSchema}, public`)
  }

  function mapClaim(rows: Array<ArtifactRow & { claimed: boolean }>) {
    const row = rows[0]
    if (!row) {
      throw new QuotePdfGenerationError(
        'persistence_failed',
        'PDF artifact claim returned no row',
      )
    }
    return { claimed: row.claimed, artifact: toArtifact(row) }
  }

  return {
    async claim(identity, _now, staleBefore) {
      await useSchema()
      try {
        const rows = await sql<Array<ArtifactRow & { claimed: boolean }>>`
          SELECT
            (artifact).id::text AS id,
            (artifact).quote_id::text AS "quoteId",
            (artifact).snapshot_id::text AS "snapshotId",
            (artifact).snapshot_version AS "snapshotVersion",
            (artifact).template_id::text AS "templateId",
            (artifact).template_version AS "templateVersion",
            (artifact).template_variant AS "templateVariant",
            (artifact).source_checksum AS "sourceChecksum",
            (artifact).status AS status,
            (artifact).object_key AS "objectKey",
            (artifact).mime_type AS "mimeType",
            (artifact).size_bytes::text AS "sizeBytes",
            (artifact).output_checksum AS "outputChecksum",
            (artifact).page_count AS "pageCount",
            (artifact).attempt_count AS "attemptCount",
            (artifact).created_at AS "createdAt",
            (artifact).generation_started_at AS "generationStartedAt",
            (artifact).completed_at AS "completedAt",
            (artifact).failed_at AS "failedAt",
            (artifact).error_code AS "errorCode",
            (artifact).error_message AS "errorMessage",
            (artifact).error_details AS "errorDetails",
            claimed
          FROM claim_quote_pdf_artifact(
            ${identity.quoteId}::uuid,
            ${identity.snapshotId}::uuid,
            ${identity.snapshotVersion},
            ${identity.templateId}::uuid,
            ${identity.templateVersion},
            ${identity.templateVariant},
            ${identity.snapshotSourceChecksum},
            ${staleBefore.toISOString()},
            ${identity.sourceChecksum}
          ) AS claim
        `
        return mapClaim(rows)
      } catch (error) {
        // The claim function raises 23503 when the immutable snapshot identity
        // or its checksum does not match the persisted row.
        if (
          typeof error === 'object' &&
          error !== null &&
          (error as { code?: string }).code === '23503'
        ) {
          throw new QuotePdfGenerationError(
            'snapshot_not_found',
            'The immutable quote snapshot does not exist for this quote and version',
          )
        }
        throw error
      }
    },

    async complete(artifactId, expectedAttemptCount, completion) {
      await useSchema()
      try {
        const rows = await sql<ArtifactRow[]>`
          SELECT
            id::text AS id,
            quote_id::text AS "quoteId",
            snapshot_id::text AS "snapshotId",
            snapshot_version AS "snapshotVersion",
            template_id::text AS "templateId",
            template_version AS "templateVersion",
            template_variant AS "templateVariant",
            source_checksum AS "sourceChecksum",
            status,
            object_key AS "objectKey",
            mime_type AS "mimeType",
            size_bytes::text AS "sizeBytes",
            output_checksum AS "outputChecksum",
            page_count AS "pageCount",
            attempt_count AS "attemptCount",
            created_at AS "createdAt",
            generation_started_at AS "generationStartedAt",
            completed_at AS "completedAt",
            failed_at AS "failedAt",
            error_code AS "errorCode",
            error_message AS "errorMessage",
            error_details AS "errorDetails"
          FROM complete_quote_pdf_artifact(
            ${artifactId}::uuid,
            ${expectedAttemptCount},
            ${completion.objectKey},
            ${completion.sizeBytes},
            ${completion.outputChecksum},
            ${completion.pageCount}
          )
        `
        return toArtifact(rows[0]!)
      } catch (error) {
        if (isStaleClaimError(error)) {
          throw new QuotePdfGenerationError(
            'stale_generation_claim',
            'This PDF generation attempt no longer owns the artifact claim',
          )
        }
        throw error
      }
    },

    async fail(artifactId, expectedAttemptCount, failure) {
      await useSchema()
      try {
        const rows = await sql<ArtifactRow[]>`
          SELECT
            id::text AS id,
            quote_id::text AS "quoteId",
            snapshot_id::text AS "snapshotId",
            snapshot_version AS "snapshotVersion",
            template_id::text AS "templateId",
            template_version AS "templateVersion",
            template_variant AS "templateVariant",
            source_checksum AS "sourceChecksum",
            status,
            object_key AS "objectKey",
            mime_type AS "mimeType",
            size_bytes::text AS "sizeBytes",
            output_checksum AS "outputChecksum",
            page_count AS "pageCount",
            attempt_count AS "attemptCount",
            created_at AS "createdAt",
            generation_started_at AS "generationStartedAt",
            completed_at AS "completedAt",
            failed_at AS "failedAt",
            error_code AS "errorCode",
            error_message AS "errorMessage",
            error_details AS "errorDetails"
          FROM fail_quote_pdf_artifact(
            ${artifactId}::uuid,
            ${expectedAttemptCount},
            ${failure.code},
            ${failure.message},
            ${sql.json({ ...failure.details })}
          )
        `
        return toArtifact(rows[0]!)
      } catch (error) {
        if (isStaleClaimError(error)) {
          throw new QuotePdfGenerationError(
            'stale_generation_claim',
            'This PDF generation attempt no longer owns the artifact claim',
          )
        }
        throw error
      }
    },

    async waitForTerminal(artifactId, timeoutMs) {
      await useSchema()
      const deadline = Date.now() + timeoutMs
      for (;;) {
        const rows = await sql<ArtifactRow[]>`
          SELECT
            id::text AS id,
            quote_id::text AS "quoteId",
            snapshot_id::text AS "snapshotId",
            snapshot_version AS "snapshotVersion",
            template_id::text AS "templateId",
            template_version AS "templateVersion",
            template_variant AS "templateVariant",
            source_checksum AS "sourceChecksum",
            status,
            object_key AS "objectKey",
            mime_type AS "mimeType",
            size_bytes::text AS "sizeBytes",
            output_checksum AS "outputChecksum",
            page_count AS "pageCount",
            attempt_count AS "attemptCount",
            created_at AS "createdAt",
            generation_started_at AS "generationStartedAt",
            completed_at AS "completedAt",
            failed_at AS "failedAt",
            error_code AS "errorCode",
            error_message AS "errorMessage",
            error_details AS "errorDetails"
          FROM quote_pdf_artifacts
          WHERE id = ${artifactId}::uuid
        `
        const row = rows[0]
        if (!row) {
          throw new QuotePdfGenerationError(
            'persistence_failed',
            'The claimed PDF artifact row disappeared',
          )
        }
        const artifact = toArtifact(row)
        if (artifact.status !== 'generating') return artifact
        if (Date.now() >= deadline) {
          throw new QuotePdfGenerationError(
            'generation_wait_timeout',
            'Timed out waiting for the concurrent PDF generation claim to finish',
            { limit: timeoutMs },
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 500))
      }
    },
  }
}

/** Loads one artifact row by its full immutable identity, excluding history scans. */
export async function findQuotePdfArtifactByIdentity(
  sql: Sql,
  schemaName: string,
  identity: QuotePdfDeliveryIdentity,
): Promise<QuotePdfArtifact | null> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  const rows = await sql<ArtifactRow[]>`
    SELECT
      id::text AS id,
      quote_id::text AS "quoteId",
      snapshot_id::text AS "snapshotId",
      snapshot_version AS "snapshotVersion",
      template_id::text AS "templateId",
      template_version AS "templateVersion",
      template_variant AS "templateVariant",
      source_checksum AS "sourceChecksum",
      status,
      object_key AS "objectKey",
      mime_type AS "mimeType",
      size_bytes::text AS "sizeBytes",
      output_checksum AS "outputChecksum",
      page_count AS "pageCount",
      attempt_count AS "attemptCount",
      created_at AS "createdAt",
      generation_started_at AS "generationStartedAt",
      completed_at AS "completedAt",
      failed_at AS "failedAt",
      error_code AS "errorCode",
      error_message AS "errorMessage",
      error_details AS "errorDetails"
    FROM quote_pdf_artifacts
    WHERE quote_id = ${identity.quoteId}::uuid
      AND snapshot_id = ${identity.snapshotId}::uuid
      AND snapshot_version = ${identity.snapshotVersion}
      AND template_id = ${identity.templateId}::uuid
      AND template_version = ${identity.templateVersion}
  `
  return rows[0] ? toArtifact(rows[0]) : null
}

/** Reads the persisted immutable snapshot; never reconstructs mutable rows. */
export async function loadPersistedQuotePdfSnapshot(
  sql: Sql,
  schemaName: string,
  input: Readonly<{
    quoteId: string
    snapshotId: string
    snapshotVersion: number
  }>,
): Promise<ImmutableQuotePdfSnapshot | null> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  const rows = await sql<
    Array<{
      id: string
      version: number
      payload: unknown
      sourceChecksum: string
    }>
  >`
    SELECT id::text AS id, version, payload, source_checksum AS "sourceChecksum"
    FROM quote_snapshots
    WHERE quote_id = ${input.quoteId}::uuid
      AND id = ${input.snapshotId}::uuid
      AND version = ${input.snapshotVersion}
  `
  const row = rows[0]
  if (!row) return null
  const images = extractSnapshotImages(row.payload)
  return {
    id: row.id,
    version: row.version,
    sourceChecksum: row.sourceChecksum,
    payload: row.payload as ImmutableQuotePdfSnapshot['payload'],
    images,
  }
}

function extractSnapshotImages(
  payload: unknown,
): ImmutableQuotePdfSnapshot['images'] {
  const images = (payload as { images?: unknown })?.images
  if (!Array.isArray(images)) return []
  return images.flatMap((image) => {
    if (typeof image !== 'object' || image === null) return []
    const record = image as Record<string, unknown>
    if (typeof record.id !== 'string') return []
    return [
      {
        id: record.id,
        width: Number(record.width ?? 0),
        height: Number(record.height ?? 0),
        sizeBytes: Number(record.sizeBytes ?? 0),
        ...(typeof record.checksum === 'string' ? { checksum: record.checksum } : {}),
        ...(typeof record.objectKey === 'string' ? { objectKey: record.objectKey } : {}),
      },
    ]
  })
}

export interface QuotePdfScopeRow extends QuotePdfAccessScope {
  readonly quoteNumber: string
}

/**
 * Resolves the authorization scope for a quote from the same tables the
 * commercial security service uses, so both surfaces agree on visibility.
 */
export async function loadQuotePdfScope(
  sql: Sql,
  schemaName: string,
  quoteId: string,
): Promise<QuotePdfScopeRow | null> {
  if (!/^[a-z_][a-z0-9_]*$/i.test(schemaName)) {
    throw new Error(`Invalid PostgreSQL schema name: ${schemaName}`)
  }
  await sql.unsafe(`SET search_path TO "${schemaName}", public`)
  const scopeRows = await sql<
    Array<{
      tenantId: string
      ownerUserId: string
      quoteNumber: string
    }>
  >`
    SELECT
      s.tenant_id::text AS "tenantId",
      s.owner_user_id AS "ownerUserId",
      q.quote_number AS "quoteNumber"
    FROM commercial_resource_scopes s
    JOIN quotes q ON q.id = s.resource_id::uuid
    WHERE s.resource_type = 'quote'
      AND s.resource_id = ${quoteId}::uuid
  `
  const scope = scopeRows[0]
  if (!scope) return null
  const assignments = await sql<Array<{ userId: string }>>`
    SELECT user_id AS "userId"
    FROM commercial_resource_assignments
    WHERE resource_type = 'quote' AND resource_id = ${quoteId}::uuid
    ORDER BY user_id
  `
  return {
    tenantId: scope.tenantId,
    ownerUserId: scope.ownerUserId,
    assignedUserIds: assignments.map((row) => row.userId),
    quoteNumber: scope.quoteNumber,
  }
}
