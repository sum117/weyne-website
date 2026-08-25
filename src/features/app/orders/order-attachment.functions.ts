import {
  logStructuredEvent,
  logUnexpectedError,
} from '@/lib/server/log-redaction'
import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'
import {
  DENIAL_MESSAGES,
  ForbiddenError,
  UnauthenticatedError,
} from '@/lib/auth/authorization.server'
import type { Capability } from '@/lib/auth/capabilities'
import { requireCommercialContext } from '@/lib/auth/commercial-scope.server'
import {
  AttachmentApiError,
  createOrderAttachmentService,
  toPublicOrderAttachment,
  type AttachmentActor,
  type PublicOrderAttachment,
} from '@/lib/orders/attachments.server'
import { createPostgresAttachmentRepository } from '@/lib/orders/attachment-repository.server'
import { createS3PrivateAttachmentStorage } from '@/lib/storage/order-attachment-storage.server'
import { createS3Client, parseS3Config } from '@/lib/storage/s3.server'
import { getDatabase } from '@/lib/db/database.server'

/**
 * Authorized order attachment endpoints: list, upload, download, and delete.
 * Every call re-derives the session from the request cookie, checks the
 * centralized capability matrix (`order.view_attachment` / `order.add_attachment`
 * / `order.remove_attachment`), and re-evaluates order scope server-side
 * through the attachment service; the UI never decides authorization.
 * Downloads stream privately through the authenticated server process — no
 * public or signed object URL is ever produced, persisted, or sent to the
 * browser. Out-of-scope orders resolve as NOT_FOUND so IDs cannot be
 * enumerated; in-scope denials carry the fixed pt-BR FORBIDDEN message.
 */

const orderIdSchema = z.object({ orderId: z.string().uuid() })

/**
 * Server-side size gate for the base64 transport payload. The attachment
 * service enforces the 25 MiB policy against actual bytes, but this bound
 * rejects absurd requests before they are buffered or decoded: 25 MiB of
 * file bytes is ~34.2 MB of base64 (4/3 expansion), so anything beyond
 * MAX_ATTACHMENT_BYTES + slack cannot possibly be a legal upload.
 */
const ORDER_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024
const BASE64_EXPANSION = Math.ceil(ORDER_ATTACHMENT_MAX_BYTES / 3) * 4
const bytesBase64Schema = z
  .string()
  .min(1)
  .max(BASE64_EXPANSION + 1024)

const uploadInputSchema = orderIdSchema.extend({
  idempotencyKey: z.string().min(1).max(128),
  label: z.string().min(1).max(120),
  originalFilename: z.string().min(1).max(255),
  declaredMimeType: z.enum(['application/pdf', 'image/png', 'image/jpeg']),
  declaredSizeBytes: z.number().int().positive(),
  declaredChecksumSha256: z.string().regex(/^[A-Za-z0-9+/]{43}=$/),
  /** Base64 of the file bytes; the server revalidates everything. */
  bytesBase64: bytesBase64Schema,
})

const attachmentTargetSchema = orderIdSchema.extend({
  attachmentId: z.string().uuid(),
  idempotencyKey: z.string().min(1).max(128).optional(),
})

export type OrderAttachmentPublicError = Readonly<{
  code: string
  status: number
  message: string
}>

function publicMessage(code: string): string {
  switch (code) {
    case 'UNAUTHENTICATED':
      return 'Autenticação necessária.'
    case 'FORBIDDEN':
      return 'Você não tem permissão para esta operação.'
    case 'NOT_FOUND':
      return 'Pedido ou anexo não encontrado.'
    case 'INVALID_REQUEST':
    case 'DECLARATION_MISMATCH':
    case 'IDEMPOTENCY_KEY_REQUIRED':
      return 'Solicitação inválida. Verifique os dados informados.'
    case 'DISALLOWED_FILE_TYPE':
    case 'FILE_SIGNATURE_MISMATCH':
      return 'Tipo de arquivo não permitido. Use PDF, PNG ou JPEG.'
    case 'FILE_TOO_LARGE':
      return 'Arquivo maior que o limite permitido.'
    case 'CHECKSUM_MISMATCH':
      return 'O arquivo selecionado não corresponde ao envio original. Selecione o arquivo novamente.'
    case 'IDEMPOTENCY_KEY_REUSED':
      return 'Esta operação já foi registrada com dados diferentes. Atualize a página e tente novamente.'
    case 'INVALID_STATE':
    case 'ATTACHMENT_LIMIT_REACHED':
    case 'ATTACHMENT_NOT_READY':
      return 'O pedido ou anexo não está em um estado que permite esta operação.'
    case 'STORAGE_INTEGRITY_FAILED':
      return 'Falha temporária de armazenamento. Tente novamente.'
    default:
      return 'Não foi possível concluir a operação.'
  }
}

/** Fails-closed unauthenticated error, mirroring the sibling endpoints. */
const UNAUTHENTICATED_ERROR: OrderAttachmentPublicError = Object.freeze({
  code: 'UNAUTHENTICATED',
  status: 401,
  message: 'Autenticação necessária.',
})

const STATUS_BY_CODE: Readonly<Record<string, number>> = Object.freeze({
  INVALID_REQUEST: 400,
  DECLARATION_MISMATCH: 400,
  IDEMPOTENCY_KEY_REQUIRED: 400,
  DISALLOWED_FILE_TYPE: 415,
  FILE_SIGNATURE_MISMATCH: 415,
  FILE_TOO_LARGE: 413,
  CHECKSUM_MISMATCH: 422,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  ATTACHMENT_LIMIT_REACHED: 409,
  IDEMPOTENCY_KEY_REUSED: 409,
  ATTACHMENT_NOT_READY: 409,
  STORAGE_INTEGRITY_FAILED: 502,
  UNAUTHENTICATED: 401,
  INTERNAL_ERROR: 500,
})

function toPublicError(error: unknown): OrderAttachmentPublicError {
  if (error instanceof AttachmentApiError) {
    const status = STATUS_BY_CODE[error.code] ?? 500
    return { code: error.code, status, message: publicMessage(error.code) }
  }
  logUnexpectedError('order-attachment.endpoint', error)
  return {
    code: 'INTERNAL_ERROR',
    status: 500,
    message: publicMessage('INTERNAL_ERROR'),
  }
}

/**
 * Resolves the caller from the request cookie and checks the attachment
 * capability for the operation. 401 when no session exists; 403 (fixed pt-BR)
 * when authenticated without the capability.
 */
async function authenticate(capability: Capability): Promise<AttachmentActor> {
  const context = await requireCommercialContext('order', capability)
  return { id: context.session.id, role: context.session.role }
}

async function getAttachmentService() {
  const database = await getDatabase()
  return createOrderAttachmentService({
    repository: createPostgresAttachmentRepository(database),
    storage: createS3PrivateAttachmentStorage(
      createS3Client(parseS3Config(process.env)),
      parseS3Config(process.env),
    ),
    audit: {
      async append(event) {
        // Sanitized by contract: event type, IDs, time, label only.
        logStructuredEvent({
          kind: 'audit',
          eventType: event.eventType,
          orderId: event.orderId,
          attachmentId: event.attachmentId,
          actorId: event.actorId,
          occurredAt: event.occurredAt.toISOString(),
          label: event.label,
        })
      },
    },
    policy: {
      allowedMimeTypes: ['application/pdf', 'image/png', 'image/jpeg'],
      maxFilesPerOrder: 20,
      maxSizeBytes: 25 * 1024 * 1024,
    },
  })
}

type AttachmentOperation<T> = (
  service: Awaited<ReturnType<typeof getAttachmentService>>,
) => Promise<T>

async function invoke<T>(operation: AttachmentOperation<T>) {
  try {
    const service = await getAttachmentService()
    return { ok: true as const, data: await operation(service) }
  } catch (error) {
    return { ok: false as const, error: toPublicError(error) }
  }
}

const acceptUnknownInput = (input: unknown) => input

/**
 * Runs the handler body with an authenticated actor, mapping the 401 error to
 * the public unauthenticated result. Authorization failures inside
 * `authenticate` propagate as ForbiddenError and are mapped per-endpoint.
 */
async function withActor<T>(
  capability: Capability,
  run: (actor: AttachmentActor) => Promise<T>,
): Promise<T | { ok: false; error: OrderAttachmentPublicError }> {
  try {
    const actor = await authenticate(capability)
    return await run(actor)
  } catch (cause) {
    if (cause instanceof UnauthenticatedError) {
      return { ok: false as const, error: UNAUTHENTICATED_ERROR }
    }
    if (cause instanceof ForbiddenError) {
      return {
        ok: false as const,
        error: {
          code: 'FORBIDDEN' as const,
          status: 403 as const,
          message: DENIAL_MESSAGES.FORBIDDEN,
        },
      }
    }
    throw cause
  }
}

export type OrderAttachmentListItem = PublicOrderAttachment

export type ListAttachmentsResult =
  | { ok: true; attachments: readonly OrderAttachmentListItem[] }
  | { ok: false; error: OrderAttachmentPublicError }

export const listOrderAttachments = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<ListAttachmentsResult> =>
    withActor('order.view_attachment', async (actor) => {
      const parsed = orderIdSchema.safeParse(data)
      if (!parsed.success) {
        return { ok: false, error: toPublicError(new AttachmentApiError('INVALID_REQUEST')) }
      }
      const result = await invoke((service) =>
        service.list({ actor, orderId: parsed.data.orderId }),
      )
      if (!result.ok) return result
      return {
        ok: true,
        attachments: result.data.map(toPublicOrderAttachment),
      }
    }))

export type UploadAttachmentResult =
  | { ok: true; attachment: OrderAttachmentListItem }
  | { ok: false; error: OrderAttachmentPublicError }

export const uploadOrderAttachment = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<UploadAttachmentResult> =>
    withActor('order.add_attachment', async (actor) => {
      const parsed = uploadInputSchema.safeParse(data)
      if (!parsed.success) {
        return { ok: false, error: toPublicError(new AttachmentApiError('INVALID_REQUEST')) }
      }
      const input = parsed.data
      const bytes = Uint8Array.from(Buffer.from(input.bytesBase64, 'base64'))
      const result = await invoke((service) =>
        service.upload({
          actor,
          orderId: input.orderId,
          idempotencyKey: input.idempotencyKey,
          label: input.label,
          originalFilename: input.originalFilename,
          declaredMimeType: input.declaredMimeType,
          declaredSizeBytes: input.declaredSizeBytes,
          declaredChecksumSha256: input.declaredChecksumSha256,
          bytes,
        }),
      )
      if (!result.ok) return result
      return { ok: true, attachment: toPublicOrderAttachment(result.data) }
    }))

export type DownloadAttachmentResult =
  | {
      ok: true
      file: {
        bytesBase64: string
        filename: string
        contentType: string
      }
    }
  | { ok: false; error: OrderAttachmentPublicError }

/**
 * Streams the private object through the authenticated server process as
 * base64 inside the authorized response. The browser never receives an object
 * key or any storage URL.
 */
export const downloadOrderAttachment = createServerFn({ method: 'GET' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<DownloadAttachmentResult> =>
    withActor('order.view_attachment', async (actor) => {
      const parsed = attachmentTargetSchema.safeParse(data)
      if (!parsed.success) {
        return { ok: false, error: toPublicError(new AttachmentApiError('INVALID_REQUEST')) }
      }
      const result = await invoke((service) =>
        service.download({
          actor,
          orderId: parsed.data.orderId,
          attachmentId: parsed.data.attachmentId,
        }),
      )
      if (!result.ok) return result
      const { attachment, bytes } = result.data
      return {
        ok: true,
        file: {
          bytesBase64: Buffer.from(bytes).toString('base64'),
          filename: attachment.originalFilename,
          contentType: attachment.validatedMimeType,
        },
      }
    }))

export type DeleteAttachmentResult =
  | { ok: true }
  | { ok: false; error: OrderAttachmentPublicError }

export const deleteOrderAttachment = createServerFn({ method: 'POST' })
  .validator(acceptUnknownInput)
  .handler(async ({ data }: { data: unknown }): Promise<DeleteAttachmentResult> =>
    withActor('order.remove_attachment', async (actor) => {
      const parsed = attachmentTargetSchema.safeParse(data)
      const idempotencyKey = parsed.success ? parsed.data.idempotencyKey : undefined
      if (!parsed.success || !idempotencyKey) {
        return { ok: false, error: toPublicError(new AttachmentApiError('IDEMPOTENCY_KEY_REQUIRED')) }
      }
      const result = await invoke((service) =>
        service.delete({
          actor,
          orderId: parsed.data.orderId,
          attachmentId: parsed.data.attachmentId,
          idempotencyKey,
        }),
      )
      if (!result.ok) return result
      return { ok: true }
    }))
