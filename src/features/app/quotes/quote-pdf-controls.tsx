import { Download, FilePdf, SpinnerGap, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  pollQuotePdfStatus,
  requestQuotePdfGeneration,
  previewQuotePdf,
  downloadQuotePdf,
  type QuotePdfPublicError,
} from './quote-pdf.functions'

/**
 * Authorized PDF controls for the quote detail header. The server decides
 * what this component may render: `capabilities` comes from the authorized
 * status payload, never from client-side role checks.
 */

export type QuotePdfStatusView =
  | { readonly kind: 'idle' }
  | {
      readonly kind: 'generating'
      readonly artifactId: string
      readonly attemptCount: number
      readonly startedAt: string
    }
  | {
      readonly kind: 'failed'
      readonly artifactId: string
      readonly attemptCount: number
      readonly errorCode: string
      readonly message: string
      readonly retryable: boolean
    }
  | {
      readonly kind: 'completed'
      readonly artifactId: string
      readonly snapshotVersion: number
      readonly templateVariant: 'summary' | 'commercial'
      readonly sizeBytes: number
      readonly pageCount: number
      readonly outputChecksum: string
      readonly completedAt: string
    }

export interface QuotePdfCapabilities {
  /** Server-evaluated: may this actor retrieve document bytes? */
  readonly canDownload: boolean
  /** Server-evaluated: may this actor trigger generation/regeneration? */
  readonly canRegenerate: boolean
}

export interface QuotePdfControlsProps {
  readonly identity: {
    readonly quoteId: string
    readonly snapshotId: string
    readonly snapshotVersion: number
    readonly templateId: string
    readonly templateVersion: number
  }
  /** Human-readable snapshot/version label, e.g. "Revisão 3". */
  readonly versionLabel: string
  readonly capabilities: QuotePdfCapabilities
  /** Polling cadence while a generation is in flight. */
  readonly pollIntervalMs?: number
}

type PollingPayload = Readonly<{ ok: true; status: QuotePdfStatusView }> | Readonly<{
  ok: false
  error: QuotePdfPublicError
}>

const POLL_INTERVAL_MS = 2_000
const MAX_POLL_ATTEMPTS = 60

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1_048_576) {
    return `${(sizeBytes / 1_048_576).toFixed(1)} MB`
  }
  return `${Math.max(1, Math.round(sizeBytes / 1024))} kB`
}

export function QuotePdfControls({
  identity,
  versionLabel,
  capabilities,
  pollIntervalMs = POLL_INTERVAL_MS,
}: QuotePdfControlsProps) {
  const [status, setStatus] = useState<QuotePdfStatusView | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [actionPending, setActionPending] = useState(false)
  const [unauthorized, setUnauthorized] = useState(false)
  const pollAttempts = useRef(0)
  const activeIdentity = useRef(identity)

  const refresh = useCallback(async () => {
    const result = (await pollQuotePdfStatus({ data: { identity } })) as unknown as PollingPayload
    if (!result.ok) {
      if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
        setUnauthorized(true)
        return null
      }
      setLoadError(result.error.message)
      return null
    }
    setLoadError(null)
    setUnauthorized(false)
    setStatus(result.status)
    return result.status
  }, [identity])

  useEffect(() => {
    activeIdentity.current = identity
    setStatus(null)
    setLoadError(null)
    setUnauthorized(false)
    pollAttempts.current = 0
    void refresh()
  }, [identity, refresh])

  // Poll while a generation is in flight; stop on terminal states.
  useEffect(() => {
    if (status?.kind !== 'generating') return
    if (pollAttempts.current >= MAX_POLL_ATTEMPTS) {
      setLoadError('A geração está demorando mais que o esperado. Tente novamente.')
      return
    }
    const timer = setTimeout(() => {
      pollAttempts.current += 1
      void refresh()
    }, pollIntervalMs)
    return () => clearTimeout(timer)
  }, [status, refresh, pollIntervalMs])

  const handleGenerate = async () => {
    if (actionPending || !capabilities.canRegenerate) return
    setActionPending(true)
    try {
      const result = (await requestQuotePdfGeneration({
        data: { identity },
      })) as unknown as PollingPayload
      if (!result.ok) {
        if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
          setUnauthorized(true)
        } else {
          setLoadError(result.error.message)
        }
        return
      }
      setStatus(result.status)
    } finally {
      setActionPending(false)
    }
  }

  const openPdf = async (disposition: 'inline' | 'attachment') => {
    if (actionPending || !capabilities.canDownload) return
    setActionPending(true)
    try {
      const fetcher = disposition === 'inline' ? previewQuotePdf : downloadQuotePdf
      const result = (await fetcher({
        data: { identity },
      })) as unknown as
        | Readonly<{ ok: true; file: { bytes: string; filename: string; contentType: string } }>
        | Readonly<{ ok: false; error: QuotePdfPublicError }>
      if (!result.ok) {
        if (result.error.code === 'FORBIDDEN' || result.error.code === 'NOT_FOUND') {
          setUnauthorized(true)
        } else {
          setLoadError(result.error.message)
        }
        return
      }
      const binary = atob(result.file.bytes)
      const bytes = new Uint8Array(binary.length)
      for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index)
      }
      const url = URL.createObjectURL(
        new Blob([bytes], { type: result.file.contentType }),
      )
      const anchor = document.createElement('a')
      anchor.href = url
      if (disposition === 'attachment') {
        // Use the server-provided filename so the expected name is preserved.
        anchor.download = result.file.filename
        anchor.click()
      } else {
        window.open(url, '_blank', 'noopener')
      }
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } finally {
      setActionPending(false)
    }
  }

  if (unauthorized) return null

  return (
    <section aria-label="Documento PDF do orçamento" className="space-y-3">
      <p className="text-xs text-muted-foreground">
        PDF da {versionLabel.toLowerCase()}. Versões anteriores permanecem
        disponíveis e não refletem edições posteriores.
      </p>

      {loadError ? (
        <Alert variant="destructive" role="alert">
          <WarningCircle aria-hidden="true" weight="light" />
          <AlertTitle>Não foi possível concluir a operação</AlertTitle>
          <AlertDescription>
            <p>{loadError}</p>
            <Button
              type="button"
              variant="outline"
              size="default"
              className="mt-3"
              onClick={() => void refresh()}
            >
              Tentar novamente
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {status?.kind === 'failed' ? (
        <Alert variant="destructive" role="alert">
          <WarningCircle aria-hidden="true" weight="light" />
          <AlertTitle>A geração do PDF falhou</AlertTitle>
          <AlertDescription>
            <p>{status.message}</p>
            {capabilities.canRegenerate && status.retryable ? (
              <Button
                type="button"
                variant="outline"
                size="default"
                className="mt-3"
                disabled={actionPending}
                onClick={() => void handleGenerate()}
              >
                Tentar novamente
              </Button>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {status?.kind === 'completed' && capabilities.canDownload ? (
          <>
            <Button
              type="button"
              variant="outline"
              disabled={actionPending}
              onClick={() => void openPdf('inline')}
            >
              <FilePdf aria-hidden="true" weight="light" />
              Visualizar PDF
            </Button>
            <Button
              type="button"
              variant="primary"
              disabled={actionPending}
              onClick={() => void openPdf('attachment')}
            >
              <Download aria-hidden="true" weight="light" />
              Baixar PDF
            </Button>
            <span className="text-xs text-muted-foreground">
              {formatBytes(status.sizeBytes)} · {status.pageCount}{' '}
              {status.pageCount === 1 ? 'página' : 'páginas'}
            </span>
          </>
        ) : null}

        {capabilities.canRegenerate ? (
          <Button
            type="button"
            variant="outline"
            disabled={actionPending || status?.kind === 'generating'}
            onClick={() => void handleGenerate()}
          >
            {status?.kind === 'generating' ? (
              <SpinnerGap aria-hidden="true" weight="light" className="animate-spin" />
            ) : null}
            {status?.kind === 'generating'
              ? 'Gerando…'
              : status?.kind === 'completed'
                ? 'Gerar novamente'
                : 'Gerar PDF'}
          </Button>
        ) : null}

        {status?.kind === 'generating' ? (
          <span role="status" className="text-xs text-muted-foreground">
            Gerando o documento. Esta operação pode levar alguns segundos.
          </span>
        ) : null}
      </div>
    </section>
  )
}
