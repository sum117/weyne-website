import {
  Download,
  FilePdf,
  Image,
  SpinnerGap,
  Trash,
  UploadSimple,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatDate } from '@/lib/intl/format'
import {
  deleteOrderAttachment,
  downloadOrderAttachment,
  listOrderAttachments,
  uploadOrderAttachment,
  type OrderAttachmentListItem,
} from './order-attachment.functions'

/**
 * Accessible order attachment panel for the order-detail page.
 *
 * The server decides what this component may render: `capabilities` comes
 * from the authorized order payload (see attachment-access.server), never
 * from client-side role checks. Downloads stream privately through the
 * server functions — no object key or storage URL ever reaches this code.
 */

export interface OrderAttachmentCapabilitiesView {
  readonly canList: boolean
  readonly canDownload: boolean
  readonly canUpload: boolean
  readonly mayDeleteAny: boolean
}

export interface OrderAttachmentsPanelProps {
  readonly orderId: string
  /** Server-evaluated capabilities for the current actor. */
  readonly capabilities: OrderAttachmentCapabilitiesView
}

type LoadState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'unauthorized' }
  | { readonly kind: 'error'; readonly message: string }
  | { readonly kind: 'ready' }

interface UploadProgress {
  readonly filename: string
  readonly percent: number
}

const MIME_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'application/pdf': 'PDF',
  'image/png': 'PNG',
  'image/jpeg': 'JPEG',
})

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1_048_576) {
    return `${(sizeBytes / 1_048_576).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} kB`
}

function formatTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return formatDate(date, {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'UTC',
  })
}

function isAttachmentFile(file: File): file is File {
  return ['application/pdf', 'image/png', 'image/jpeg'].includes(file.type)
}

function toBase64(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes)
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < view.length; offset += chunkSize) {
    binary += String.fromCharCode(...view.subarray(offset, offset + chunkSize))
  }
  return btoa(binary)
}

async function sha256Base64(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return toBase64(digest)
}

function newIdempotencyKey(): string {
  return crypto.randomUUID()
}

export function OrderAttachmentsPanel({
  orderId,
  capabilities,
}: OrderAttachmentsPanelProps) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: 'loading' })
  const [attachments, setAttachments] = useState<readonly OrderAttachmentListItem[]>([])
  const [busy, setBusy] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // Pending delete target between "Remover" click and dialog confirmation;
  // focus returns to the row's delete button after the flow resolves.
  const [deleteTarget, setDeleteTarget] = useState<OrderAttachmentListItem | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const lastFocusedDeleteRef = useRef<HTMLButtonElement | null>(null)

  const refresh = useCallback(async (): Promise<boolean> => {
    const result = (await listOrderAttachments({
      data: { orderId },
    })) as unknown as Awaited<ReturnType<typeof listOrderAttachments>>
    if (!result.ok) {
      if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
        setLoadState({ kind: 'unauthorized' })
      } else {
        setLoadState({ kind: 'error', message: result.error.message })
      }
      return false
    }
    setAttachments(result.attachments)
    setLoadState({ kind: 'ready' })
    return true
  }, [orderId])

  useEffect(() => {
    setLoadState({ kind: 'loading' })
    void refresh()
  }, [refresh])

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    setActionError(null)
    if (!file) return
    if (!isAttachmentFile(file)) {
      setActionError('Tipo de arquivo não permitido. Use PDF, PNG ou JPEG.')
      setAnnouncement('Envio recusado: tipo de arquivo não permitido.')
      return
    }
    if (!capabilities.canUpload || busy) return

    setBusy(true)
    setUploadProgress({ filename: file.name, percent: 30 })
    try {
      const buffer = await file.arrayBuffer()
      setUploadProgress({ filename: file.name, percent: 60 })
      const checksumSha256 = await sha256Base64(buffer)
      const result = (await uploadOrderAttachment({
        data: {
          orderId,
          idempotencyKey: newIdempotencyKey(),
          label: file.name,
          originalFilename: file.name,
          declaredMimeType: file.type,
          declaredSizeBytes: file.size,
          declaredChecksumSha256: checksumSha256,
          bytesBase64: toBase64(buffer),
        },
      })) as unknown as Awaited<ReturnType<typeof uploadOrderAttachment>>
      setUploadProgress({ filename: file.name, percent: 90 })

      if (!result.ok) {
        setActionError(result.error.message)
        setAnnouncement(`Falha no envio: ${result.error.message}`)
        return
      }
      const refreshed = await refresh()
      if (refreshed) {
        setAnnouncement(`Anexo "${result.attachment.label}" enviado com sucesso.`)
      }
    } catch {
      const message = 'Não foi possível ler o arquivo selecionado. Tente novamente.'
      setActionError(message)
      setAnnouncement(`Falha no envio: ${message}`)
    } finally {
      setBusy(false)
      setUploadProgress(null)
    }
  }

  const handleDownload = async (attachment: OrderAttachmentListItem) => {
    if (!capabilities.canDownload || busy) return
    setBusy(true)
    setActionError(null)
    try {
      const result = (await downloadOrderAttachment({
        data: { orderId, attachmentId: attachment.id },
      })) as unknown as Awaited<ReturnType<typeof downloadOrderAttachment>>
      if (!result.ok) {
        setActionError(result.error.message)
        setAnnouncement(`Falha no download: ${result.error.message}`)
        return
      }
      const binary = atob(result.file.bytesBase64)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.file.contentType }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = result.file.filename
      anchor.click()
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
      setAnnouncement(`Download de "${attachment.label}" concluído.`)
    } finally {
      setBusy(false)
    }
  }

  const confirmDelete = async () => {
    const target = deleteTarget
    setDeleteTarget(null)
    if (!target || !capabilities.mayDeleteAny || busy) return
    setBusy(true)
    setDeletingId(target.id)
    setActionError(null)
    try {
      const result = (await deleteOrderAttachment({
        data: {
          orderId,
          attachmentId: target.id,
          idempotencyKey: newIdempotencyKey(),
        },
      })) as unknown as Awaited<ReturnType<typeof deleteOrderAttachment>>
      if (!result.ok) {
        setActionError(result.error.message)
        setAnnouncement(`Falha ao remover: ${result.error.message}`)
        return
      }
      const refreshed = await refresh()
      if (refreshed) {
        setAnnouncement(`Anexo "${target.label}" removido.`)
      }
    } finally {
      setBusy(false)
      setDeletingId(null)
      lastFocusedDeleteRef.current?.focus()
      lastFocusedDeleteRef.current = null
    }
  }

  if (loadState.kind === 'unauthorized') return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl text-navy">Anexos do pedido</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Screen-reader announcements for progress and outcomes. */}
        <p aria-live="polite" role="status" className="sr-only">{announcement}</p>

        {loadState.kind === 'error' ? (
          <Alert variant="destructive" role="alert">
            <WarningCircle aria-hidden="true" weight="light" />
            <AlertTitle>Não foi possível carregar os anexos</AlertTitle>
            <AlertDescription>
              <p>{loadState.message}</p>
              <Button
                type="button"
                variant="outline"
                size="default"
                className="mt-3"
                onClick={() => {
                  setLoadState({ kind: 'loading' })
                  void refresh()
                }}
              >
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {actionError ? (
          <Alert variant="destructive" role="alert">
            <WarningCircle aria-hidden="true" weight="light" />
            <AlertTitle>Não foi possível concluir a operação</AlertTitle>
            <AlertDescription>
              <p>{actionError}</p>
              <Button
                type="button"
                variant="outline"
                size="default"
                className="mt-3"
                disabled={busy}
                onClick={() => void handleRetryAfterActionError()}
              >
                Tentar novamente
              </Button>
            </AlertDescription>
          </Alert>
        ) : null}

        {uploadProgress ? (
          <div
            role="progressbar"
            aria-valuenow={uploadProgress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`Enviando ${uploadProgress.filename}`}
            className="rounded-lg border border-table-divider p-3"
          >
            <div className="flex items-center gap-2 text-sm">
              <SpinnerGap aria-hidden="true" weight="light" className="animate-spin text-blue" />
              <span className="truncate">
                Enviando {uploadProgress.filename} — {uploadProgress.percent}%
              </span>
            </div>
            <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-blue transition-all duration-300 ease-house"
                style={{ width: `${uploadProgress.percent}%` }}
              />
            </div>
          </div>
        ) : null}

        {loadState.kind === 'ready' && attachments.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum anexo neste pedido.
          </p>
        ) : null}

        {attachments.length > 0 ? (
          <ul className="divide-y divide-table-divider" aria-label="Anexos do pedido">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                data-testid={`order-attachment-${attachment.id}`}
                className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="flex items-center gap-2 font-semibold break-words text-foreground">
                    <span aria-hidden="true">
                      {attachment.validatedMimeType === 'application/pdf' ? (
                        <FilePdf weight="light" />
                      ) : (
                        <Image weight="light" />
                      )}
                    </span>
                    <span className="truncate">{attachment.label}</span>
                  </p>
                  <p className="mt-1 text-xs break-all text-muted-foreground">
                    {attachment.originalFilename} ·{' '}
                    {MIME_LABELS[attachment.validatedMimeType] ?? attachment.validatedMimeType} ·{' '}
                    {formatBytes(attachment.sizeBytes)} ·{' '}
                    Enviado em{' '}
                    <time dateTime={new Date(attachment.createdAt).toISOString()}>
                      {formatTimestamp(attachment.createdAt.toISOString())}
                    </time>
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {capabilities.canDownload ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="default"
                      disabled={busy}
                      onClick={() => void handleDownload(attachment)}
                    >
                      <Download aria-hidden="true" weight="light" />
                      Baixar <span className="sr-only">{attachment.label}</span>
                    </Button>
                  ) : null}
                  {capabilities.mayDeleteAny ? (
                    <AlertDialog.Root
                      onOpenChange={(open) => {
                        if (!open && !deletingId) {
                          setDeleteTarget(null)
                          lastFocusedDeleteRef.current?.focus()
                          lastFocusedDeleteRef.current = null
                        }
                      }}
                    >
                      <AlertDialog.Trigger asChild>
                        <Button
                          type="button"
                          variant="destructive"
                          size="default"
                          disabled={busy}
                          ref={(node) => {
                            if (node) lastFocusedDeleteRef.current = node
                          }}
                          onClick={() => setDeleteTarget(attachment)}
                        >
                          <Trash aria-hidden="true" weight="light" />
                          Remover <span className="sr-only">{attachment.label}</span>
                        </Button>
                      </AlertDialog.Trigger>
                      {deleteTarget?.id === attachment.id ? (
                        <AlertDialog.Portal>
                          <AlertDialog.Overlay className="fixed inset-0 z-overlay bg-navy/45 backdrop-blur-[2px]" />
                          <AlertDialog.Content className="fixed top-1/2 left-1/2 z-overlay grid w-[calc(100%-2rem)] max-w-lg -translate-1/2 gap-4 rounded-xl border border-border bg-background p-6 shadow-xl">
                            <AlertDialog.Title className="font-display text-lg font-semibold text-foreground">
                              Remover anexo?
                            </AlertDialog.Title>
                            <AlertDialog.Description className="text-sm text-muted-foreground">
                              O anexo “{deleteTarget.label}” será removido definitivamente deste
                              pedido. Os dados comerciais do pedido não são alterados.
                            </AlertDialog.Description>
                            <div className="flex flex-col-reverse justify-end gap-2 sm:flex-row">
                              <AlertDialog.Cancel asChild>
                                <Button type="button" variant="outline">
                                  Manter anexo
                                </Button>
                              </AlertDialog.Cancel>
                              <AlertDialog.Action asChild>
                                <Button
                                  type="button"
                                  variant="destructive"
                                  onClick={() => void confirmDelete()}
                                >
                                  Remover definitivamente
                                </Button>
                              </AlertDialog.Action>
                            </div>
                          </AlertDialog.Content>
                        </AlertDialog.Portal>
                      ) : null}
                    </AlertDialog.Root>
                  ) : null}
                  {deletingId === attachment.id ? (
                    <Badge variant="warning">
                      <SpinnerGap aria-hidden="true" className="animate-spin" />
                      Removendo…
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : null}

        {capabilities.canUpload ? (
          <div className="border-t border-table-divider pt-4">
            <label htmlFor="order-attachment-upload" className="inline-flex cursor-pointer">
              <input
                id="order-attachment-upload"
                type="file"
                accept="application/pdf,image/png,image/jpeg"
                className="sr-only"
                disabled={busy}
                onChange={(event) => void handleUpload(event)}
              />
              <span
                aria-hidden="true"
                className={buttonShellClassName(busy)}
              >
                <UploadSimple weight="light" />
                Enviar anexo
              </span>
            </label>
            <p className="mt-2 text-xs text-muted-foreground">
              Formatos aceitos: PDF, PNG ou JPEG até 25 MB.
            </p>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )

  /**
   * Re-running the last action after a failure would need the original file
   * or click; instead retry re-syncs the list so a partially completed
   * operation never produces duplicate records.
   */
  async function handleRetryAfterActionError() {
    setActionError(null)
    setLoadState({ kind: 'loading' })
    await refresh()
  }
}

function buttonShellClassName(disabled: boolean): string {
  return [
    'inline-flex min-h-11 items-center gap-2 rounded-full px-6 text-[15px] font-semibold',
    'bg-blue text-white shadow-xs hover:bg-navy focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
    disabled ? 'pointer-events-none opacity-60' : '',
  ].join(' ')
}
