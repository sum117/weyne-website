import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Archive, ArrowCounterClockwise, PencilSimple, Plus } from '@phosphor-icons/react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

export type ProductPriceSummary = {
  key: 'PRICE_1' | 'PRICE_2' | 'PRICE_3' | 'PRICE_4'
  label: string
  amount: string
}

export type ProductCatalogItem = {
  id: string
  internalCode: string
  manufacturerCode: string | null
  name: string
  industry: string
  category: string | null
  brand: string | null
  archived: boolean
  prices: readonly [
    ProductPriceSummary,
    ProductPriceSummary,
    ProductPriceSummary,
    ProductPriceSummary,
  ]
}

type CatalogFilters = {
  identifier: string
  text: string
  industry: string
  category: string
  brand: string
  status: 'all' | 'active' | 'archived'
}

export type ProductCatalogProps = {
  products: ProductCatalogItem[]
  canManage: boolean
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  onArchiveStateChange?: (product: ProductCatalogItem, archived: boolean) => void | Promise<void>
}

const emptyFilters: CatalogFilters = {
  identifier: '',
  text: '',
  industry: '',
  category: '',
  brand: '',
  status: 'all',
}

function normalizeIdentifier(value: string) {
  return value.toLocaleUpperCase('pt-BR').replace(/[^A-Z0-9]/g, '')
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('pt-BR')
    .trim()
}

function readFiltersFromUrl(): CatalogFilters {
  if (typeof window === 'undefined') return emptyFilters
  const search = new URLSearchParams(window.location.search)
  const status = search.get('status')
  return {
    identifier: search.get('identifier') ?? '',
    text: search.get('text') ?? '',
    industry: search.get('industry') ?? '',
    category: search.get('category') ?? '',
    brand: search.get('brand') ?? '',
    status: status === 'active' || status === 'archived' ? status : 'all',
  }
}

function writeFiltersToUrl(filters: CatalogFilters) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  for (const key of Object.keys(emptyFilters) as Array<keyof CatalogFilters>) {
    url.searchParams.delete(key)
    const value = filters[key]
    if (value && value !== 'all') url.searchParams.set(key, value)
  }
  window.history.replaceState(window.history.state, '', url)
}

function decimalCurrency(amount: string) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(amount)
  if (!match) return `R$ ${amount}`
  const groupedInteger = match[1]!.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const significantFraction = (match[2] ?? '').replace(/0+$/, '')
  const fraction = significantFraction.padEnd(2, '0')
  return `R$ ${groupedInteger},${fraction}`
}

function distinctValues(products: ProductCatalogItem[], key: 'industry' | 'category' | 'brand') {
  return Array.from(
    new Set(
      products
        .map((product) => product[key])
        .filter((value): value is string => Boolean(value)),
    ),
  ).sort((left, right) => left.localeCompare(right, 'pt-BR'))
}

function PriceSummary({ prices }: { prices: ProductCatalogItem['prices'] }) {
  return (
    <dl className="grid min-w-0 max-w-full grid-cols-2 gap-x-4 gap-y-1 text-xs sm:min-w-48">
      {prices.map((price) => (
        <div key={price.key} className="flex justify-between gap-2">
          <dt className="text-muted">{price.label}</dt>
          <dd className="font-medium whitespace-nowrap text-ink">{decimalCurrency(price.amount)}</dd>
        </div>
      ))}
    </dl>
  )
}

export function ProductCatalog({
  products,
  canManage,
  loading = false,
  error = null,
  onRetry,
  onArchiveStateChange,
}: ProductCatalogProps) {
  const [filters, setFilters] = useState<CatalogFilters>(readFiltersFromUrl)
  const [pendingProduct, setPendingProduct] = useState<ProductCatalogItem | null>(null)
  const [saving, setSaving] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  useEffect(() => writeFiltersToUrl(filters), [filters])

  const options = useMemo(
    () => ({
      industries: distinctValues(products, 'industry'),
      categories: distinctValues(products, 'category'),
      brands: distinctValues(products, 'brand'),
    }),
    [products],
  )

  const filteredProducts = useMemo(() => {
    const identifier = normalizeIdentifier(filters.identifier)
    const text = normalizeText(filters.text)
    return products.filter((product) => {
      const matchesIdentifier =
        identifier === '' ||
        normalizeIdentifier(product.internalCode).includes(identifier) ||
        normalizeIdentifier(product.manufacturerCode ?? '').includes(identifier)
      const matchesText = text === '' || normalizeText(product.name).includes(text)
      return (
        matchesIdentifier &&
        matchesText &&
        (!filters.industry || product.industry === filters.industry) &&
        (!filters.category || product.category === filters.category) &&
        (!filters.brand || product.brand === filters.brand) &&
        (filters.status === 'all' ||
          (filters.status === 'archived' ? product.archived : !product.archived))
      )
    })
  }, [filters, products])

  const hasFilters = Object.entries(filters).some(
    ([key, value]) => value !== '' && !(key === 'status' && value === 'all'),
  )

  function updateFilter<Key extends keyof CatalogFilters>(key: Key, value: CatalogFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  async function confirmArchiveStateChange() {
    if (!pendingProduct || !onArchiveStateChange) return
    setSaving(true)
    setActionError(null)
    try {
      await onArchiveStateChange(pendingProduct, !pendingProduct.archived)
      setPendingProduct(null)
    } catch {
      setActionError(
        `Não foi possível ${pendingProduct.archived ? 'restaurar' : 'arquivar'} o produto. Tente novamente.`,
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby="product-catalog-title" className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.16em] text-blue uppercase">Catálogo</p>
          <h1 id="product-catalog-title" className="mt-1 font-display text-3xl text-navy">
            Produtos
          </h1>
          <p className="mt-1 text-sm text-muted">{filteredProducts.length} de {products.length} produtos</p>
        </div>
        {canManage ? (
          <Button asChild>
            <a href="/app/produtos/novo"><Plus aria-hidden="true" />Novo produto</a>
          </Button>
        ) : null}
      </header>

      <div className="grid gap-3 rounded-xl border border-border bg-white p-4 md:grid-cols-2 xl:grid-cols-6">
        <label className="space-y-1 text-sm font-medium text-ink xl:col-span-2">
          Buscar por identificador
          <Input
            value={filters.identifier}
            onChange={(event) => updateFilter('identifier', event.target.value)}
            placeholder="Código interno ou do fabricante"
          />
        </label>
        <label className="space-y-1 text-sm font-medium text-ink xl:col-span-2">
          Buscar por nome
          <Input
            value={filters.text}
            onChange={(event) => updateFilter('text', event.target.value)}
            placeholder="Nome ou descrição"
          />
        </label>
        <CatalogSelect label="Indústria" value={filters.industry} options={options.industries} onChange={(value) => updateFilter('industry', value)} />
        <CatalogSelect label="Categoria" value={filters.category} options={options.categories} onChange={(value) => updateFilter('category', value)} />
        <CatalogSelect label="Marca" value={filters.brand} options={options.brands} onChange={(value) => updateFilter('brand', value)} />
        <label className="space-y-1 text-sm font-medium text-ink">
          Situação
          <select
            aria-label="Situação"
            className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none"
            value={filters.status}
            onChange={(event) => updateFilter('status', event.target.value as CatalogFilters['status'])}
          >
            <option value="all">Todos</option>
            <option value="active">Ativos</option>
            <option value="archived">Arquivados</option>
          </select>
        </label>
        <div className="flex items-end xl:col-span-2">
          <Button type="button" variant="secondary" disabled={!hasFilters} onClick={() => setFilters(emptyFilters)}>
            Limpar filtros
          </Button>
        </div>
      </div>

      {loading ? (
        <CatalogState role="status" message="Carregando produtos…" />
      ) : error ? (
        <CatalogState role="alert" message={error} action={onRetry ? <Button type="button" onClick={onRetry}>Tentar novamente</Button> : null} />
      ) : filteredProducts.length === 0 ? (
        <CatalogState role="status" message={hasFilters ? 'Nenhum produto corresponde aos filtros.' : 'Nenhum produto cadastrado.'} />
      ) : (
        <>
          <div data-testid="product-catalog-table" className="hidden overflow-hidden rounded-xl border border-border bg-white md:block">
            <Table>
              <TableHeader className="bg-paper">
                <TableRow>
                  <TableHead>Identificadores</TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Indústria</TableHead>
                  <TableHead>Categoria / marca</TableHead>
                  <TableHead>Preços</TableHead>
                  <TableHead>Situação</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredProducts.map((product) => (
                  <TableRow key={product.id}>
                    <TableCell><Identifiers product={product} /></TableCell>
                    <TableCell className="max-w-64 font-medium"><a className="text-blue underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none" href={`/app/produtos/${product.id}`}>{product.name}</a></TableCell>
                    <TableCell>{product.industry}</TableCell>
                    <TableCell><span className="block">{product.category ?? '—'}</span><span className="text-xs text-muted">{product.brand ?? 'Sem marca'}</span></TableCell>
                    <TableCell><PriceSummary prices={product.prices} /></TableCell>
                    <TableCell><StatusBadge archived={product.archived} /></TableCell>
                    <TableCell><ProductActions product={product} canManage={canManage} onArchive={() => { setActionError(null); setPendingProduct(product) }} /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          <div data-testid="product-catalog-cards" className="grid gap-3 md:hidden">
            {filteredProducts.map((product) => (
              <article key={product.id} className="space-y-4 rounded-xl border border-border bg-white p-4 shadow-card">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0"><Identifiers product={product} /><h2 className="mt-2 break-words font-semibold text-navy"><a href={`/app/produtos/${product.id}`}>{product.name}</a></h2></div>
                  <StatusBadge archived={product.archived} />
                </div>
                <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2"><div className="min-w-0"><dt className="text-xs text-muted">Indústria</dt><dd className="break-words">{product.industry}</dd></div><div className="min-w-0"><dt className="text-xs text-muted">Categoria / marca</dt><dd className="break-words">{product.category ?? '—'} · {product.brand ?? 'Sem marca'}</dd></div></dl>
                <PriceSummary prices={product.prices} />
                <ProductActions product={product} canManage={canManage} onArchive={() => { setActionError(null); setPendingProduct(product) }} />
              </article>
            ))}
          </div>
        </>
      )}

      <AlertDialog
        open={pendingProduct !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPendingProduct(null)
        }}
      >
        {pendingProduct ? (
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingProduct.archived ? 'Restaurar produto?' : 'Arquivar produto?'}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {pendingProduct.archived
                  ? 'O produto voltará a aparecer entre os itens ativos.'
                  : 'O produto será preservado no histórico e poderá ser restaurado depois.'}
              </AlertDialogDescription>
            </AlertDialogHeader>
            {actionError ? (
              <p role="alert" className="text-sm text-destructive">{actionError}</p>
            ) : null}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={saving}>Cancelar</AlertDialogCancel>
              <Button
                type="button"
                variant="destructive"
                size="default"
                disabled={saving || !onArchiveStateChange}
                onClick={confirmArchiveStateChange}
              >
                {saving ? 'Salvando…' : pendingProduct.archived ? 'Restaurar' : 'Arquivar'}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        ) : null}
      </AlertDialog>
    </section>
  )
}

function CatalogSelect({ label, value, options, onChange }: { label: string; value: string; options: string[]; onChange: (value: string) => void }) {
  return <label className="space-y-1 text-sm font-medium text-ink">{label}<select aria-label={label} className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-blue focus-visible:outline-none" value={value} onChange={(event) => onChange(event.target.value)}><option value="">Todas</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
}

function CatalogState({ role, message, action }: { role: 'alert' | 'status'; message: string; action?: ReactNode }) {
  return <div role={role} className="space-y-3 rounded-xl border border-border bg-white px-6 py-14 text-center text-muted"><p>{message}</p>{action}</div>
}

function Identifiers({ product }: { product: ProductCatalogItem }) {
  return <span className="font-mono text-xs"><strong className="block text-ink">{product.internalCode}</strong><span className="text-muted">{product.manufacturerCode ?? 'Sem cód. fabricante'}</span></span>
}

function StatusBadge({ archived }: { archived: boolean }) {
  return <Badge variant={archived ? 'neutral' : 'success'}>{archived ? 'Arquivado' : 'Ativo'}</Badge>
}

function ProductActions({ product, canManage, onArchive }: { product: ProductCatalogItem; canManage: boolean; onArchive: () => void }) {
  return <div className="flex flex-wrap justify-end gap-2"><Button asChild size="sm" variant="secondary"><a href={`/app/produtos/${product.id}`}>Ver</a></Button>{canManage ? <><Button asChild size="sm" variant="secondary"><a href={`/app/produtos/${product.id}/editar`}><PencilSimple aria-hidden="true" />Editar</a></Button><Button type="button" size="sm" variant="secondary" onClick={onArchive}>{product.archived ? <ArrowCounterClockwise aria-hidden="true" /> : <Archive aria-hidden="true" />}{product.archived ? 'Restaurar' : 'Arquivar'}</Button></> : null}</div>
}
