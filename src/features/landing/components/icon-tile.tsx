import type { ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

/**
 * The soft blue rounded icon tile shared by the differentiator cards (md) and
 * the contact rows (sm). Icons inherit `currentColor`, so the tile's text color
 * tints them.
 */
const iconTile = cva(
  'grid shrink-0 place-items-center bg-[rgb(3_79_131/0.07)] text-blue transition duration-450 ease-house',
  {
    variants: {
      size: {
        sm: 'size-11.5 rounded-xl',
        md: 'size-15 rounded-2xl',
      },
    },
    defaultVariants: { size: 'md' },
  },
)

export type IconTileProps = VariantProps<typeof iconTile> & {
  children: ReactNode
  className?: string
}

export function IconTile({ children, size, className }: IconTileProps) {
  return <span className={cn(iconTile({ size }), className)}>{children}</span>
}
