'use client'

import { ImageSquare } from '@phosphor-icons/react/dist/ssr'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  createLineSnapshotFromCatalog,
  quoteCatalogQueryOptions,
  type CatalogFacetOption,
  type CatalogProduct,
  type NewQuoteLineSnapshot,
  type QuoteDataService,
} from '@/features/app/quotes/quote-data'

export interface QuoteCatalogPickerProps {
  readonly service: QuoteDataService
  readonly defaultPriceListId: string
  readonly selectedPriceListId?: string
  readonly onPriceListChange?: (priceListId: string) => void
  readonly onSelect: (snapshot: NewQuoteLineSnapshot) => void
  readonly pageSize?: number
}

function ProductThumbnail({ product }: { product: CatalogProduct }) {
  if (!product.thumbnailUrl) {
    return (
      <span
        className="grid size-12 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"
        aria-label="Produto sem imagem"
      >
        <ImageSquare aria-hidden="true" weight="light" />
      </span>
    )
  }

  return (
    <img
      src={product.thumbnailUrl}
      alt=""
      className="size-12 shrink-0 rounded-lg object-cover"
    />
  )
}

function FacetSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: readonly CatalogFacetOption[]
  onChange: (value: string) => void
}) {
  return (
    <label className="grid min-w-0 gap-1 text-xs font-medium text-muted-foreground">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-h-11 min-w-0 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <option value="">Todos</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} ({option.count})
          </option>
        ))}
      </select>
    </label>
  )
}

export function QuoteCatalogPicker({
  service,
  defaultPriceListId,
  selectedPriceListId,
  onPriceListChange,
  onSelect,
  pageSize = 20,
}: QuoteCatalogPickerProps) {
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [activeProductId, setActiveProductId] = useState('')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [industryId, setIndustryId] = useState('')
  const [brand, setBrand] = useState('')
  const [category, setCategory] = useState('')
  const [cursorStack, setCursorStack] = useState<readonly string[]>([])
  const [internalPriceListId, setInternalPriceListId] = useState(defaultPriceListId)
  const priceListId = selectedPriceListId ?? internalPriceListId
  const cursor = cursorStack.at(-1)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  const query = useQuery(
    quoteCatalogQueryOptions(service, {
      priceListId,
      limit: pageSize,
      cursor,
      search: debouncedSearch || undefined,
      industryIds: industryId ? [industryId] : undefined,
      brands: brand ? [brand] : undefined,
      categories: category ? [category] : undefined,
    }),
  )

  useEffect(() => {
    const firstEligible = query.data?.items.find(
      (product) => !product.archived && product.selectedPrice !== null,
    )
    setActiveProductId(firstEligible?.id ?? '')
  }, [query.data])

  function resetPagination() {
    setCursorStack([])
  }

  function selectProduct(product: CatalogProduct) {
    onSelect(createLineSnapshotFromCatalog(product))
    searchInputRef.current?.focus()
  }

  function selectActiveProduct() {
    const product =
      query.data?.items.find((item) => item.id === activeProductId) ??
      query.data?.items.find(
        (item) => !item.archived && item.selectedPrice !== null,
      )
    if (product && !product.archived && product.selectedPrice !== null) {
      selectProduct(product)
    }
  }

  function changePriceList(nextPriceListId: string) {
    if (selectedPriceListId === undefined) setInternalPriceListId(nextPriceListId)
    onPriceListChange?.(nextPriceListId)
    resetPagination()
  }

  const facets = query.data?.facets ?? {
    industries: [],
    brands: [],
    categories: [],
  }

  return (
    <section
      aria-label="Catálogo de produtos"
      className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3 sm:p-4"
      onKeyDownCapture={(event) => {
        if (
          event.key === 'Enter' &&
          (event.target as HTMLElement).dataset.slot === 'command-input'
        ) {
          event.preventDefault()
          event.stopPropagation()
          selectActiveProduct()
        }
      }}
    >
      {query.data ? (
        <div className="grid gap-1 sm:max-w-xs">
          <label htmlFor="quote-catalog-price-list" className="text-sm font-medium text-foreground">
            Tabela de preços
          </label>
          <select
            id="quote-catalog-price-list"
            aria-describedby="quote-catalog-price-list-help"
            value={priceListId}
            onChange={(event) => changePriceList(event.target.value)}
            className="min-h-11 rounded-lg border border-input bg-background px-3 text-sm outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {query.data.availablePriceLists.map((priceList) => (
              <option key={priceList.id} value={priceList.id}>
                {priceList.displayName}
                {priceList.id === query.data.defaultPriceListId ? ' (padrão)' : ''}
              </option>
            ))}
          </select>
          <span id="quote-catalog-price-list-help" className="text-xs font-normal text-muted-foreground">
            Os preços abaixo usam esta tabela.
          </span>
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-2 sm:grid-cols-3">
        <FacetSelect
          label="Indústria"
          value={industryId}
          options={facets.industries}
          onChange={(value) => {
            setIndustryId(value)
            resetPagination()
          }}
        />
        <FacetSelect
          label="Marca"
          value={brand}
          options={facets.brands}
          onChange={(value) => {
            setBrand(value)
            resetPagination()
          }}
        />
        <FacetSelect
          label="Categoria"
          value={category}
          options={facets.categories}
          onChange={(value) => {
            setCategory(value)
            resetPagination()
          }}
        />
      </div>

      <Command
        label="Buscar produtos"
        shouldFilter={false}
        value={activeProductId}
        onValueChange={setActiveProductId}
        className="border border-border"
      >
        <CommandInput
          ref={searchInputRef}
          aria-label="Buscar produtos"
          placeholder="Código, descrição ou marca"
          value={search}
          onValueChange={(value) => {
            setSearch(value)
            resetPagination()
          }}
        />
        <CommandList className="max-h-[min(24rem,55vh)]" aria-busy={query.isPending}>
          {query.isPending ? (
            <p role="status" className="p-6 text-center text-sm text-muted-foreground">
              Carregando catálogo…
            </p>
          ) : null}

          {query.isError ? (
            <div role="alert" className="space-y-3 p-4 text-sm text-destructive">
              <p>Não foi possível carregar o catálogo.</p>
              <Button
                type="button"
                variant="outline"
                size="default"
                onClick={() => void query.refetch()}
              >
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {query.isSuccess && query.data.items.length === 0 ? (
            <p role="status" className="p-6 text-center text-sm text-muted-foreground">
              Nenhum produto encontrado para esta busca e filtros.
            </p>
          ) : null}

          {query.data?.items.map((product) => {
            const unavailable = product.archived || product.selectedPrice === null
            return (
              <CommandItem
                key={product.id}
                value={product.id}
                disabled={unavailable}
                onSelect={() => selectProduct(product)}
                className="min-h-16 items-start py-2"
              >
                <ProductThumbnail product={product} />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {product.description}
                  </span>
                  <span className="block text-xs break-words text-muted-foreground">
                    {product.internalCode} · {product.industryName}
                    {product.brand ? ` · ${product.brand}` : ''}
                  </span>
                  {product.selectedPrice ? (
                    <span className="block text-xs font-medium text-foreground">
                      R$ {product.selectedPrice.amount.replace('.', ',')} / {product.unit}
                    </span>
                  ) : null}
                  {unavailable ? (
                    <span className="block text-xs text-destructive">
                      {product.archived
                        ? 'Produto arquivado — indisponível para novas seleções'
                        : 'Sem preço nesta tabela — indisponível para seleção'}
                    </span>
                  ) : null}
                </span>
              </CommandItem>
            )
          })}
        </CommandList>
      </Command>

      {query.data ? (
        <nav aria-label="Paginação do catálogo" className="flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={cursorStack.length === 0 || query.isFetching}
            onClick={() => setCursorStack((current) => current.slice(0, -1))}
          >
            Página anterior
          </Button>
          <span className="text-xs text-muted-foreground" aria-live="polite">
            Página {cursorStack.length + 1}
          </span>
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={!query.data.pageInfo.hasNextPage || query.isFetching}
            onClick={() => {
              const nextCursor = query.data.pageInfo.nextCursor
              if (nextCursor) setCursorStack((current) => [...current, nextCursor])
            }}
          >
            Próxima página
          </Button>
        </nav>
      ) : null}
    </section>
  )
}
