import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-colors ease-house focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&_svg]:size-3',
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
      size: {
        default: 'min-h-6',
        compact: 'min-h-5 px-1.5 py-0 text-[11px]',
      },
    },
    defaultVariants: {
      variant: 'neutral',
      size: 'default',
    },
  },
)

type BadgeProps = React.ComponentProps<'span'> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: BadgeProps) {
  const Comp = asChild ? Slot : 'span'
  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants, type BadgeProps }
