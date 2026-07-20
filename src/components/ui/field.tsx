import * as React from 'react'
import { Label } from '@radix-ui/react-label'
import { cn } from '@/lib/cn'

/**
 * Minimal, accessible field primitives for use with TanStack Form.
 * The consumer wires ids and aria-describedby; these components provide the
 * semantic structure (label association, live error region).
 */

function Field({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="field"
      className={cn('flex flex-col gap-2', className)}
      {...props}
    />
  )
}

function FieldLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  return (
    <Label
      data-slot="field-label"
      className={cn(
        'font-sans text-[11px] font-semibold tracking-[0.12em] text-white/66 uppercase',
        className,
      )}
      {...props}
    />
  )
}

function FieldError({
  className,
  children,
  ...props
}: React.ComponentProps<'p'>) {
  if (!children) return null
  return (
    <p
      data-slot="field-error"
      role="alert"
      className={cn('text-[12.5px] font-medium text-sand', className)}
      {...props}
    >
      {children}
    </p>
  )
}

function FieldDescription({
  className,
  ...props
}: React.ComponentProps<'p'>) {
  return (
    <p
      data-slot="field-description"
      className={cn('text-[12.5px] text-white/60', className)}
      {...props}
    />
  )
}

export { Field, FieldLabel, FieldError, FieldDescription }
