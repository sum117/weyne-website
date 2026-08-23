import * as React from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Textarea } from '@/components/ui/textarea'
import { hasCapability, type Role } from '@/lib/auth/capabilities'

export type CanonicalPriceListKey = 'PRICE_1' | 'PRICE_2' | 'PRICE_3' | 'PRICE_4'

/**
 * Everything this component shows or hides, derived ONCE from the
 * centralized matrix (card `t_d3e33344`). The three manage/view flags are
 * plain `hasCapability` lookups. `priceValuesVisible` encodes matrix §12/S8,
 * a FIELD-projection rule the boolean catalog deliberately does not express:
 * `read_only` holds `price_list.view` (catalog structure) yet receives the
 * O-projection — no price values. Encoding it here, beside the matrix
 * lookups and nowhere else, keeps the projection out of both the JSX and
 * every future call site. Presentation only; the server re-checks each
 * mutation and projects responses independently.
 */
export type ProductPricingCapabilities = Readonly<{
  canManagePrices: boolean
  canManageCommissionOverride: boolean
  canViewPriceHistory: boolean
  priceValuesVisible: boolean
}>

export function pricingCapabilities(role: Role): ProductPricingCapabilities {
  return {
    canManagePrices: hasCapability(role, 'price_list.manage'),
    canManageCommissionOverride: hasCapability(role, 'commission_rule.manage'),
    canViewPriceHistory: hasCapability(role, 'commission_rule.view'),
    priceValuesVisible: role !== 'read_only',
  }
}

export interface ProductPriceValue {
  priceListId: string
  key: CanonicalPriceListKey
  displayName: string
  amount: string | null
  currencyCode: string
  version: string | null
}

export interface ProductPriceHistoryEntry {
  id: string
  priceListKey: CanonicalPriceListKey
  priceListName: string
  oldAmount: string | null
  newAmount: string
  currencyCode: string
  reason: string
  actor?: string | null
  changedAt?: string | null
}

export interface SaveProductPricesInput {
  reason: string
  changes: ReadonlyArray<{
    priceListId: string
    amount: string
    expectedVersion: string | null
  }>
}

export interface ProductPricingProps {
  /**
   * The signed-in actor's role, resolved from the app session. Kept as a role
   * (not pre-derived booleans) because this component projects THREE
   * independent capabilities from the matrix: price editing
   * (`price_list.manage`), commission override (`commission_rule.manage`,
   * the canonical `product.setCommissionOverride` alias surface) and price
   * history visibility. All lookups go through `hasCapability` — never a raw
   * role comparison. UX only; the server re-checks every mutation.
   */
  role: Role
  prices: readonly ProductPriceValue[]
  commissionOverride: string | null
  industryCommission: string | null
  history: readonly ProductPriceHistoryEntry[]
  onSavePrices: (input: SaveProductPricesInput) => Promise<void> | void
  onSaveCommissionOverride: (value: string | null) => Promise<void> | void
  apiError?: string | null
}

const canonicalKeys: readonly CanonicalPriceListKey[] = [
  'PRICE_1',
  'PRICE_2',
  'PRICE_3',
  'PRICE_4',
]

function validateUnsignedDecimal(
  value: string,
  label: string,
  maxIntegerDigits: number,
): string | null {
  if (!value) return `${label} não pode ficar vazio`
  if (!/^\d+(?:\.\d+)?$/.test(value)) {
    return `${label} deve ser um decimal não negativo usando ponto como separador`
  }
  const [integer, fraction = ''] = value.split('.')
  if (fraction.length > 6) return `${label} deve ter no máximo 6 casas decimais`
  if (integer!.length > maxIntegerDigits) return `${label} excede o limite permitido`
  return null
}

function validatePercentage(value: string): string | null {
  if (!value) return null
  const decimalError = validateUnsignedDecimal(value, 'Comissão', 3)
  if (decimalError) return decimalError

  const [rawInteger, fraction = ''] = value.split('.')
  const integer = rawInteger!.replace(/^0+(?=\d)/, '')
  if (
    integer.length > 3 ||
    (integer.length === 3 && integer > '100') ||
    (integer === '100' && /[1-9]/.test(fraction))
  ) {
    return 'Comissão deve estar entre 0 e 100'
  }
  return null
}

export function ProductPricing({
  role,
  prices,
  commissionOverride,
  industryCommission,
  history,
  onSavePrices,
  onSaveCommissionOverride,
  apiError,
}: ProductPricingProps) {
  const orderedPrices = canonicalKeys.map((key) => {
    const price = prices.find((candidate) => candidate.key === key)
    if (!price) throw new Error(`Missing canonical price list: ${key}`)
    return price
  })
  const [draftPrices, setDraftPrices] = React.useState<Record<string, string>>(
    () => Object.fromEntries(orderedPrices.map((price) => [price.key, price.amount ?? ''])),
  )
  const [reason, setReason] = React.useState('')
  const [commission, setCommission] = React.useState(commissionOverride ?? '')
  const [priceError, setPriceError] = React.useState<string | null>(null)
  const [commissionError, setCommissionError] = React.useState<string | null>(null)
  const [isSavingPrices, setIsSavingPrices] = React.useState(false)
  const [isSavingCommission, setIsSavingCommission] = React.useState(false)
  const capabilities = pricingCapabilities(role)
  const { priceValuesVisible } = capabilities
  const canEdit = capabilities.canManagePrices
  const canSeePriceHistory = capabilities.canViewPriceHistory

  React.useEffect(() => {
    setDraftPrices(
      Object.fromEntries(orderedPrices.map((price) => [price.key, price.amount ?? ''])),
    )
  }, [prices])

  React.useEffect(() => setCommission(commissionOverride ?? ''), [commissionOverride])

  async function savePrices(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const changes = orderedPrices
      .filter((price) => draftPrices[price.key] !== (price.amount ?? ''))
      .map((price) => ({
        priceListId: price.priceListId,
        amount: draftPrices[price.key] ?? '',
        expectedVersion: price.version,
      }))

    if (changes.length === 0) {
      setPriceError('Nenhum preço foi alterado')
      return
    }
    for (const price of orderedPrices) {
      if (!changes.some((change) => change.priceListId === price.priceListId)) continue
      const error = validateUnsignedDecimal(
        draftPrices[price.key] ?? '',
        price.displayName,
        13,
      )
      if (error) {
        setPriceError(error)
        return
      }
    }
    if (!reason.trim()) {
      setPriceError('Informe o motivo da alteração de preço')
      return
    }

    setPriceError(null)
    setIsSavingPrices(true)
    try {
      await onSavePrices({ reason: reason.trim(), changes })
    } catch (error) {
      setPriceError(
        error instanceof Error ? error.message : 'Não foi possível salvar os preços',
      )
    } finally {
      setIsSavingPrices(false)
    }
  }

  async function saveCommission(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const error = validatePercentage(commission)
    if (error) {
      setCommissionError(error)
      return
    }

    setCommissionError(null)
    setIsSavingCommission(true)
    try {
      await onSaveCommissionOverride(commission || null)
    } catch (saveError) {
      setCommissionError(
        saveError instanceof Error
          ? saveError.message
          : 'Não foi possível salvar a comissão',
      )
    } finally {
      setIsSavingCommission(false)
    }
  }

  return (
    <div className="grid gap-6">
      <Card>
        <section aria-label="Preços do produto">
          <CardHeader>
            <CardTitle className="text-lg text-navy">Preços do produto</CardTitle>
            <CardDescription>
              Quatro listas canônicas. Os valores são preservados como decimais exatos.
            </CardDescription>
            {!canEdit && (
              <span className="w-fit rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-muted">
                Somente leitura
              </span>
            )}
          </CardHeader>
          <CardContent>
            {apiError && (
              <Alert variant="destructive" role="alert" className="mb-4">
                <AlertDescription>{apiError}</AlertDescription>
              </Alert>
            )}
            <form className="grid gap-5" onSubmit={savePrices} noValidate>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {orderedPrices.map((price) => {
                  const inputId = `product-price-${price.key.toLowerCase()}`
                  return (
                    <div key={price.key} className="grid gap-2">
                      <label
                        htmlFor={inputId}
                        className="text-sm font-semibold text-ink"
                      >
                        {price.displayName}
                      </label>
                      <div className="relative">
                        <span
                          aria-hidden="true"
                          className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted"
                        >
                          {price.currencyCode}
                        </span>
                        <Input
                          id={inputId}
                          inputMode="decimal"
                          className="pl-12 font-mono tabular-nums"
                          value={priceValuesVisible ? draftPrices[price.key] : ''}
                          placeholder={priceValuesVisible ? 'Sem preço' : 'Restrito'}
                          readOnly={!canEdit}
                          onChange={
                            canEdit
                              ? (event) => {
                                  const value = event.currentTarget.value
                                  setDraftPrices((current) => ({
                                    ...current,
                                    [price.key]: value,
                                  }))
                                }
                              : undefined
                          }
                          aria-describedby={`${inputId}-description`}
                        />
                      </div>
                      <p id={`${inputId}-description`} className="text-xs text-muted">
                        Até 6 casas decimais
                      </p>
                    </div>
                  )
                })}
              </div>

              {canEdit && (
                <>
                  <div className="grid gap-2">
                    <label htmlFor="price-change-reason" className="text-sm font-semibold text-ink">
                      Motivo da alteração
                    </label>
                    <Textarea
                      id="price-change-reason"
                      value={reason}
                      onChange={(event) => setReason(event.currentTarget.value)}
                      aria-required="true"
                      aria-invalid={Boolean(priceError)}
                      placeholder="Ex.: reajuste informado pela indústria"
                    />
                  </div>
                  {priceError && (
                    <Alert variant="destructive" role="alert">
                      <AlertDescription>{priceError}</AlertDescription>
                    </Alert>
                  )}
                  <Button
                    type="submit"
                    variant="primary"
                    size="default"
                    className="w-full sm:w-fit"
                    disabled={isSavingPrices}
                  >
                    {isSavingPrices ? 'Salvando…' : 'Salvar preços'}
                  </Button>
                </>
              )}
            </form>
          </CardContent>
        </section>
      </Card>

      {canEdit && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg text-navy">Comissão do produto</CardTitle>
            <CardDescription>
              O valor próprio prevalece sobre o padrão da indústria. Zero é um override válido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" onSubmit={saveCommission} noValidate>
              <div className="grid gap-2">
                <label htmlFor="product-commission" className="text-sm font-semibold text-ink">
                  Comissão própria do produto
                </label>
                <Input
                  id="product-commission"
                  inputMode="decimal"
                  className="font-mono tabular-nums"
                  value={commission}
                  onChange={(event) => setCommission(event.currentTarget.value)}
                  placeholder="Usar padrão da indústria"
                  aria-describedby="product-commission-description"
                  aria-invalid={Boolean(commissionError)}
                />
                <p id="product-commission-description" className="text-xs text-muted">
                  Padrão da indústria: {industryCommission ?? 'não configurado'}
                  {industryCommission ? '%' : ''}
                </p>
              </div>
              <Button
                type="submit"
                variant="outline"
                size="default"
                className="w-full sm:w-auto"
                disabled={isSavingCommission}
              >
                {isSavingCommission ? 'Salvando…' : 'Salvar comissão'}
              </Button>
              {commissionError && (
                <Alert variant="destructive" role="alert" className="sm:col-span-2">
                  <AlertDescription>{commissionError}</AlertDescription>
                </Alert>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {canSeePriceHistory && (
        <Card>
          <section aria-label="Histórico de preços">
            <CardHeader>
              <CardTitle className="text-lg text-navy">Histórico de preços</CardTitle>
              <CardDescription>
                Registro imutável das alterações. Não há ações de edição ou exclusão.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.length === 0 ? (
                <p className="rounded-lg border border-dashed p-6 text-sm text-muted">
                  Nenhuma alteração de preço registrada.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Lista</TableHead>
                      <TableHead>Valor anterior</TableHead>
                      <TableHead>Novo valor</TableHead>
                      <TableHead>Motivo</TableHead>
                      <TableHead>Ator</TableHead>
                      <TableHead>Data e hora</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((entry) => (
                      <TableRow key={entry.id}>
                        <TableCell className="font-semibold">{entry.priceListName}</TableCell>
                        <TableCell className="font-mono tabular-nums">
                          {entry.oldAmount ?? 'Preço inicial'}
                        </TableCell>
                        <TableCell className="font-mono tabular-nums">{entry.newAmount}</TableCell>
                        <TableCell className="min-w-48 whitespace-normal">{entry.reason}</TableCell>
                        <TableCell>{entry.actor ?? 'Não informado'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          {entry.changedAt ? (
                            <time dateTime={entry.changedAt}>{entry.changedAt}</time>
                          ) : (
                            'Não informado'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </section>
        </Card>
      )}
    </div>
  )
}
