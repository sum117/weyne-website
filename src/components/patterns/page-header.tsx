import * as React from 'react'
import { cn } from '@/lib/cn'

type PageHeaderBreadcrumb = {
  href?: string
  label: string
}

type PageHeaderProps = Omit<React.ComponentProps<'header'>, 'title'> & {
  actions?: React.ReactNode
  breadcrumbs?: readonly PageHeaderBreadcrumb[]
  description?: React.ReactNode
  eyebrow?: React.ReactNode
  title: React.ReactNode
}

function PageHeader({
  actions,
  breadcrumbs,
  className,
  description,
  eyebrow,
  title,
  ...props
}: PageHeaderProps) {
  const generatedTitleId = React.useId()
  const titleId = props['aria-labelledby'] ?? generatedTitleId

  return (
    <header
      data-slot="page-header"
      aria-labelledby={titleId}
      className={cn(
        'flex flex-col gap-4 border-b border-border pb-5 sm:flex-row sm:items-end sm:justify-between',
        className,
      )}
      {...props}
    >
      <div className="min-w-0 space-y-2" data-slot="page-header-copy">
        {breadcrumbs?.length ? (
          <nav aria-label="Navegação estrutural">
            <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              {breadcrumbs.map((breadcrumb, index) => {
                const isCurrent = index === breadcrumbs.length - 1
                return (
                  <React.Fragment key={`${breadcrumb.label}-${index}`}>
                    {index > 0 ? <li aria-hidden="true">/</li> : null}
                    <li>
                      {breadcrumb.href && !isCurrent ? (
                        <a
                          className="rounded-sm transition-colors ease-house hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          href={breadcrumb.href}
                        >
                          {breadcrumb.label}
                        </a>
                      ) : (
                        <span
                          aria-current={isCurrent ? 'page' : undefined}
                          className={isCurrent ? 'font-medium text-foreground' : undefined}
                        >
                          {breadcrumb.label}
                        </span>
                      )}
                    </li>
                  </React.Fragment>
                )
              })}
            </ol>
          </nav>
        ) : null}
        {eyebrow ? (
          <p className="text-xs font-semibold tracking-[0.12em] text-muted-foreground uppercase">
            {eyebrow}
          </p>
        ) : null}
        <h1
          className="font-display text-3xl leading-tight font-semibold text-foreground sm:text-4xl"
          id={titleId}
        >
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm text-muted-foreground sm:text-base">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div
          className="flex shrink-0 flex-wrap items-center gap-2 max-sm:w-full max-sm:[&>*]:flex-1"
          data-slot="page-header-actions"
        >
          {actions}
        </div>
      ) : null}
    </header>
  )
}

export { PageHeader, type PageHeaderBreadcrumb, type PageHeaderProps }
