import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ElementType,
  type ReactNode,
} from 'react'
import { cn } from '@/lib/cn'
import { prefersReducedMotion } from '@/lib/motion'

export type RevealProps = {
  children: ReactNode
  className?: string
  /** Optional DOM id — e.g. to serve as an anchor target. */
  id?: string
  /** Entrance delay in ms (stagger within a group). */
  delay?: number
  /** Rise distance in px for the entrance. */
  rise?: number
  /** Opacity fade duration in ms. */
  fadeMs?: number
  /** Transform (rise) duration in ms. */
  riseMs?: number
  as?: ElementType
}

/**
 * Scroll-reveal wrapper — fade + rise, once — recreating the prototype's
 * IntersectionObserver reveal.
 *
 * The hidden/visible styling lives in CSS (see app.css), gated on the `data-js`
 * flag a blocking head script sets before first paint. That means:
 *  - no-JS renders content visible (the hide rule never matches);
 *  - with JS, content is hidden from the first paint and never painted-then-
 *    hidden — no flash, identical in dev and prod regardless of hydration speed.
 * This component only observes the element and flips `data-reveal-in` once it
 * scrolls into view; per-element timing is passed down as CSS variables.
 */
export function Reveal({
  children,
  className,
  id,
  as: Tag = 'div',
  delay = 0,
  rise = 24,
  fadeMs = 800,
  riseMs = 500,
}: RevealProps) {
  const ref = useRef<HTMLElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) {
      setShown(true)
      return
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShown(true)
          observer.disconnect()
          window.clearTimeout(safety)
        }
      },
      { threshold: 0.15, rootMargin: '0px 0px -7% 0px' },
    )
    const safety = window.setTimeout(() => {
      setShown(true)
      observer.disconnect()
    }, 2600)

    observer.observe(el)
    return () => {
      observer.disconnect()
      window.clearTimeout(safety)
    }
  }, [])

  const style = {
    '--rv-rise': `${rise}px`,
    '--rv-fade': `${fadeMs}ms`,
    '--rv-rise-dur': `${riseMs}ms`,
    '--rv-delay': `${delay}ms`,
  } as CSSProperties

  return (
    <Tag
      ref={ref}
      id={id}
      data-reveal=""
      data-reveal-in={shown ? '' : undefined}
      style={style}
      className={cn(className)}
    >
      {children}
    </Tag>
  )
}
