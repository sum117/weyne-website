import { useEffect, useState } from 'react'
import { ArrowUp, WhatsappLogo } from '@phosphor-icons/react/dist/ssr'
import { cn } from '@/lib/cn'
import { prefersReducedMotion } from '@/lib/motion'
import { CONTACT_FORM_ANCHOR } from '@/features/landing/whatsapp'
import { siteConfig } from '@/features/landing/content'

// The FAB leads to the lead form (and hides once the contact section is in
// view) rather than opening WhatsApp directly — the form composes the message.
// It targets the form itself so that on mobile a tap lands on the form, not the
// section heading and contact rows that stack above it.
const fabHref = CONTACT_FORM_ANCHOR
const { floating } = siteConfig

export function FloatingActions() {
  const [showTop, setShowTop] = useState(false)
  const [hideFab, setHideFab] = useState(false)

  // Back-to-top appears after 520px of scroll.
  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 520)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Hide the WhatsApp FAB while the contact section is substantially visible.
  useEffect(() => {
    const target = document.getElementById('contato')
    if (!target) return
    const observer = new IntersectionObserver(
      ([entry]) => setHideFab(Boolean(entry?.isIntersecting)),
      { threshold: 0.18 },
    )
    observer.observe(target)
    return () => observer.disconnect()
  }, [])

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
  }

  return (
    <div className="pointer-events-none fixed right-[calc(env(safe-area-inset-right,0px)+16px)] bottom-[calc(env(safe-area-inset-bottom,0px)+18px)] z-70 flex flex-col items-center gap-3">
      <button
        type="button"
        aria-label={floating.backToTopLabel}
        onClick={scrollToTop}
        className={cn(
          'grid size-11.5 cursor-pointer place-items-center rounded-full border border-line bg-white/94 text-navy shadow-[0_16px_32px_-16px_rgb(1_44_75/0.55)] backdrop-blur-[6px] transition duration-350 ease-house hover:border-baltic/50 hover:bg-white hover:text-blue hover:shadow-[0_22px_38px_-16px_rgb(1_44_75/0.6)] focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-hidden',
          showTop
            ? 'pointer-events-auto translate-y-0 scale-100 opacity-100 hover:scale-105'
            : 'pointer-events-none translate-y-3.5 scale-86 opacity-0',
        )}
      >
        <ArrowUp size={22} weight="light" />
      </button>

      <a
        href={fabHref}
        aria-label={floating.whatsappLabel}
        className={cn(
          'relative grid size-14.5 place-items-center rounded-full bg-blue text-white shadow-[0_20px_42px_-16px_rgb(3_79_131/0.75)] transition duration-300 ease-house hover:-translate-y-0.5 hover:bg-baltic focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-hidden',
          hideFab
            ? 'pointer-events-none translate-y-3.5 scale-86 opacity-0'
            : 'pointer-events-auto opacity-100',
        )}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 animate-pulse-ring rounded-full border-2 border-blue opacity-50"
        />
        <WhatsappLogo size={30} weight="light" className="relative" />
      </a>
    </div>
  )
}
