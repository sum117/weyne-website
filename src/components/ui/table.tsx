import * as React from 'react'
import { cn } from '@/lib/cn'

function Table({
  className,
  'aria-label': ariaLabel,
  ...props
}: React.ComponentProps<'table'>) {
  return (
    <div
      data-slot="table-container"
      role="region"
      aria-label={
        ariaLabel ? `Área rolável: ${ariaLabel}` : 'Área rolável da tabela'
      }
      tabIndex={0}
      className="w-full max-w-full overflow-x-auto overscroll-x-contain rounded-sm outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
    >
      <table
        data-slot="table"
        aria-label={ariaLabel}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'border-b border-table-divider transition-colors ease-house hover:bg-table-row-hover data-[state=selected]:bg-table-row-selected data-[state=selected]:text-table-row-selected-foreground',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'h-11 bg-table-header px-3 text-left align-middle text-xs font-semibold tracking-wide text-muted-foreground uppercase [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-3 align-middle text-ink [&:has([role=checkbox])]:pr-0',
        className,
      )}
      {...props}
    />
  )
}

export { Table, TableHeader, TableBody, TableRow, TableHead, TableCell }
