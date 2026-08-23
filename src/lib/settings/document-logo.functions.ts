import { logUnexpectedError } from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import { getDatabase } from '@/lib/db/database.server'
import { getAppSession } from '@/lib/auth/session.server'
import {
  createS3DocumentLogoStorage,
} from '@/lib/storage/document-logo-storage.server'
import { createS3Client, parseS3Config } from '@/lib/storage/s3.server'
import {
  createPostgresDocumentLogoActivation,
  createPostgresDocumentLogoRepository,
  createPostgresDocumentLogoSettingsReader,
  createConsoleDocumentLogoAuditSink,
} from '@/lib/settings/document-logo-postgres.server'
import {
  createDocumentLogoService,
  type DocumentLogoActor,
  type DocumentLogoServiceContract,
} from '@/lib/settings/document-logo-service.server'

/**
 * Authorized admin endpoints for the private document logo pipeline.
 *
 * Every call re-derives the actor server-side from the Better Auth request
 * cookie (`getAppSession`) and fails closed when no session resolves; the
 * logo service denies non-admins with `FORBIDDEN`, matching the centralized
 * RBAC matrix. Previews
 * return short-lived signed URLs that must never be persisted; no endpoint
 * ever produces a permanent public object URL.
 */

export type DocumentLogoPublicErrorCode =
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'DISALLOWED_FILE_TYPE'
  | 'FILE_TOO_LARGE'
  | 'INVALID_CONTENT'
  | 'CHECKSUM_MISMATCH'
  | 'SIZE_MISMATCH'
  | 'IMAGE_DECODE_FAILED'
  | 'IMAGE_DIMENSIONS_EXCEEDED'
  | 'INVALID_STATE'
  | 'STORAGE_UNAVAILABLE'
  | 'CONFLICT'
  | 'INTERNAL_ERROR'

export type DocumentLogoPublicError = Readonly<{
  code: DocumentLogoPublicErrorCode
  status: number
  message: string
}>

const ERROR_STATUS: Readonly<Record<DocumentLogoPublicErrorCode, number>> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_REQUEST: 400,
  DISALLOWED_FILE_TYPE: 415,
  FILE_TOO_LARGE: 413,
  INVALID_CONTENT: 415,
  CHECKSUM_MISMATCH: 422,
  SIZE_MISMATCH: 422,
  IMAGE_DECODE_FAILED: 415,
  IMAGE_DIMENSIONS_EXCEEDED: 422,
  INVALID_STATE: 409,
  STORAGE_UNAVAILABLE: 503,
  CONFLICT: 409,
  INTERNAL_ERROR: 500,
}

function publicMessage(code: DocumentLogoPublicErrorCode): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'Autenticação necessária.'
    case 'FORBIDDEN':
      return 'Apenas administradores podem gerenciar o logo dos documentos.'
    case 'NOT_FOUND':
      return 'Logo não encontrado.'
    case 'INVALID_REQUEST':
      return 'Solicitação inválida.'
    case 'DISALLOWED_FILE_TYPE':
      return 'Formato de arquivo não permitido. Use PNG, JPEG ou WebP.'
    case 'FILE_TOO_LARGE':
      return 'O arquivo excede o tamanho máximo permitido.'
    case 'INVALID_CONTENT':
    case 'IMAGE_DECODE_FAILED':
      return 'O arquivo não é uma imagem válida.'
    case 'CHECKSUM_MISMATCH':
    case 'SIZE_MISMATCH':
      return 'O arquivo enviado não corresponde ao declarado. Tente novamente.'
    case 'IMAGE_DIMENSIONS_EXCEEDED':
      return 'As dimensões da imagem excedem o limite suportado.'
    case 'INVALID_STATE':
      return 'Operação não permitida no estado atual do logo.'
    case 'STORAGE_UNAVAILABLE':
      return 'O armazenamento está temporariamente indisponível.'
    case 'CONFLICT':
      return 'As configurações foram alteradas por outra pessoa. Recarregue e tente novamente.'
    default:
      return 'Não foi possível concluir a operação.'
  }
}

function toPublicError(code: string): DocumentLogoPublicError {
  const known = (
    Object.keys(ERROR_STATUS) as readonly DocumentLogoPublicErrorCode[]
  ).includes(code as DocumentLogoPublicErrorCode)
    ? (code as DocumentLogoPublicErrorCode)
    : 'INTERNAL_ERROR'
  return {
    code: known,
    status: ERROR_STATUS[known],
    message: publicMessage(known),
  }
}

async function getLogoService(): Promise<DocumentLogoServiceContract> {
  const database = await getDatabase()
  const s3Config = parseS3Config(process.env)
  return createDocumentLogoService({
    repository: createPostgresDocumentLogoRepository(database),
    storage: createS3DocumentLogoStorage(createS3Client(s3Config), s3Config),
    activation: createPostgresDocumentLogoActivation(database).activate,
    settings: createPostgresDocumentLogoSettingsReader(database),
    audit: createConsoleDocumentLogoAuditSink(),
    authenticate: async (actor) => actor ?? null,
  })
}

/**
 * Resolves the caller from the request cookie through the Better Auth session
 * adapter. Authorization stays in the logo service (`requireAdmin` denies
 * non-admins with FORBIDDEN before any storage or persistence happens), so a
 * denial can be attributed to an authenticated actor.
 */
async function authenticate(): Promise<DocumentLogoActor | null> {
  const session = await getAppSession()
  if (!session) return null
  return { id: session.user.id, role: session.user.role }
}

const acceptUnknownInput = (input: unknown) => input

const initiateSchema = z.object({ declaration: z.unknown() })
const assetIdSchema = z.object({ assetId: z.string().uuid() })
const activateSchema = z.object({
  assetId: z.string().uuid(),
  expectedVersion: z.number().int().positive(),
})

export const initiateDocumentLogoUpload = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = await authenticate()
    if (!actor) {
      return { ok: false as const, error: toPublicError('UNAUTHENTICATED') }
    }
    const parsed = initiateSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false as const, error: toPublicError('INVALID_REQUEST') }
    }
    try {
      const service = await getLogoService()
      const result = await service.initiateUpload({
        actor,
        declaration: parsed.data.declaration,
      })
      return 'error' in result
        ? ({ ok: false as const, error: toPublicError(result.error) })
        : ({ ok: true as const, ...result })
    } catch (error) {
      logUnexpectedError('document-logo.initiate', error)
      return { ok: false as const, error: toPublicError('INTERNAL_ERROR') }
    }
  })

export const finalizeDocumentLogoUpload = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = await authenticate()
    if (!actor) {
      return { ok: false as const, error: toPublicError('UNAUTHENTICATED') }
    }
    const parsed = assetIdSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false as const, error: toPublicError('INVALID_REQUEST') }
    }
    try {
      const service = await getLogoService()
      const result = await service.finalizeUpload({
        actor,
        assetId: parsed.data.assetId,
      })
      return 'error' in result
        ? ({ ok: false as const, error: toPublicError(result.error) })
        : ({ ok: true as const, asset: result })
    } catch (error) {
      logUnexpectedError('document-logo.finalize', error)
      return { ok: false as const, error: toPublicError('INTERNAL_ERROR') }
    }
  })

export const activateDocumentLogo = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = await authenticate()
    if (!actor) {
      return { ok: false as const, error: toPublicError('UNAUTHENTICATED') }
    }
    const parsed = activateSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false as const, error: toPublicError('INVALID_REQUEST') }
    }
    try {
      const service = await getLogoService()
      // The next payload is built server-side from the current canonical
      // value; the client only supplies the asset id and its known version.
      const result = await service.activateLogo({
        actor,
        assetId: parsed.data.assetId,
        expectedVersion: parsed.data.expectedVersion,
      })
      return result.ok
        ? ({ ok: true as const, asset: result.asset, version: result.version })
        : ({ ok: false as const, error: toPublicError(result.error) })
    } catch (error) {
      logUnexpectedError('document-logo.activate', error)
      return { ok: false as const, error: toPublicError('INTERNAL_ERROR') }
    }
  })

export const previewDocumentLogo = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }) => {
    const actor = await authenticate()
    if (!actor) {
      return { ok: false as const, error: toPublicError('UNAUTHENTICATED') }
    }
    const parsed = assetIdSchema.safeParse(data)
    if (!parsed.success) {
      return { ok: false as const, error: toPublicError('INVALID_REQUEST') }
    }
    try {
      const service = await getLogoService()
      const result = await service.previewLogo({
        actor,
        assetId: parsed.data.assetId,
      })
      return 'error' in result
        ? ({ ok: false as const, error: toPublicError(result.error) })
        : ({ ok: true as const, ...result })
    } catch (error) {
      logUnexpectedError('document-logo.preview', error)
      return { ok: false as const, error: toPublicError('INTERNAL_ERROR') }
    }
  })

export const purgeAbandonedDocumentLogos = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async () => {
    const actor = await authenticate()
    if (!actor) {
      return { ok: false as const, error: toPublicError('UNAUTHENTICATED') }
    }
    try {
      const service = await getLogoService()
      const result = await service.purgeAbandonedStagedAssets({ actor })
      return { ok: true as const, ...result }
    } catch (error) {
      logUnexpectedError('document-logo.purge-abandoned', error)
      return { ok: false as const, error: toPublicError('INTERNAL_ERROR') }
    }
  })
