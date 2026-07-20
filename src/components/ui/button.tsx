import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/**
 * Brand-tuned button. Variants map to the design's real CTA roles:
 *  - primary   → blue pill (nav CTA)
 *  - inverse   → white pill on dark (hero CTA)
 *  - sand      → warm submit (contact form)
 * Every variant keeps a visible focus-visible ring — never hover-only.
 */
const buttonVariants = cva(
  'inline-flex cursor-pointer items-center justify-center font-sans leading-none whitespace-nowrap outline-hidden transition duration-300 ease-house select-none focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary:
          'rounded-full bg-blue text-white shadow-[0_12px_26px_-14px_rgb(3_79_131/0.75)] hover:-translate-y-px hover:bg-baltic hover:shadow-[0_16px_30px_-14px_rgb(6_156_255/0.6)]',
        inverse:
          'rounded-full bg-white text-navy shadow-[0_20px_40px_-18px_rgb(0_0_0/0.5)] hover:-translate-y-0.5 hover:bg-sand hover:shadow-[0_26px_48px_-18px_rgb(238_202_160/0.5)]',
        sand: 'rounded-xl bg-sand text-[#3a2a12] hover:-translate-y-0.5 hover:bg-white',
      },
      size: {
        pill: 'gap-2.25 px-5 py-2.75 text-sm font-semibold',
        pillLg: 'gap-3 px-7 py-4.25 text-[15.5px] font-semibold',
        submit: 'gap-2.75 px-6 py-4.25 text-[15.5px] font-semibold',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'pill',
    },
  },
)

export type ButtonProps = React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button, buttonVariants }
