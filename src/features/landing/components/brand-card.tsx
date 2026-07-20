import { useState, type CSSProperties } from 'react'
import { cn } from '@/lib/cn'
import type { Brand } from '../content'

export type BrandCardProps = {
  brand: Brand
  className?: string
}

/**
 * Represented-brand card. The description is always in the accessibility tree
 * (so screen-reader users get it without hovering). The gradient overlay
 * reveals on hover and keyboard focus (CSS); on touch devices a tap toggles it
 * via `aria-expanded`. The logo renders muted (grayscale/50%) at rest.
 */
export function BrandCard({ brand, className }: BrandCardProps) {
  const [expanded, setExpanded] = useState(false)

  // On touch devices (no hover) a tap toggles the overlay; on pointer devices
  // hover/focus already handle it, so a click is a no-op.
  const handleClick = () => {
    if (window.matchMedia('(hover: none)').matches) setExpanded((v) => !v)
  }

  return (
    <button
      type="button"
      data-brand
      aria-expanded={expanded}
      onClick={handleClick}
      className={cn(
        'group relative flex min-h-52.5 w-full cursor-pointer flex-col overflow-hidden rounded-[20px] border border-line bg-white text-left transition-[translate,box-shadow,border-color] duration-500 ease-house hover:-translate-y-2 hover:border-transparent hover:shadow-brand-hover focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-hidden',
        className,
      )}
    >
      <span className="grid flex-1 place-items-center px-7 pt-9 pb-3.5">
        <img
          data-brandlogo
          src={brand.logo}
          alt={brand.logoAlt}
          loading="lazy"
          decoding="async"
          style={
            {
              '--logo-h': `${brand.logoMaxHeight}px`,
              '--logo-w': `${brand.logoMaxWidth}%`,
            } as CSSProperties
          }
          className="size-auto max-h-(--logo-h) max-w-(--logo-w) object-contain opacity-50 grayscale transition-[filter,opacity] duration-500"
        />
      </span>

      <span className="flex items-center gap-2 px-6 pb-5">
        <span className="font-sans text-[11px] leading-none font-semibold tracking-[0.15em] text-muted uppercase">
          {brand.category}
        </span>
        {brand.plestinBrand && (
          <span className="rounded-md bg-[rgb(3_79_131/0.08)] px-2 py-1 font-sans text-[10px] leading-none font-medium tracking-[0.04em] text-blue">
            marca Plestin
          </span>
        )}
      </span>

      {/* Reveal overlay */}
      <span
        data-brand-desc
        className="pointer-events-none absolute inset-0 flex translate-y-3.5 flex-col justify-end px-6.5 py-7 text-white opacity-0 transition-[opacity,translate] duration-450 ease-house bg-card-gradient group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 group-aria-expanded:translate-y-0 group-aria-expanded:opacity-100"
      >
        <span className="mb-2.75 font-sans text-[11px] leading-none font-semibold tracking-[0.16em] text-sand uppercase">
          {brand.name}
        </span>
        <span className="text-[14px] leading-[1.6] text-white/90">
          {brand.description}
        </span>
      </span>
    </button>
  )
}
