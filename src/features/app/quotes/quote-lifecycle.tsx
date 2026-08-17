import { ArrowRight, Copy } from '@phosphor-icons/react/dist/ssr'
import { useEffect, useRef, useState } from 'react'
import { ConfirmationDialog } from '@/components/patterns/confirmation-dialog'
import { Badge, type BadgeProps } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type {
  QuoteLifecycleStatus,
  QuoteLifecycleSummary,
} from './quote-lifecycle-data'

export type QuoteLifecycleCommand =
  | 'sendQuote'
  | 'reopenQuote'
  | 'approveQuote'
  | 'rejectQuote'
  | 'cancelQuote'

export interface QuoteLifecycleActor {
  readonly id: string
  readonly name?: string | null
  readonly role: string
}

export interface QuoteLifecycleHistoryEvent {
  readonly id: string
  readonly actor: QuoteLifecycleActor
  readonly occurredAt: string
  readonly fromStatus: QuoteLifecycleStatus
  readonly toStatus: QuoteLifecycleStatus
  readonly reason: string | null
  readonly command: QuoteLifecycleCommand
}

export interface QuoteLifecycleCommandRequest {
  readonly quoteId: string
  readonly command: QuoteLifecycleCommand
  readonly idempotencyKey: string
  readonly reason?: string
}

export interface QuoteDuplicationRequest {
  readonly sourceQuoteId: string
  readonly idempotencyKey: string
}

export type QuoteLifecycleMutationResult =
  | {
      readonly kind: 'success'
      readonly quote: QuoteLifecycleSummary
      readonly history: QuoteLifecycleHistoryEvent
    }
  | { readonly kind: 'denied' | 'illegal-state' | 'stale' | 'failed'; readonly message: string }

export type QuoteDuplicationMutationResult =
  | {
      readonly kind: 'success'
      readonly quote: { readonly id: string; readonly number: string }
    }
  | { readonly kind: 'denied' | 'illegal-state' | 'stale' | 'failed'; readonly message: string }

export interface QuoteLifecycleControlsProps {
  readonly quote: QuoteLifecycleSummary
  /** Server-evaluated actions for this actor and the current effective status. */
  readonly allowedActions: readonly QuoteLifecycleCommand[]
  /** Server-evaluated duplication capability for the visible source quote. */
  readonly canDuplicate: boolean
  readonly onTransition: (
    request: QuoteLifecycleCommandRequest,
  ) => Promise<QuoteLifecycleMutationResult>
  readonly onDuplicate: (
    request: QuoteDuplicationRequest,
  ) => Promise<QuoteDuplicationMutationResult>
  readonly onReconciled?: (
    quote: QuoteLifecycleSummary,
    history: QuoteLifecycleHistoryEvent,
  ) => void | Promise<void>
  readonly createIdempotencyKey?: () => string
}

type Action = QuoteLifecycleCommand | 'duplicateQuote'

type ActionConfig = {
  readonly label: string
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  readonly pendingLabel: string
  readonly successLabel: string
  readonly reason: 'none' | 'optional' | 'required'
  readonly tone: 'default' | 'destructive'
}

const ACTIONS: Readonly<Record<Action, ActionConfig>> = {
  sendQuote: {
    label: 'Enviar',
    title: 'Enviar orçamento?',
    description: 'O orçamento será congelado nesta revisão e ficará disponível para decisão.',
    confirmLabel: 'Confirmar envio',
    pendingLabel: 'Enviando…',
    successLabel: 'Orçamento enviado com sucesso.',
    reason: 'none',
    tone: 'default',
  },
  reopenQuote: {
    label: 'Reabrir',
    title: 'Reabrir orçamento?',
    description: 'A revisão enviada será reaberta como rascunho editável. Informe o motivo da correção.',
    confirmLabel: 'Confirmar reabertura',
    pendingLabel: 'Reabrindo…',
    successLabel: 'Orçamento reaberto com sucesso.',
    reason: 'required',
    tone: 'default',
  },
  approveQuote: {
    label: 'Aprovar',
    title: 'Aprovar orçamento?',
    description: 'A aprovação mantém os valores congelados. Uma observação é opcional.',
    confirmLabel: 'Confirmar aprovação',
    pendingLabel: 'Aprovando…',
    successLabel: 'Orçamento aprovado com sucesso.',
    reason: 'optional',
    tone: 'default',
  },
  rejectQuote: {
    label: 'Rejeitar',
    title: 'Rejeitar orçamento?',
    description: 'A rejeição é terminal para este documento. Informe o motivo.',
    confirmLabel: 'Confirmar rejeição',
    pendingLabel: 'Rejeitando…',
    successLabel: 'Orçamento rejeitado com sucesso.',
    reason: 'required',
    tone: 'destructive',
  },
  cancelQuote: {
    label: 'Cancelar orçamento',
    title: 'Cancelar orçamento?',
    description: 'O cancelamento é terminal, preserva o número e não apaga o histórico. Informe o motivo.',
    confirmLabel: 'Confirmar cancelamento',
    pendingLabel: 'Cancelando…',
    successLabel: 'Orçamento cancelado com sucesso.',
    reason: 'required',
    tone: 'destructive',
  },
  duplicateQuote: {
    label: 'Duplicar',
    title: 'Duplicar orçamento?',
    description: 'Será criado um novo rascunho com outro número e snapshots atuais. O orçamento original não será alterado.',
    confirmLabel: 'Confirmar duplicação',
    pendingLabel: 'Duplicando…',
    successLabel: 'Novo rascunho criado.',
    reason: 'none',
    tone: 'default',
  },
}

const statusVariants: Readonly<Record<string, BadgeProps['variant']>> = {
  draft: 'neutral',
  sent: 'info',
  approved: 'success',
  rejected: 'destructive',
  expired: 'warning',
  converted: 'success',
  cancelled: 'destructive',
}

const transitionSuccessMessages: Readonly<Record<QuoteLifecycleCommand, string>> = {
  sendQuote: ACTIONS.sendQuote.successLabel,
  reopenQuote: ACTIONS.reopenQuote.successLabel,
  approveQuote: ACTIONS.approveQuote.successLabel,
  rejectQuote: ACTIONS.rejectQuote.successLabel,
  cancelQuote: ACTIONS.cancelQuote.successLabel,
}

function defaultIdempotencyKey() {
  return globalThis.crypto?.randomUUID?.() ?? `quote-${Date.now()}-${Math.random()}`
}

export function QuoteStatusBadge({ status }: { status: QuoteLifecycleStatus }) {
  return <Badge variant={statusVariants[status.code] ?? 'neutral'}>{status.label}</Badge>
}

function actorLabel(actor: QuoteLifecycleActor) {
  if (actor.name?.trim()) return actor.name
  if (actor.role === 'system') return 'Sistema'
  return actor.id
}

function formatHistoryTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Fortaleza',
  }).format(date)
}

export function QuoteLifecycleHistory({
  events,
}: {
  readonly events: readonly QuoteLifecycleHistoryEvent[]
}) {
  return (
    <Card aria-label="Histórico do orçamento">
      <CardHeader>
        <CardTitle className="font-display text-2xl text-navy">Histórico</CardTitle>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma transição registrada.</p>
        ) : (
          <ol className="space-y-4">
            {events.map((event) => (
              <li key={event.id} className="rounded-xl border border-border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="font-semibold text-foreground">
                    {event.fromStatus.label} <span aria-hidden="true">→</span>{' '}
                    {event.toStatus.label}
                  </p>
                  <time
                    dateTime={event.occurredAt}
                    className="text-xs text-muted-foreground"
                  >
                    {formatHistoryTime(event.occurredAt)}
                  </time>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Por {actorLabel(event.actor)}
                </p>
                {event.reason ? (
                  <p className="mt-3 text-sm text-foreground">
                    <span className="font-semibold">Motivo:</span> {event.reason}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export function QuoteLifecycleControls({
  quote,
  allowedActions,
  canDuplicate,
  onTransition,
  onDuplicate,
  onReconciled,
  createIdempotencyKey = defaultIdempotencyKey,
}: QuoteLifecycleControlsProps) {
  const [activeAction, setActiveAction] = useState<Action | null>(null)
  const [reason, setReason] = useState('')
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [duplicatedQuote, setDuplicatedQuote] = useState<{
    id: string
    number: string
  } | null>(null)
  const [transitionCompleted, setTransitionCompleted] = useState(false)
  const keysRef = useRef(new Map<Action, { payload: string; key: string }>())

  useEffect(() => {
    setTransitionCompleted(false)
  }, [quote.version])

  const config = activeAction ? ACTIONS[activeAction] : null
  const normalizedReason = reason.trim()
  const requiredReasonMissing = config?.reason === 'required' && !normalizedReason

  function idempotencyKey(action: Action, payload: string) {
    const existing = keysRef.current.get(action)
    if (existing?.payload === payload) return existing.key
    const key = createIdempotencyKey()
    keysRef.current.set(action, { payload, key })
    return key
  }

  function openAction(action: Action) {
    setSuccessMessage(null)
    setActiveAction(action)
    setReason('')
  }

  function closeDialog() {
    setActiveAction(null)
    setReason('')
  }

  async function confirmAction() {
    if (!activeAction) return

    if (activeAction === 'duplicateQuote') {
      const result = await onDuplicate({
        sourceQuoteId: quote.id,
        idempotencyKey: idempotencyKey(activeAction, quote.id),
      })
      if (result.kind !== 'success') throw new Error(result.message)
      keysRef.current.delete(activeAction)
      setDuplicatedQuote(result.quote)
      setSuccessMessage(ACTIONS.duplicateQuote.successLabel)
      return
    }

    if (requiredReasonMissing) return
    const payload = config?.reason === 'none' ? '' : normalizedReason
    const result = await onTransition({
      quoteId: quote.id,
      command: activeAction,
      idempotencyKey: idempotencyKey(activeAction, payload),
      ...(payload ? { reason: payload } : {}),
    })
    if (result.kind !== 'success') throw new Error(result.message)

    keysRef.current.delete(activeAction)
    await onReconciled?.(result.quote, result.history)
    setTransitionCompleted(true)
    setSuccessMessage(transitionSuccessMessages[activeAction])
  }

  return (
    <section aria-label="Ações do orçamento" className="space-y-3">
      {successMessage ? (
        <div role="status" className="rounded-xl border border-success/30 bg-success/5 p-4 text-sm text-foreground">
          <p className="font-semibold">{successMessage}</p>
          {duplicatedQuote ? (
            <>
              <p className="mt-1 text-muted-foreground">
                O orçamento original não foi alterado.
              </p>
              <Button asChild variant="outline" className="mt-3">
                <a href={`/app/orcamentos/${encodeURIComponent(duplicatedQuote.id)}/editar`}>
                  Editar {duplicatedQuote.number}
                  <ArrowRight aria-hidden="true" weight="light" />
                </a>
              </Button>
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {(transitionCompleted ? [] : allowedActions).map((action) => (
          <Button
            key={action}
            type="button"
            variant={ACTIONS[action].tone === 'destructive' ? 'destructive' : 'outline'}
            onClick={() => openAction(action)}
          >
            {ACTIONS[action].label}
          </Button>
        ))}
        {canDuplicate ? (
          <Button type="button" variant="outline" onClick={() => openAction('duplicateQuote')}>
            <Copy aria-hidden="true" weight="light" />
            Duplicar
          </Button>
        ) : null}
      </div>

      {activeAction && config ? (
        <ConfirmationDialog
          open
          onOpenChange={(open) => {
            if (!open) closeDialog()
          }}
          title={config.title}
          description={
            <span className="space-y-4">
              <span className="block">{config.description}</span>
              {config.reason !== 'none' ? (
                <label className="block text-left font-medium text-foreground">
                  Motivo{config.reason === 'optional' ? ' (opcional)' : ''}
                  <textarea
                    aria-label="Motivo"
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                    rows={3}
                    required={config.reason === 'required'}
                    className="mt-2 flex w-full resize-y rounded-xl border border-input bg-white px-4 py-3 text-[15px] text-ink outline-hidden focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/15"
                  />
                </label>
              ) : null}
            </span>
          }
          confirmLabel={config.confirmLabel}
          confirmDisabled={requiredReasonMissing}
          pendingLabel={config.pendingLabel}
          retryLabel="Tentar novamente"
          tone={config.tone}
          onConfirm={confirmAction}
        />
      ) : null}
    </section>
  )
}
