import { useEffect, type RefObject } from 'react'
import { hasFinePointer, prefersReducedMotion } from '@/lib/motion'

/**
 * Gentle, damped mouse parallax for the hero decorative layers (`[data-par]`),
 * recreating the prototype: eased follow (lerp 0.06), desktop fine-pointer only,
 * fully disabled under reduced motion. This is the final, optional enhancement —
 * it never gates content.
 */
export function useHeroParallax(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const stage = ref.current
    if (!stage || prefersReducedMotion() || !hasFinePointer()) return

    const layers = Array.from(
      stage.querySelectorAll<HTMLElement>('[data-par]'),
    )
    if (layers.length === 0) return

    let targetX = 0
    let targetY = 0
    let curX = 0
    let curY = 0
    let raf = 0

    const lerp = (a: number, b: number, n: number) => a + (b - a) * n
    const apply = () => {
      for (const layer of layers) {
        const depth = Number.parseFloat(layer.dataset.par ?? '10') || 10
        layer.style.transform = `translate(${(curX * depth).toFixed(2)}px, ${(curY * depth).toFixed(2)}px)`
      }
    }
    const tick = () => {
      curX = lerp(curX, targetX, 0.06)
      curY = lerp(curY, targetY, 0.06)
      apply()
      if (Math.abs(curX - targetX) > 0.0004 || Math.abs(curY - targetY) > 0.0004) {
        raf = requestAnimationFrame(tick)
      } else {
        raf = 0
      }
    }
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(tick)
    }

    const onMove = (event: MouseEvent) => {
      const rect = stage.getBoundingClientRect()
      targetX = (event.clientX - rect.left) / rect.width - 0.5
      targetY = (event.clientY - rect.top) / rect.height - 0.5
      kick()
    }
    const onLeave = () => {
      targetX = 0
      targetY = 0
      kick()
    }

    stage.addEventListener('mousemove', onMove)
    stage.addEventListener('mouseleave', onLeave)
    return () => {
      stage.removeEventListener('mousemove', onMove)
      stage.removeEventListener('mouseleave', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [ref])
}
