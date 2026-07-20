import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '@/lib/motion'

export type CountUpProps = {
  value: number
  prefix?: string
  className?: string
}

const DURATION = 1400

/**
 * Stat number.
 *
 * Renders the final value as server HTML (SEO + no-JS correct). The observer's
 * own first callback decides (browser-computed, dev/prod-consistent):
 *  - already in view → keep the final value (no reset flash);
 *  - still off-screen → reset to 0 while hidden, then count up (ease-out cubic)
 *    when it scrolls into view, settling on exactly `value`.
 * Reduced motion leaves the final value untouched. The `+` prefix is a sibling
 * glyph — never animated.
 */
export function CountUp({ value, prefix, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el || prefersReducedMotion()) return

    let armed = false
    let raf = 0
    const run = () => {
      const start = performance.now()
      const tick = (now: number) => {
        const k = Math.min(1, (now - start) / DURATION)
        const eased = 1 - Math.pow(1 - k, 3)
        el.textContent = String(Math.round(value * eased))
        if (k < 1) raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          if (armed) run() // was reset to 0 off-screen → count up now
          observer.disconnect()
        } else if (!armed) {
          armed = true
          el.textContent = '0' // reset while off-screen (no visible flash)
        }
      },
      { threshold: 0.4 },
    )
    observer.observe(el)

    return () => {
      observer.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [value])

  return (
    <span className={className}>
      {prefix ? <span aria-hidden="true">{prefix}</span> : null}
      <span ref={ref} data-count={value}>
        {value}
      </span>
    </span>
  )
}
