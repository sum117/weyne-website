import { logStructuredEvent, logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import type { Sql } from 'postgres'
import {
  DENIAL_MESSAGES,
  ForbiddenError,
} from '@/lib/auth/authorization.server'
import { requireCommercialContext } from '@/lib/auth/commercial-scope.server'
import {
  createQuotePdfDeliveryService,
  QuotePdfDeliveryError,
  type QuotePdfDeliveryActor,
} from '@/lib/quotes/pdf-delivery.server'
import {
  createPostgresQuotePdfArtifactRepository,
  findQuotePdfArtifactByIdentity,
  loadQuotePdfScope,
  loadPersistedQuotePdfSnapshot,
} from '@/lib/quotes/pdf-artifact-postgres.server'
import {
  createQuotePdfArtifactService,
  type QuotePdfRenderer,
} from '@/lib/quotes/pdf-artifacts.server'
import { createS3QuotePdfArtifactStorage } from '@/lib/quotes/pdf-artifact-storage.server'
import { createS3Client, parseS3Config } from '@/lib/storage/s3.server'
import { getDatabase } from '@/lib/db/database.server'

/**
 * Authorized quote PDF endpoints: generation requests, status polling, inline
 * preview, and attachment download. The caller's identity NEVER arrives in
 * the payload: every operation re-derives the session from the request
 * cookie, checks the centralized capability matrix (`quote.generate_pdf` /
 * `quote.view`), and re-checks record scope through the delivery service.
 * Out-of-scope quotes resolve as NOT_FOUND so identifiers cannot be
 * enumerated; read_only actors may poll status but never retrieve bytes.
 */

const identitySchema = z.object({
  quoteId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  snapshotVersion: z.number().int().positive(),
  templateId: z.string().uuid(),
  templateVersion: z.number().int().positive(),
})

export const quotePdfRequestSchema = z.object({ identity: identitySchema })
export const quotePdfGenerateSchema = z.object({ identity: identitySchema })

export type QuotePdfPublicError = Readonly<{
  code: string
  status: number
  message: string
  retryable?: boolean
  reason?: string | null
}>

function publicMessage(code: QuotePdfDeliveryError['code']): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'Autenticação necessária.'
    case 'FORBIDDEN':
      return 'Você não tem permissão para esta operação.'
    case 'NOT_FOUND':
      return 'Orçamento ou documento não encontrado.'
    case 'INVALID_REQUEST':
      return 'Solicitação inválida.'
    case 'ARTIFACT_NOT_COMPLETED':
      return 'O PDF ainda não está pronto.'
    case 'GENERATION_FAILED':
      return 'A geração do PDF falhou. Tente novamente.'
    case 'STORAGE_UNAVAILABLE':
      return 'O armazenamento está temporariamente indisponível.'
    case 'STORAGE_INTEGRITY_FAILED':
      return 'O documento armazenado não passou na verificação de integridade.'
    default:
      return 'Não foi possível concluir a operação.'
  }
}

function toPublicError(error: unknown): QuotePdfPublicError {
  if (error instanceof QuotePdfDeliveryError) {
    return {
      code: error.code,
      status: error.status,
      message: publicMessage(error.code),
      retryable: error.retryable,
      reason: error.reason,
    }
  }
  logUnexpectedError('quote-pdf.endpoint', error)
  return { code: 'INTERNAL_ERROR', status: 500, message: 'Não foi possível concluir a operação.' }
}

function resolveSchemaName(): string {
  const configured = process.env.WEYNE_DB_SCHEMA?.trim()
  if (!configured) {
    throw new Error('WEYNE_DB_SCHEMA is required for quote PDF endpoints')
  }
  if (!/^[a-z_][a-z0-9_]*$/i.test(configured)) {
    throw new Error(`Invalid PostgreSQL schema name: ${configured}`)
  }
  return configured
}

/**
 * Resolves the caller from the request cookie and checks `quote.generate_pdf`
 * (mutation) or `quote.view` (status/read paths). 401 when no session exists;
 * 403 with the fixed pt-BR message when authenticated but denied.
 */
async function authenticate(capability: 'quote.generate_pdf' | 'quote.view'): Promise<QuotePdfDeliveryActor> {
  const context = await requireCommercialContext('quote', capability)
  return {
    id: context.session.id,
    role: context.session.role,
    tenantId: context.tenantId,
  }
}

async function getDeliveryService() {
  const database = await getDatabase()
  const sql = (database as unknown as { $client: Sql }).$client
  const schemaName = resolveSchemaName()
  const artifactService = createQuotePdfArtifactService({
    loadSnapshot: (input) => loadPersistedQuotePdfSnapshot(sql, schemaName, input),
    repository: createPostgresQuotePdfArtifactRepository({ sql, schemaName }),
    renderer: createInlineRenderer(),
    storage: createS3QuotePdfArtifactStorage(
      createS3Client(parseS3Config(process.env)),
      parseS3Config(process.env),
    ),
  })
  return createQuotePdfDeliveryService({
    loadQuoteScope: (quoteId) => loadQuotePdfScope(sql, schemaName, quoteId),
    repository: {
      findByIdentity: (identity) =>
        findQuotePdfArtifactByIdentity(sql, schemaName, identity),
    },
    storage: createS3ObjectReader(),
    audit: createConsoleAuditSink(),
    generate: artifactService.generate,
  })
}

/** Streams the private object through the authenticated server process. */
function createS3ObjectReader() {
  return {
    async get(key: string): Promise<Uint8Array | null> {
      const { GetObjectCommand } = await import('@aws-sdk/client-s3')
      const client = createS3Client(parseS3Config(process.env))
      const config = parseS3Config(process.env)
      const result = await client.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }))
      if (!result.Body) return null
      const bytes = await result.Body.transformToByteArray()
      return new Uint8Array(bytes)
    },
  }
}

function createConsoleAuditSink() {
  return {
    async append(event: {
      action: string
      actorId: string
      quoteId: string
      artifactId: string
      snapshotVersion: number
      templateVariant: string
      outcome: string
    }) {
      // Actor, quote, version/artifact, action, timestamp. No signed URLs and
      // no document contents are ever logged.
      logStructuredEvent({
        kind: 'audit',
        action: event.action,
        actorId: event.actorId,
        quoteId: event.quoteId,
        artifactId: event.artifactId,
        snapshotVersion: event.snapshotVersion,
        templateVariant: event.templateVariant,
        outcome: event.outcome,
        occurredAt: new Date().toISOString(),
      })
    },
  }
}

/**
 * Inline renderer placeholder: the deployment runs generation through the
 * artifact service contract; the concrete react-pdf renderer is bound by the
 * worker host once quote snapshot payloads are mapped to document templates.
 */
function createInlineRenderer(): QuotePdfRenderer {
  return {
    async render() {
      throw new Error('Quote PDF renderer is not bound in this deployment yet')
    },
  }
}

const acceptUnknownInput = (input: unknown) => input

/** Maps boundary auth errors onto the endpoint's public error shape. */
function toAuthPublicError(cause: unknown): QuotePdfPublicError {
  if (cause instanceof ForbiddenError) {
    return { code: 'FORBIDDEN', status: 403, message: DENIAL_MESSAGES.FORBIDDEN }
  }
  if (cause instanceof QuotePdfDeliveryError) return toPublicError(cause)
  logUnexpectedError('quote-pdf.endpoint', cause)
  return { code: 'INTERNAL_ERROR', status: 500, message: 'Não foi possível concluir a operação.' }
}

export const requestQuotePdfGeneration = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    let actor: QuotePdfDeliveryActor
    try {
      actor = await authenticate('quote.generate_pdf')
    } catch (cause) {
      if (cause instanceof ForbiddenError) {
        return { ok: false as const, error: toAuthPublicError(cause) }
      }
      throw cause
    }
    const parsed = quotePdfGenerateSchema.safeParse(data)
    if (!parsed.success) return { ok: false as const, error: toPublicError(new QuotePdfDeliveryError('INVALID_REQUEST')) }
    try {
      const service = await getDeliveryService()
      const snapshot = await loadPersistedQuotePdfSnapshot(sqlFor(await getDatabase()), resolveSchemaName(), {
        quoteId: parsed.data.identity.quoteId,
        snapshotId: parsed.data.identity.snapshotId,
        snapshotVersion: parsed.data.identity.snapshotVersion,
      })
      if (!snapshot) return { ok: false as const, error: toPublicError(new QuotePdfDeliveryError('NOT_FOUND')) }
      const view = await service.generate({
        actor,
        quoteId: parsed.data.identity.quoteId,
        snapshot,
        template: {
          id: parsed.data.identity.templateId,
          version: parsed.data.identity.templateVersion,
          variant: 'commercial',
        },
      })
      return { ok: true as const, status: view }
    } catch (error) {
      return { ok: false as const, error: toPublicError(error) }
    }
  })

export const pollQuotePdfStatus = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    let actor: QuotePdfDeliveryActor
    try {
      actor = await authenticate('quote.view')
    } catch (cause) {
      if (cause instanceof ForbiddenError) {
        return { ok: false as const, error: toAuthPublicError(cause) }
      }
      throw cause
    }
    const parsed = quotePdfRequestSchema.safeParse(data)
    if (!parsed.success) return { ok: false as const, error: toPublicError(new QuotePdfDeliveryError('INVALID_REQUEST')) }
    try {
      const service = await getDeliveryService()
      const view = await service.status({ actor, identity: parsed.data.identity })
      return { ok: true as const, status: view }
    } catch (error) {
      return { ok: false as const, error: toPublicError(error) }
    }
  })

/**
 * Preview and download share the delivery service: the only difference is the
 * Content-Disposition. Both stream bytes through the authenticated server
 * process from private storage — no permanent public URL is ever produced.
 * Download/preview of document BYTES requires `quote.generate_pdf` per the
 * matrix: read_only actors may poll status but never retrieve documents.
 */
async function deliverQuotePdf(data: unknown, disposition: 'inline' | 'attachment') {
  let actor: QuotePdfDeliveryActor
  try {
    actor = await authenticate('quote.generate_pdf')
  } catch (cause) {
    if (cause instanceof ForbiddenError) {
      return { ok: false as const, error: toAuthPublicError(cause) }
    }
    throw cause
  }
  const parsed = quotePdfRequestSchema.safeParse(data)
  if (!parsed.success) {
    return { ok: false as const, error: toPublicError(new QuotePdfDeliveryError('INVALID_REQUEST')) }
  }
  try {
    const service = await getDeliveryService()
    const { bytes, headers } = await service.deliver({
      actor,
      identity: parsed.data.identity,
      disposition,
    })
    return {
      ok: true as const,
      file: {
        bytes: Buffer.from(bytes).toString('base64'),
        filename: contentDispositionFilename(headers['Content-Disposition'] ?? ''),
        contentType: headers['Content-Type'],
        disposition,
      },
    }
  } catch (error) {
    return { ok: false as const, error: toPublicError(error) }
  }
}

function contentDispositionFilename(value: string): string {
  const utf8 = /filename\*=UTF-8''([^;]+)/.exec(value)
  if (utf8?.[1]) return decodeURIComponent(utf8[1])
  const ascii = /filename="([^"]+)"/.exec(value)
  return ascii?.[1] ?? 'orcamento.pdf'
}

export const previewQuotePdf = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }: { data: unknown }) => deliverQuotePdf(data, 'inline'))

export const downloadQuotePdf = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(({ data }: { data: unknown }) => deliverQuotePdf(data, 'attachment'))

function sqlFor(database: unknown): Sql {
  return (database as { $client: Sql }).$client
}
