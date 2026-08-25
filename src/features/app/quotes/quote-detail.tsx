import { PencilSimple, WarningCircle } from '@phosphor-icons/react/dist/ssr'
import Decimal from 'decimal.js'
import { useEffect, useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  QuoteConversion,
  type QuoteConversionProps,
} from '@/features/app/quotes/quote-conversion'
import {
  QuoteLifecycleControls,
  QuoteLifecycleHistory,
  QuoteStatusBadge,
  type QuoteLifecycleControlsProps,
  type QuoteLifecycleHistoryEvent,
} from '@/features/app/quotes/quote-lifecycle'
import { cn } from '@/lib/cn'
import { formatDate as formatLocalizedDate } from '@/lib/intl/format'

export interface QuoteDetail {
  readonly id: string
  readonly number: string
  readonly status: {
    readonly code: string
    readonly label: string
  }
  readonly issuedOn: string | null
  readonly validUntil: string | null
  readonly customer: {
    readonly name: string
    readonly document?: string | null
  } | null
  readonly industry: { readonly name: string } | null
  readonly representative: { readonly name: string } | null
  readonly paymentTerms: string | null
  readonly freight: {
    readonly terms: string
    readonly amount?: string | null
  } | null
  readonly transporter: { readonly name: string } | null
  readonly lines: readonly QuoteDetailLine[]
  /** Authoritative decimal amounts returned by the server. */
  readonly totals: {
    readonly grossItems?: string | null
    readonly itemDiscounts?: string | null
    readonly generalDiscount?: string | null
    readonly freight?: string | null
    readonly total: string
  }
  /** Capabilities are evaluated by the server for the current actor. */
  readonly capabilities: { readonly canEdit: boolean }
  readonly partialDataWarnings: readonly string[]
}

export interface QuoteDetailLine {
  readonly id: string
  readonly productCode: string | null
  readonly description: string
  readonly quantity: string
  readonly unit: string
  readonly unitPrice: string
  readonly total: string
}

export type QuoteDetailState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'forbidden' }
  | {
      readonly kind: 'error'
      readonly message: string
      readonly onRetry: () => void
    }
  | { readonly kind: 'ready'; readonly quote: QuoteDetail }

function formatCurrency(value: string) {
  return `R$ ${formatDecimal(value, 2, 2)}`
}

function formatNumber(value: string) {
  return formatDecimal(value, 0, 4)
}

function formatDecimal(value: string, minimumFractionDigits: number, maximumFractionDigits: number) {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return value
  const fixed = new Decimal(value)
    .toDecimalPlaces(maximumFractionDigits, Decimal.ROUND_HALF_UP)
    .toFixed(maximumFractionDigits)
  const [integer = '0', rawFraction = ''] = fixed.split('.')
  const groupedInteger = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fraction = rawFraction
    .replace(/0+$/, '')
    .padEnd(minimumFractionDigits, '0')
  return fraction ? `${groupedInteger},${fraction}` : groupedInteger
}

function formatDate(value: string | null) {
  if (!value) return 'Não informado'

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return value

  return formatLocalizedDate(
    new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))),
    { timeZone: 'UTC' },
  )
}


function DefinitionItem({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </dt>
      <dd className="mt-1 text-sm font-medium break-words text-foreground">{children}</dd>
    </div>
  )
}

function EmptyValue() {
  return <span className="font-normal text-muted-foreground">Não informado</span>
}

function StateMessage({
  title,
  description,
  forbidden = false,
}: {
  title: string
  description: string
  forbidden?: boolean
}) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <section className="mx-auto max-w-2xl rounded-xl border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-sm font-semibold tracking-[0.12em] text-blue uppercase">
          Orçamentos
        </p>
        <h1 className="mt-3 font-display text-3xl text-navy">{title}</h1>
        <p className="mt-3 text-muted-foreground">{description}</p>
        <a
          href="/app/orcamentos"
          className="mt-6 inline-flex min-h-11 items-center font-semibold text-blue underline underline-offset-4 focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          aria-label={forbidden ? 'Voltar para orçamentos' : undefined}
        >
          Voltar para orçamentos
        </a>
      </section>
    </main>
  )
}

function QuoteDetailLoading() {
  return (
    <main
      className="min-h-screen bg-background px-4 py-8 sm:px-6"
      aria-busy="true"
      aria-label="Carregando orçamento"
    >
      <div className="mx-auto max-w-7xl" role="status">
        <span className="sr-only">Carregando orçamento</span>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-10 w-64 max-w-full" />
          </div>
          <Skeleton className="h-11 w-40" />
        </div>
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="space-y-6">
            <Skeleton className="h-64 w-full rounded-xl" />
            <Skeleton className="h-72 w-full rounded-xl" />
          </div>
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      </div>
    </main>
  )
}

function QuoteError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:px-6">
      <Alert variant="destructive" role="alert" className="mx-auto max-w-2xl">
        <WarningCircle aria-hidden="true" />
        <AlertTitle>Não foi possível carregar o orçamento</AlertTitle>
        <AlertDescription>
          <p>{message}</p>
          <Button
            type="button"
            variant="outline"
            size="default"
            className="mt-4"
            onClick={onRetry}
          >
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    </main>
  )
}

function QuoteLines({ lines }: { lines: readonly QuoteDetailLine[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display text-2xl text-navy">
          Itens do orçamento
        </CardTitle>
      </CardHeader>
      <CardContent>
        {lines.length === 0 ? (
          <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
            Nenhum item informado.
          </p>
        ) : (
          <ul className="divide-y divide-table-divider" aria-label="Itens do orçamento">
            {lines.map((line) => (
              <li
                key={line.id}
                data-testid={`quote-line-${line.id}`}
                className="grid grid-cols-1 gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-6"
              >
                <div className="min-w-0">
                  <p className="font-semibold break-words text-foreground">
                    {line.description}
                  </p>
                  <p className="mt-1 text-xs break-all text-muted-foreground">
                    {line.productCode ? `Código ${line.productCode} · ` : null}
                    Unitário {formatCurrency(line.unitPrice)}
                  </p>
                </div>
                <p className="text-sm whitespace-nowrap text-muted-foreground">
                  <span className="sm:sr-only">Quantidade: </span>
                  {formatNumber(line.quantity)} {line.unit}
                </p>
                <p className="font-semibold whitespace-nowrap text-foreground sm:text-right">
                  <span className="sr-only">Total do item: </span>
                  {formatCurrency(line.total)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function TotalRow({
  label,
  value,
  emphasized = false,
}: {
  label: string
  value: string | null | undefined
  emphasized?: boolean
}) {
  if (value == null) return null

  return (
    <div
      className={cn(
        'flex items-baseline justify-between gap-4 text-sm',
        emphasized && 'border-t border-table-divider pt-4 text-base font-bold text-navy',
      )}
    >
      <dt>{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{formatCurrency(value)}</dd>
    </div>
  )
}

function QuoteTotals({ quote }: { quote: QuoteDetail }) {
  return (
    <aside className="lg:sticky lg:top-6 lg:self-start" aria-label="Resumo de valores">
      <Card className="gap-4 border-blue/20 shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-2xl text-navy">Resumo de valores</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="space-y-3">
            <TotalRow label="Itens brutos" value={quote.totals.grossItems} />
            <TotalRow label="Descontos nos itens" value={quote.totals.itemDiscounts} />
            <TotalRow label="Desconto geral" value={quote.totals.generalDiscount} />
            <TotalRow label="Frete" value={quote.totals.freight} />
            <TotalRow label="Total do orçamento" value={quote.totals.total} emphasized />
          </dl>
          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            Valores consolidados pelo servidor.
          </p>
        </CardContent>
      </Card>
    </aside>
  )
}

function ReadyQuoteDetail({
  quote,
  conversion,
  lifecycle,
}: {
  quote: QuoteDetail
  conversion?: QuoteConversionProps
  lifecycle?: QuoteDetailLifecycleProps
}) {
  const [currentStatus, setCurrentStatus] = useState(quote.status)
  const [history, setHistory] = useState<readonly QuoteLifecycleHistoryEvent[]>(
    lifecycle?.history ?? [],
  )

  useEffect(() => {
    setCurrentStatus(quote.status)
    setHistory(lifecycle?.history ?? [])
  }, [lifecycle?.history, quote.status])

  return (
    <main className="min-h-screen bg-background px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <a
              href="/app/orcamentos"
              className="inline-flex min-h-11 items-center text-sm font-semibold text-blue underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              Orçamentos
            </a>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="font-display text-3xl leading-tight break-all text-navy sm:text-4xl">
                {quote.number}
              </h1>
              <QuoteStatusBadge status={currentStatus} />
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              Emitido em{' '}
              {quote.issuedOn ? (
                <time dateTime={quote.issuedOn}>{formatDate(quote.issuedOn)}</time>
              ) : (
                <EmptyValue />
              )}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            {conversion ? <QuoteConversion {...conversion} /> : null}
            {lifecycle ? (
              <QuoteLifecycleControls
                {...lifecycle}
                quote={{ id: quote.id, status: currentStatus, version: lifecycle.version }}
                onReconciled={async (updated, event) => {
                  setCurrentStatus(updated.status)
                  setHistory((current) => [...current, event])
                  await lifecycle.onReconciled?.(updated, event)
                }}
              />
            ) : null}
            {quote.capabilities.canEdit ? (
              <Button asChild variant="primary" size="default">
                <a href={`/app/orcamentos/${encodeURIComponent(quote.id)}/editar`}>
                  <PencilSimple aria-hidden="true" weight="light" />
                  Editar orçamento
                </a>
              </Button>
            ) : null}
          </div>
        </header>

        {quote.partialDataWarnings.length > 0 ? (
          <Alert variant="warning" className="mt-6">
            <WarningCircle aria-hidden="true" weight="light" />
            <AlertTitle>Algumas informações estão indisponíveis</AlertTitle>
            <AlertDescription>
              <ul className="list-disc space-y-1 pl-4">
                {quote.partialDataWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        ) : null}

        <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="font-display text-2xl text-navy">
                  Informações comerciais
                </CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3">
                  <DefinitionItem label="Cliente">
                    {quote.customer ? (
                      <>
                        {quote.customer.name}
                        {quote.customer.document ? (
                          <span className="mt-1 block font-normal text-muted-foreground">
                            {quote.customer.document}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <EmptyValue />
                    )}
                  </DefinitionItem>
                  <DefinitionItem label="Indústria">
                    {quote.industry?.name ?? <EmptyValue />}
                  </DefinitionItem>
                  <DefinitionItem label="Representante">
                    {quote.representative?.name ?? <EmptyValue />}
                  </DefinitionItem>
                  <DefinitionItem label="Pagamento">
                    {quote.paymentTerms ?? <EmptyValue />}
                  </DefinitionItem>
                  <DefinitionItem label="Frete">
                    {quote.freight ? (
                      <>
                        {quote.freight.terms}
                        {quote.freight.amount != null ? (
                          <span className="mt-1 block font-normal text-muted-foreground">
                            {formatCurrency(quote.freight.amount)}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <EmptyValue />
                    )}
                  </DefinitionItem>
                  <DefinitionItem label="Transportadora">
                    {quote.transporter?.name ?? <EmptyValue />}
                  </DefinitionItem>
                  <DefinitionItem label="Validade">
                    {formatDate(quote.validUntil)}
                  </DefinitionItem>
                </dl>
              </CardContent>
            </Card>

            <QuoteLines lines={quote.lines} />
            {lifecycle ? <QuoteLifecycleHistory events={history} /> : null}
          </div>
          <QuoteTotals quote={quote} />
        </div>
      </div>
    </main>
  )
}

export function QuoteDetailView({
  state,
  conversion,
  lifecycle,
}: {
  state: QuoteDetailState
  conversion?: QuoteConversionProps
  lifecycle?: QuoteDetailLifecycleProps
}) {
  switch (state.kind) {
    case 'loading':
      return <QuoteDetailLoading />
    case 'not-found':
      return (
        <StateMessage
          title="Orçamento não encontrado"
          description="O documento pode ter sido removido ou o endereço está incorreto."
        />
      )
    case 'forbidden':
      return (
        <StateMessage
          title="Acesso não permitido"
          description="Seu perfil não tem permissão para consultar este orçamento."
          forbidden
        />
      )
    case 'error':
      return <QuoteError message={state.message} onRetry={state.onRetry} />
    case 'ready':
      return (
        <ReadyQuoteDetail
          quote={state.quote}
          conversion={conversion}
          lifecycle={lifecycle}
        />
      )
  }
}

export interface QuoteDetailLifecycleProps
  extends Omit<QuoteLifecycleControlsProps, 'quote'> {
  readonly version: string
  readonly history: readonly QuoteLifecycleHistoryEvent[]
}
