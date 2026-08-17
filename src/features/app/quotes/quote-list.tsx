import { useEffect, useState } from 'react'
import {
  QuoteLifecycleControls,
  QuoteStatusBadge,
  type QuoteDuplicationMutationResult,
  type QuoteLifecycleCommandRequest,
  type QuoteLifecycleMutationResult,
} from './quote-lifecycle'
import type { QuoteLifecycleSummary } from './quote-lifecycle-data'

export interface QuoteListItem extends QuoteLifecycleSummary {
  readonly number: string
  readonly customerName: string
  readonly allowedActions: QuoteLifecycleControlsProps['allowedActions']
  readonly canDuplicate: boolean
}

type QuoteLifecycleControlsProps = Parameters<typeof QuoteLifecycleControls>[0]

export interface QuoteListViewProps {
  readonly quotes: readonly QuoteListItem[]
  readonly onTransition: (
    request: QuoteLifecycleCommandRequest,
  ) => Promise<QuoteLifecycleMutationResult>
  readonly onDuplicate: (
    request: { readonly sourceQuoteId: string; readonly idempotencyKey: string },
  ) => Promise<QuoteDuplicationMutationResult>
  readonly onReconciled?: (quote: QuoteLifecycleSummary) => void | Promise<void>
  readonly createIdempotencyKey?: () => string
}

export function QuoteListView({
  quotes,
  onTransition,
  onDuplicate,
  onReconciled,
  createIdempotencyKey,
}: QuoteListViewProps) {
  const [rows, setRows] = useState(quotes)

  useEffect(() => {
    setRows(quotes)
  }, [quotes])

  if (rows.length === 0) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
        Nenhum orçamento encontrado.
      </p>
    )
  }

  return (
    <section aria-label="Lista de orçamentos" className="space-y-4">
      {rows.map((quote) => (
        <article
          key={quote.id}
          data-testid={`quote-row-${quote.id}`}
          className="grid gap-4 rounded-xl border bg-card p-5 shadow-sm lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center"
        >
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <a
                href={`/app/orcamentos/${encodeURIComponent(quote.id)}`}
                aria-label={`Abrir ${quote.number}`}
                className="font-display text-xl font-semibold break-all text-navy underline-offset-4 hover:underline"
              >
                {quote.number}
              </a>
              <QuoteStatusBadge status={quote.status} />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{quote.customerName}</p>
          </div>
          <QuoteLifecycleControls
            quote={quote}
            allowedActions={quote.allowedActions}
            canDuplicate={quote.canDuplicate}
            onTransition={onTransition}
            onDuplicate={onDuplicate}
            createIdempotencyKey={createIdempotencyKey}
            onReconciled={async (updated) => {
              setRows((current) => current.map((row) =>
                row.id === updated.id ? { ...row, ...updated, allowedActions: [] } : row,
              ))
              await onReconciled?.(updated)
            }}
          />
        </article>
      ))}
    </section>
  )
}
