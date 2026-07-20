import * as React from 'react'
import { cn } from '@/lib/cn'

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex w-full min-w-0 resize-y rounded-xl border border-input bg-white px-4 py-3 text-[15px] text-ink outline-hidden transition duration-300',
        'placeholder:text-muted/70',
        'focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/15',
        'aria-invalid:border-destructive aria-invalid:ring-destructive/20',
        'disabled:pointer-events-none disabled:opacity-60',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
