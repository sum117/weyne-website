import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const alertVariants = cva(
  'relative grid w-full grid-cols-[0_1fr] items-start gap-y-0.5 rounded-lg border px-4 py-3 text-sm transition-colors ease-house has-[>svg]:grid-cols-[calc(var(--spacing)*4)_1fr] has-[>svg]:gap-x-3 [&>svg]:size-4 [&>svg]:translate-y-0.5',
  {
    variants: {
      variant: {
        neutral:
          'border-status-neutral-border bg-status-neutral text-status-neutral-foreground',
        info: 'border-status-info-border bg-status-info text-status-info-foreground',
        warning:
          'border-warning-border bg-warning text-warning-foreground',
        success:
          'border-success-border bg-success text-success-foreground',
        destructive:
          'border-destructive-border bg-destructive-surface text-destructive-surface-foreground',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
)

type AlertProps = React.ComponentProps<'div'> &
  VariantProps<typeof alertVariants>

function Alert({ className, variant, role = 'status', ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      data-variant={variant ?? 'neutral'}
      role={role}
      className={cn(alertVariants({ variant }), className)}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-title"
      className={cn('col-start-2 font-medium leading-none', className)}
      {...props}
    />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="alert-description"
      className={cn('col-start-2 text-sm leading-relaxed', className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants, type AlertProps }
