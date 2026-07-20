import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/**
 * Kicker used above every section heading: a short sand dash + uppercase label.
 * `tone` switches the label color for light vs. dark surfaces; the dash is
 * always sand.
 */
const eyebrowLabel = cva(
  'font-sans text-[12.5px] leading-none font-semibold tracking-[0.2em] uppercase',
  {
    variants: {
      tone: {
        light: 'text-blue',
        dark: 'text-white/82',
      },
    },
    defaultVariants: { tone: 'light' },
  },
)

export type SectionEyebrowProps = VariantProps<typeof eyebrowLabel> & {
  children: string
  className?: string
}

export function SectionEyebrow({
  children,
  tone,
  className,
}: SectionEyebrowProps) {
  return (
    <div className={cn('inline-flex items-center gap-3', className)}>
      <span aria-hidden="true" className="inline-block h-0.5 w-6.5 bg-sand" />
      <span className={eyebrowLabel({ tone })}>{children}</span>
    </div>
  )
}
