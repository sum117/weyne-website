import { useEffect, useState } from 'react'
import { List, WhatsappLogo, X } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet'
import { cn } from '@/lib/cn'
import { siteConfig } from '@/features/landing/content'

const { nav, primaryCtaLabel, wordmark, siteName } = siteConfig

/** Transparent-on-hero → solid-after-24px header state. */
function useScrolled(threshold = 24) {
  const [scrolled, setScrolled] = useState(false)
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > threshold)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [threshold])
  return scrolled
}

export function SiteHeader() {
  const scrolled = useScrolled()
  const [menuOpen, setMenuOpen] = useState(false)

  // Close the mobile sheet once the desktop breakpoint is reached.
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 900px)')
    const onChange = () => mq.matches && setMenuOpen(false)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  return (
    <header
      className={cn(
        'fixed inset-x-0 top-0 z-header border-b transition-[background-color,box-shadow,border-color,backdrop-filter] duration-450',
        scrolled
          ? 'border-[rgb(3_79_131/0.08)] bg-white/92 shadow-[0_1px_0_rgb(3_79_131/0.08),0_20px_44px_-32px_rgb(3_79_131/0.55)] backdrop-blur-[16px] backdrop-saturate-150'
          : 'border-transparent bg-transparent',
      )}
    >
      <nav className="mx-auto flex max-w-330 items-center justify-between gap-5 px-[clamp(18px,5vw,48px)] py-4 pt-[max(env(safe-area-inset-top,0px),16px)] nav:pt-4">
        {/* Wordmark */}
        <a
          href="#topo"
          aria-label={siteName}
          className="flex flex-none items-center gap-3 rounded-md focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-transparent focus-visible:outline-hidden"
        >
          <span className="relative block size-10 flex-none">
            <img
              src="/images/monogram-white.png"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              className={cn(
                'absolute inset-0 size-full object-contain transition-opacity duration-400',
                scrolled ? 'opacity-0' : 'opacity-100',
              )}
            />
            <img
              src="/images/monogram-blue.png"
              alt=""
              aria-hidden="true"
              width={40}
              height={40}
              className={cn(
                'absolute inset-0 size-full object-contain transition-opacity duration-400',
                scrolled ? 'opacity-100' : 'opacity-0',
              )}
            />
          </span>
          <span className="flex flex-col leading-none">
            <span
              className={cn(
                'font-display text-[31px] leading-[0.9] font-medium tracking-[0.005em] transition-colors duration-400',
                scrolled ? 'text-[#0A2740]' : 'text-white',
              )}
            >
              {wordmark.primary}
            </span>
            <span
              className={cn(
                'mt-1 font-sans text-[8.5px] leading-none font-semibold tracking-[0.34em] uppercase transition-colors duration-400',
                scrolled ? 'text-[rgb(3_79_131/0.62)]' : 'text-white/72',
              )}
            >
              {wordmark.secondary}
            </span>
          </span>
        </a>

        {/* Desktop nav */}
        <div className="hidden items-center gap-[clamp(20px,2.4vw,36px)] nav:flex">
          {nav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className={cn(
                'font-sans text-[15px] leading-none font-medium tracking-[0.01em] opacity-92 transition-[color,opacity] duration-400 hover:opacity-100 focus-visible:underline focus-visible:underline-offset-4 focus-visible:opacity-100 focus-visible:outline-hidden',
                scrolled ? 'text-[#274a66]' : 'text-white',
              )}
            >
              {item.label}
            </a>
          ))}
          <Button asChild variant="primary" size="pill">
            <a href="#contato">
              <WhatsappLogo size={18} weight="light" />
              {primaryCtaLabel}
            </a>
          </Button>
        </div>

        {/* Mobile burger + sheet */}
        <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
          <button
            type="button"
            aria-label="Menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((o) => !o)}
            className={cn(
              'grid size-11.5 cursor-pointer place-items-center rounded-[13px] border transition duration-300 hover:brightness-105 focus-visible:ring-2 focus-visible:ring-baltic focus-visible:outline-hidden nav:hidden',
              scrolled
                ? 'border-[rgb(3_79_131/0.14)] bg-[rgb(3_79_131/0.08)] text-ink'
                : 'border-white/28 bg-white/16 text-white',
            )}
          >
            {menuOpen ? (
              <X size={24} weight="light" />
            ) : (
              <List size={24} weight="light" />
            )}
          </button>

          <SheetContent
            side="top"
            showClose={false}
            className="inset-x-3 top-[max(env(safe-area-inset-top,0px),12px)] gap-1 rounded-[20px] border border-line p-3.5 shadow-[0_40px_70px_-34px_rgb(1_20_36/0.5)]"
          >
            <SheetTitle className="sr-only">Menu de navegação</SheetTitle>
            <SheetDescription className="sr-only">
              Navegue pelas seções do site.
            </SheetDescription>
            {nav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="rounded-xl px-4 py-3.5 font-sans text-[16px] font-medium text-ink transition hover:bg-paper focus-visible:bg-paper focus-visible:outline-hidden"
              >
                {item.label}
              </a>
            ))}
            <Button
              asChild
              variant="primary"
              size="pillLg"
              className="mt-1.5 w-full rounded-xl"
            >
              <a href="#contato" onClick={() => setMenuOpen(false)}>
                <WhatsappLogo size={19} weight="light" />
                {primaryCtaLabel}
              </a>
            </Button>
          </SheetContent>
        </Sheet>
      </nav>
    </header>
  )
}
