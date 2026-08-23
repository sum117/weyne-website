import { Archive, ArrowCounterClockwise, PencilSimple } from '@phosphor-icons/react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ProductFields } from './catalog.service.server'

export type ProductDetailRecord = ProductFields & Readonly<{
  id: string
  industry: string
  effectiveCommission: Readonly<{ rate: string; source: 'product' | 'fallback' }>
  isActive: boolean
  archivedAt: string | null
  createdAt: string
  createdBy: string
  updatedAt: string
  updatedBy: string
}>

export interface ProductDetailProps {
  product: ProductDetailRecord
  /**
   * Capability-driven visibility (card `t_d3e33344`): derived by the caller
   * from the centralized matrix (`product.update_operational`), never from a
   * raw role comparison. UX only — the server re-checks every mutation.
   */
  canManage: boolean
  onEdit?: (id: string) => void
  onArchiveStateChange?: (id: string, archived: boolean) => void | Promise<void>
}

function shown(value: string | null) {
  return value ?? '—'
}

function withUnit(value: string | null, unit: string) {
  return value === null ? '—' : `${value} ${unit}`
}

function percentage(value: string | null) {
  return value === null ? '—' : `${value}%`
}

function dimensions(product: ProductDetailRecord) {
  const values = [product.width, product.height, product.depth]
  if (values.every((value) => value === null)) return '—'
  const rendered = values.map((value) => value ?? '—').join(' × ')
  return product.dimensionUnit ? `${rendered} ${product.dimensionUnit}` : rendered
}

type DetailItem = Readonly<{ label: string; value: string }>

function DetailSection({ title, items }: { title: string; items: readonly DetailItem[] }) {
  return (
    <Card>
      <CardHeader><CardTitle className="text-lg text-navy">{title}</CardTitle></CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="min-w-0">
              <dt className="text-sm font-medium text-muted-foreground">{item.label}</dt>
              <dd className="mt-1 text-sm break-words text-foreground">{item.value}</dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

export function ProductDetail({ product, canManage, onEdit, onArchiveStateChange }: ProductDetailProps) {
  const archived = !product.isActive

  function edit() {
    if (!canManage || archived) return
    onEdit?.(product.id)
  }

  function changeArchiveState() {
    if (!canManage) return
    void onArchiveStateChange?.(product.id, !archived)
  }

  return (
    <section aria-labelledby="product-detail-title" className="mx-auto grid w-full max-w-[75rem] gap-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="text-xs font-semibold tracking-[0.16em] text-blue uppercase">Produto</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 id="product-detail-title" className="font-display text-2xl leading-[1.15] break-words text-navy sm:text-3xl">
              {product.description}
            </h1>
            <Badge variant={archived ? 'neutral' : 'success'}>{archived ? 'Arquivado' : 'Ativo'}</Badge>
          </div>
          <p className="mt-2 font-mono text-sm text-muted-foreground">{product.internalCode}</p>
        </div>
        {canManage ? (
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            {!archived ? (
              <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={edit} disabled={!onEdit}>
                <PencilSimple aria-hidden="true" weight="light" />Editar produto
              </Button>
            ) : null}
            <Button type="button" variant="secondary" className="min-h-11 w-full sm:w-auto" onClick={changeArchiveState} disabled={!onArchiveStateChange}>
              {archived ? <ArrowCounterClockwise aria-hidden="true" weight="light" /> : <Archive aria-hidden="true" weight="light" />}
              {archived ? 'Restaurar produto' : 'Arquivar produto'}
            </Button>
          </div>
        ) : null}
      </header>

      {archived ? (
        <Alert role="status">
          <AlertTitle>Registro histórico</AlertTitle>
          <AlertDescription>Este produto está arquivado e permanece disponível somente para consulta até ser restaurado.</AlertDescription>
        </Alert>
      ) : null}

      <div data-testid="product-detail-sections" className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <DetailSection title="Identificação e classificação" items={[
          { label: 'Indústria', value: product.industry },
          { label: 'Código interno', value: product.internalCode },
          { label: 'Código do fabricante', value: shown(product.manufacturerCode) },
          { label: 'Categoria', value: shown(product.category) },
          { label: 'Marca', value: shown(product.brand) },
          { label: 'Embalagem', value: shown(product.packaging) },
          { label: 'Unidade', value: product.unit },
        ]} />
        <DetailSection title="Identificadores fiscais e logísticos" items={[
          { label: 'NCM', value: shown(product.ncm) },
          { label: 'CEST', value: shown(product.cest) },
          { label: 'EAN', value: shown(product.ean) },
          { label: 'DUN', value: shown(product.dun) },
        ]} />
        <DetailSection title="Pesos e dimensões" items={[
          { label: 'Peso líquido', value: withUnit(product.netWeight, 'kg') },
          { label: 'Peso bruto', value: withUnit(product.grossWeight, 'kg') },
          { label: 'Largura × altura × profundidade', value: dimensions(product) },
        ]} />
        <DetailSection title="Tributos e comissão" items={[
          { label: 'IPI', value: percentage(product.ipiRate) },
          { label: 'ICMS', value: percentage(product.icmsRate) },
          { label: 'PIS', value: percentage(product.pisRate) },
          { label: 'COFINS', value: percentage(product.cofinsRate) },
          { label: 'Comissão efetiva', value: percentage(product.effectiveCommission.rate) },
          { label: 'Origem da comissão', value: product.effectiveCommission.source === 'product' ? 'Própria do produto' : 'Padrão da indústria' },
        ]} />
        <DetailSection title="Auditoria" items={[
          { label: 'Criado em', value: product.createdAt },
          { label: 'Criado por', value: product.createdBy },
          { label: 'Atualizado em', value: product.updatedAt },
          { label: 'Atualizado por', value: product.updatedBy },
          { label: 'Arquivado em', value: shown(product.archivedAt) },
        ]} />
      </div>
    </section>
  )
}
