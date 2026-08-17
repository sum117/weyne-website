import * as React from 'react'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/cn'

type LoadingRegionProps = {
  className?: string
  label?: string
}

type DataTableSkeletonProps = LoadingRegionProps & {
  rowCount?: number
}

function LoadingRegion({
  children,
  className,
  label,
}: LoadingRegionProps & { children: React.ReactNode }) {
  return (
    <div
      aria-busy="true"
      aria-label={label}
      className={className}
      role="status"
    >
      {children}
    </div>
  )
}

function PageHeaderSkeleton({
  className,
  label = 'Carregando cabeçalho da página',
}: LoadingRegionProps) {
  return (
    <LoadingRegion
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
      label={label}
    >
      <div className="flex-1 space-y-3" aria-hidden="true">
        <Skeleton aria-hidden="true" className="h-4 w-36" />
        <Skeleton aria-hidden="true" className="h-10 w-full max-w-md" />
        <Skeleton aria-hidden="true" className="h-5 w-full max-w-2xl" />
      </div>
      <Skeleton aria-hidden="true" className="h-9 w-36 max-sm:w-full" />
    </LoadingRegion>
  )
}

function DataTableSkeleton({
  className,
  label = 'Carregando tabela',
  rowCount = 5,
}: DataTableSkeletonProps) {
  const safeRowCount = Math.min(Math.max(Math.trunc(rowCount), 1), 20)

  return (
    <LoadingRegion className={cn('space-y-4', className)} label={label}>
      <div className="flex flex-col gap-3 sm:flex-row sm:justify-between" aria-hidden="true">
        <Skeleton aria-hidden="true" className="min-h-11 w-full sm:max-w-sm" />
        <Skeleton aria-hidden="true" className="min-h-11 w-36" />
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card" aria-hidden="true">
        <div className="grid min-h-11 grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))] items-center gap-4 bg-table-header px-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton aria-hidden="true" className="h-3 w-20" key={`header-${index}`} />
          ))}
        </div>
        {Array.from({ length: safeRowCount }, (_, rowIndex) => (
          <div
            className="grid min-h-12 grid-cols-[minmax(12rem,2fr)_repeat(3,minmax(7rem,1fr))] items-center gap-4 border-t border-table-divider px-4"
            data-slot="skeleton-table-row"
            key={`row-${rowIndex}`}
          >
            <Skeleton aria-hidden="true" className="h-4 w-40" />
            <Skeleton aria-hidden="true" className="h-4 w-24" />
            <Skeleton aria-hidden="true" className="h-5 w-20 rounded-full" />
            <Skeleton aria-hidden="true" className="size-8 justify-self-end" />
          </div>
        ))}
      </div>
      <div className="flex justify-between" aria-hidden="true">
        <Skeleton aria-hidden="true" className="h-4 w-32" />
        <Skeleton aria-hidden="true" className="h-9 w-48" />
      </div>
    </LoadingRegion>
  )
}

function DetailSkeleton({
  className,
  label = 'Carregando detalhes',
}: LoadingRegionProps) {
  return (
    <LoadingRegion className={cn('space-y-6', className)} label={label}>
      <div className="grid gap-4 lg:grid-cols-3" aria-hidden="true">
        <section className="space-y-4 rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <Skeleton aria-hidden="true" className="h-7 w-48" />
          <div className="grid gap-4 sm:grid-cols-2">
            {Array.from({ length: 6 }, (_, index) => (
              <div className="space-y-2" key={`detail-${index}`}>
                <Skeleton aria-hidden="true" className="h-3 w-24" />
                <Skeleton aria-hidden="true" className="h-5 w-full" />
              </div>
            ))}
          </div>
        </section>
        <aside className="space-y-4 rounded-xl border border-border bg-card p-5">
          <Skeleton aria-hidden="true" className="h-6 w-36" />
          <Skeleton aria-hidden="true" className="h-20 w-full" />
          <Skeleton aria-hidden="true" className="h-20 w-full" />
        </aside>
      </div>
    </LoadingRegion>
  )
}

export {
  DataTableSkeleton,
  DetailSkeleton,
  PageHeaderSkeleton,
  type DataTableSkeletonProps,
  type LoadingRegionProps,
}
