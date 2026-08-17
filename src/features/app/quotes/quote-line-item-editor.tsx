import * as React from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowsClockwise,
  ImageSquare,
  Trash,
  WarningCircle,
} from '@phosphor-icons/react/dist/ssr'
import Decimal from 'decimal.js'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  QuoteDataError,
  type QuoteLineWithCurrentSource,
  type QuotePricingModel,
  type QuoteRecalculationInput,
  type QuoteRecalculationResult,
} from '@/features/app/quotes/quote-data'

const DECIMAL_PATTERN = /^\d+(?:\.\d+)?$/
const MONEY_SCALE = 2

interface DraftTax {
  readonly code: string
  rate: string
}

interface DraftLine {
  readonly source: QuoteLineWithCurrentSource
  readonly lineId: string
  quantity: string
  unitPrice: string
  discountRate: string
  taxes: DraftTax[]
}

interface PublishedTotals {
  readonly subtotalAmount: string
  readonly discountAmount: string
  readonly taxAmount: string
  readonly freightAmount: string
  readonly grandTotalAmount: string
}

export interface QuoteLineItemEditorProps {
  readonly model: QuotePricingModel
  readonly authoritativeTotals: PublishedTotals
  readonly generalDiscountRate: string
  readonly freightAmount: string
  readonly availability?: 'ready' | 'loading' | 'error'
  readonly errorMessage?: string
  readonly onRetryLoad?: () => void
  readonly onRecalculate: (
    input: QuoteRecalculationInput,
  ) => Promise<QuoteRecalculationResult>
  readonly onUpdateSourcePrice: (lineId: string) => void
  readonly onReloadConflict?: () => void
  readonly onDraftChange?: (input: QuoteRecalculationInput) => void
}

type FieldName = 'quantity' | 'unitPrice' | 'discountRate'
type ValidationErrors = Readonly<Record<string, string>>

function toDraftLine(source: QuoteLineWithCurrentSource): DraftLine {
  return {
    source,
    lineId: source.saved.lineId,
    quantity: source.saved.quantitySnapshot,
    unitPrice: source.saved.unitPriceSnapshot,
    discountRate: source.saved.discountRateSnapshot,
    taxes: source.saved.taxSnapshots.map((tax) => ({ ...tax })),
  }
}

function money(value: Decimal) {
  return value.toDecimalPlaces(MONEY_SCALE, Decimal.ROUND_HALF_UP)
}

function percentageOf(value: Decimal, rate: Decimal) {
  return money(value.times(rate).dividedBy(100))
}

function parseDecimal(value: string) {
  if (!DECIMAL_PATTERN.test(value)) return null
  try {
    return new Decimal(value)
  } catch {
    return null
  }
}

function formatDecimal(value: string, minimumFractionDigits = 2) {
  const decimal = parseDecimal(value)
  if (decimal === null) return value
  const fixed = decimal.toFixed(6).replace(/0+$/, '').replace(/\.$/, '')
  const [integer = '0', rawFraction = ''] = fixed.split('.')
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const fraction = rawFraction.padEnd(minimumFractionDigits, '0')
  return fraction ? `${grouped},${fraction}` : grouped
}

function formatCurrency(value: string) {
  return `R$ ${formatDecimal(value)}`
}

function validateDraft(
  lines: readonly DraftLine[],
  generalDiscountRate: string,
  freightAmount: string,
): ValidationErrors {
  const errors: Record<string, string> = {}
  const validate = (
    key: string,
    value: string,
    options: { positive?: boolean; percentage?: boolean } = {},
  ) => {
    const decimal = parseDecimal(value)
    if (decimal === null) {
      errors[key] = 'Informe um número decimal válido usando ponto como separador.'
      return
    }
    if (options.positive && !decimal.gt(0)) {
      errors[key] = 'Informe um valor maior que zero.'
    }
    if (options.percentage && (decimal.lt(0) || decimal.gt(100))) {
      errors[key] = 'Informe uma porcentagem entre 0 e 100.'
    }
  }

  lines.forEach((line) => {
    validate(`${line.lineId}.quantity`, line.quantity, { positive: true })
    validate(`${line.lineId}.unitPrice`, line.unitPrice)
    validate(`${line.lineId}.discountRate`, line.discountRate, { percentage: true })
    line.taxes.forEach((tax) => {
      validate(`${line.lineId}.tax.${tax.code}`, tax.rate, { percentage: true })
    })
  })
  validate('generalDiscountRate', generalDiscountRate, { percentage: true })
  validate('freightAmount', freightAmount)
  return errors
}

function buildInput(
  model: QuotePricingModel,
  lines: readonly DraftLine[],
  generalDiscountRate: string,
  freightAmount: string,
): QuoteRecalculationInput {
  return {
    quoteId: model.quoteId,
    expectedVersion: model.version,
    selectedPriceListId: model.selectedPriceList.id,
    generalDiscountRate,
    freightAmount,
    lines: lines.map((line) => ({
      lineId: line.lineId,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountRate: line.discountRate,
      taxes: line.taxes.map((tax) => ({ code: tax.code, rate: tax.rate })),
    })),
  }
}

function calculatePreview(
  lines: readonly DraftLine[],
  generalDiscountRate: string,
  freightAmount: string,
): PublishedTotals | null {
  if (Object.keys(validateDraft(lines, generalDiscountRate, freightAmount)).length > 0) {
    return null
  }

  let subtotal = new Decimal(0)
  let itemDiscount = new Decimal(0)
  let tax = new Decimal(0)
  for (const line of lines) {
    const gross = money(new Decimal(line.quantity).times(line.unitPrice))
    const discount = percentageOf(gross, new Decimal(line.discountRate))
    const net = gross.minus(discount)
    subtotal = subtotal.plus(gross)
    itemDiscount = itemDiscount.plus(discount)
    tax = tax.plus(
      line.taxes.reduce(
        (sum, configuredTax) =>
          sum.plus(percentageOf(net, new Decimal(configuredTax.rate))),
        new Decimal(0),
      ),
    )
  }

  const netItems = money(subtotal.minus(itemDiscount))
  const generalDiscount = percentageOf(netItems, new Decimal(generalDiscountRate))
  const totalDiscount = money(itemDiscount.plus(generalDiscount))
  const freight = money(new Decimal(freightAmount))
  return {
    subtotalAmount: money(subtotal).toFixed(2),
    discountAmount: totalDiscount.toFixed(2),
    taxAmount: money(tax).toFixed(2),
    freightAmount: freight.toFixed(2),
    grandTotalAmount: money(netItems.minus(generalDiscount).plus(freight)).toFixed(2),
  }
}

function TotalsCard({
  label,
  totals,
  preview = false,
}: {
  label: string
  totals: PublishedTotals | null
  preview?: boolean
}) {
  return (
    <Card aria-label={label} className={preview ? 'border-dashed' : 'border-blue/20'}>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="font-display text-xl text-navy">{label}</CardTitle>
          {preview ? <Badge variant="neutral">Não oficial</Badge> : <Badge variant="success">Servidor</Badge>}
        </div>
      </CardHeader>
      <CardContent>
        {totals === null ? (
          <p className="text-sm text-muted-foreground">
            Corrija os campos inválidos para atualizar a prévia.
          </p>
        ) : (
          <dl className="space-y-2 text-sm">
            <TotalRow label="Subtotal" value={totals.subtotalAmount} />
            <TotalRow label="Descontos" value={totals.discountAmount} />
            <TotalRow label="Impostos aplicáveis" value={totals.taxAmount} />
            <TotalRow label="Frete" value={totals.freightAmount} />
            <TotalRow label="Total" value={totals.grandTotalAmount} emphasized />
          </dl>
        )}
      </CardContent>
    </Card>
  )
}

function TotalRow({ label, value, emphasized = false }: { label: string; value: string; emphasized?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${emphasized ? 'border-t pt-3 font-bold text-navy' : ''}`}>
      <dt>{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{formatCurrency(value)}</dd>
    </div>
  )
}

export function QuoteLineItemEditor({
  model,
  authoritativeTotals,
  generalDiscountRate,
  freightAmount,
  availability = 'ready',
  errorMessage = 'Não foi possível carregar os itens do orçamento.',
  onRetryLoad,
  onRecalculate,
  onUpdateSourcePrice,
  onReloadConflict,
  onDraftChange,
}: QuoteLineItemEditorProps) {
  const [lines, setLines] = React.useState<DraftLine[]>(() => model.lines.map(toDraftLine))
  const removedLineIds = React.useRef(new Set<string>())
  const [errors, setErrors] = React.useState<ValidationErrors>({})
  const [announcement, setAnnouncement] = React.useState('')
  const [submitState, setSubmitState] = React.useState<
    | { status: 'idle' | 'loading' | 'success' }
    | { status: 'error'; message: string }
    | { status: 'conflict'; message: string }
  >({ status: 'idle' })

  const preview = React.useMemo(
    () => calculatePreview(lines, generalDiscountRate, freightAmount),
    [freightAmount, generalDiscountRate, lines],
  )

  React.useEffect(() => {
    setLines((current) => {
      const currentIds = new Set(current.map((line) => line.lineId))
      const sourceById = new Map(model.lines.map((line) => [line.saved.lineId, line]))
      const retained = current
        .filter((line) => sourceById.has(line.lineId))
        .map((line) => ({ ...line, source: sourceById.get(line.lineId)! }))
      const added = model.lines
        .filter(
          (line) =>
            !currentIds.has(line.saved.lineId) &&
            !removedLineIds.current.has(line.saved.lineId),
        )
        .map(toDraftLine)
      return added.length === 0 ? retained : [...retained, ...added]
    })
  }, [model.lines])

  const emitDraft = React.useCallback(
    (nextLines: readonly DraftLine[]) => {
      onDraftChange?.(buildInput(model, nextLines, generalDiscountRate, freightAmount))
    },
    [freightAmount, generalDiscountRate, model, onDraftChange],
  )

  const updateField = (lineId: string, field: FieldName, value: string) => {
    setLines((current) => {
      const next = current.map((line) =>
        line.lineId === lineId ? { ...line, [field]: value } : line,
      )
      emitDraft(next)
      return next
    })
    setErrors((current) => {
      const next = { ...current }
      delete next[`${lineId}.${field}`]
      return next
    })
  }

  const updateTax = (lineId: string, taxCode: string, value: string) => {
    setLines((current) => {
      const next = current.map((line) =>
        line.lineId === lineId
          ? {
              ...line,
              taxes: line.taxes.map((tax) =>
                tax.code === taxCode ? { ...tax, rate: value } : tax,
              ),
            }
          : line,
      )
      emitDraft(next)
      return next
    })
  }

  const move = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= lines.length) return
    setLines((current) => {
      const next = [...current]
      const [line] = next.splice(index, 1)
      if (!line) return current
      next.splice(target, 0, line)
      emitDraft(next)
      setAnnouncement(
        `${line.source.saved.descriptionSnapshot} movido para a posição ${target + 1}.`,
      )
      return next
    })
  }

  const remove = (lineId: string) => {
    removedLineIds.current.add(lineId)
    setLines((current) => {
      const removed = current.find((line) => line.lineId === lineId)
      const next = current.filter((line) => line.lineId !== lineId)
      emitDraft(next)
      if (removed) setAnnouncement(`${removed.source.saved.descriptionSnapshot} removido.`)
      return next
    })
  }

  const submit = async () => {
    const validation = validateDraft(lines, generalDiscountRate, freightAmount)
    setErrors(validation)
    if (Object.keys(validation).length > 0) {
      return
    }

    setSubmitState({ status: 'loading' })
    try {
      await onRecalculate(buildInput(model, lines, generalDiscountRate, freightAmount))
      setSubmitState({ status: 'success' })
      setAnnouncement('Valores oficiais recalculados pelo servidor.')
    } catch (error) {
      if (error instanceof QuoteDataError && error.code === 'CONFLICT') {
        setSubmitState({ status: 'conflict', message: error.message })
        return
      }
      setSubmitState({
        status: 'error',
        message: error instanceof Error ? error.message : 'Falha ao recalcular o orçamento.',
      })
    }
  }

  if (availability === 'loading') {
    return (
      <section aria-busy="true" aria-label="Carregando editor de itens" className="space-y-4">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </section>
    )
  }

  if (availability === 'error') {
    return (
      <Alert variant="destructive" role="alert">
        <WarningCircle aria-hidden="true" />
        <AlertTitle>Não foi possível carregar os itens</AlertTitle>
        <AlertDescription>
          <p>{errorMessage}</p>
          {onRetryLoad ? (
            <Button type="button" variant="outline" size="default" className="mt-3" onClick={onRetryLoad}>
              Tentar novamente
            </Button>
          ) : null}
        </AlertDescription>
      </Alert>
    )
  }

  return (
    <section className="space-y-6" aria-label="Editor de itens do orçamento">
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {submitState.status === 'error' ? (
        <Alert variant="destructive" role="alert">
          <WarningCircle aria-hidden="true" />
          <AlertTitle>Não foi possível recalcular</AlertTitle>
          <AlertDescription>{submitState.message}</AlertDescription>
        </Alert>
      ) : null}
      {submitState.status === 'conflict' ? (
        <Alert variant="warning" role="alert">
          <WarningCircle aria-hidden="true" />
          <AlertTitle>Este orçamento mudou no servidor</AlertTitle>
          <AlertDescription>
            <p>{submitState.message} Suas edições continuam preservadas nesta tela.</p>
            <Button type="button" variant="outline" size="default" className="mt-3" onClick={onReloadConflict}>
              Recarregar e reconciliar
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <div>
        <h2 className="font-display text-2xl text-navy">Itens do orçamento</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Lista {model.selectedPriceList.displayName}. Os valores salvos só mudam por ação explícita.
        </p>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <p className="font-semibold text-foreground">O orçamento ainda não tem itens.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Adicione um produto do catálogo para começar a composição.
          </p>
        </div>
      ) : (
        <ol className="space-y-4" aria-label="Itens editáveis">
          {lines.map((line, index) => {
            const saved = line.source.saved
            const currentPrice = line.source.current?.price
            return (
              <li key={line.lineId} data-testid={`quote-editor-line-${line.lineId}`}>
                <Card>
                  <CardContent className="space-y-5">
                    <div className="flex min-w-0 flex-col gap-4 sm:flex-row">
                      <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                        {line.source.current?.thumbnailUrl ? (
                          <img
                            src={line.source.current.thumbnailUrl}
                            alt={saved.descriptionSnapshot}
                            className="size-full object-cover"
                          />
                        ) : (
                          <ImageSquare aria-hidden="true" className="size-8 text-muted-foreground" weight="light" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold break-words text-foreground">
                          {saved.descriptionSnapshot}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Unidade salva: {saved.unitSnapshot} · Preço salvo {formatCurrency(saved.unitPriceSnapshot)}
                        </p>
                        {line.source.sourceStatus === 'changed' && currentPrice ? (
                          <Alert variant="warning" role="note" className="mt-3">
                            <WarningCircle aria-hidden="true" />
                            <AlertTitle>Preço de origem alterado</AlertTitle>
                            <AlertDescription>
                              <p>Preço atual {formatCurrency(currentPrice.amount)}. O preço salvo foi mantido.</p>
                              <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="mt-2"
                                onClick={() => onUpdateSourcePrice(line.lineId)}
                              >
                                <ArrowsClockwise aria-hidden="true" weight="light" />
                                Atualizar para o preço atual
                              </Button>
                            </AlertDescription>
                          </Alert>
                        ) : line.source.sourceStatus === 'unavailable' ? (
                          <p className="mt-2 text-sm text-muted-foreground">
                            Fonte atual indisponível; o snapshot salvo permanece editável.
                          </p>
                        ) : null}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                      <DecimalField
                        label={`Quantidade de ${saved.descriptionSnapshot}`}
                        value={line.quantity}
                        error={errors[`${line.lineId}.quantity`]}
                        onChange={(value) => updateField(line.lineId, 'quantity', value)}
                      />
                      <DecimalField
                        label={`Preço unitário de ${saved.descriptionSnapshot}`}
                        value={line.unitPrice}
                        error={errors[`${line.lineId}.unitPrice`]}
                        onChange={(value) => updateField(line.lineId, 'unitPrice', value)}
                      />
                      <DecimalField
                        label={`Desconto percentual de ${saved.descriptionSnapshot}`}
                        value={line.discountRate}
                        error={errors[`${line.lineId}.discountRate`]}
                        onChange={(value) => updateField(line.lineId, 'discountRate', value)}
                      />
                      {line.taxes.map((tax) => (
                        <DecimalField
                          key={tax.code}
                          label={`${tax.code} percentual de ${saved.descriptionSnapshot}`}
                          value={tax.rate}
                          error={errors[`${line.lineId}.tax.${tax.code}`]}
                          onChange={(value) => updateTax(line.lineId, tax.code, value)}
                        />
                      ))}
                    </div>

                    <div className="flex flex-wrap gap-2 border-t pt-4">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Mover ${saved.descriptionSnapshot} para cima`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}
                      >
                        <ArrowUp aria-hidden="true" weight="light" />
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        aria-label={`Mover ${saved.descriptionSnapshot} para baixo`}
                        disabled={index === lines.length - 1}
                        onClick={() => move(index, 1)}
                      >
                        <ArrowDown aria-hidden="true" weight="light" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="lg"
                        aria-label={`Remover ${saved.descriptionSnapshot}`}
                        onClick={() => remove(line.lineId)}
                      >
                        <Trash aria-hidden="true" weight="light" />
                        Remover
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </li>
            )
          })}
        </ol>
      )}

      <p className="text-sm text-muted-foreground">
        A prévia local ajuda durante a edição; somente o recálculo do servidor publica arredondamentos e totais oficiais.
      </p>
      <div className="grid gap-4 lg:grid-cols-2">
        <TotalsCard label="Prévia de valores" totals={preview} preview />
        <TotalsCard label="Valores oficiais do servidor" totals={authoritativeTotals} />
      </div>
      <Button
        type="button"
        variant="primary"
        size="lg"
        disabled={submitState.status === 'loading' || lines.length === 0}
        onClick={() => void submit()}
      >
        <ArrowsClockwise aria-hidden="true" weight="light" />
        {submitState.status === 'loading' ? 'Recalculando…' : 'Recalcular no servidor'}
      </Button>
    </section>
  )
}

function DecimalField({
  label,
  value,
  error,
  onChange,
}: {
  label: string
  value: string
  error?: string
  onChange: (value: string) => void
}) {
  const id = React.useId()
  const errorId = `${id}-error`
  return (
    <label htmlFor={id} className="space-y-1.5 text-sm font-medium text-foreground">
      <span>{label}</span>
      <Input
        id={id}
        type="text"
        inputMode="decimal"
        value={value}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
      {error ? (
        <span id={errorId} role="alert" className="block text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </label>
  )
}
