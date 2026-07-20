import { useRef } from 'react'
import { ArrowRightIcon, WhatsappLogoIcon } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import { useHeroParallax } from '../components/use-hero-parallax'
import { siteConfig } from '../content'

const { hero, primaryCtaLabel } = siteConfig

export function HeroSection() {
  const heroRef = useRef<HTMLElement>(null)
  useHeroParallax(heroRef)

  return (
    <section
      id="topo"
      data-hero
      ref={heroRef}
      className="relative overflow-hidden text-white bg-hero-radial"
    >
      {/* Decorative flowing curves */}
      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
      >
        <path
          d="M-80,560 C280,680 520,380 820,490 S1320,580 1620,450"
          fill="none"
          stroke="rgba(255,255,255,.09)"
          strokeWidth="1.3"
        />
        <path
          d="M-80,648 C300,768 560,468 860,566 S1360,626 1660,496"
          fill="none"
          stroke="rgba(238,202,160,.14)"
          strokeWidth="1.3"
        />
      </svg>

      {/* Huge hairline circles bleeding off-canvas */}
      <div
        aria-hidden="true"
        className="absolute top-[-16vw] right-[-14vw] size-[60vw] max-h-225 max-w-225 rounded-full border-[1.5px] border-white/6"
      />
      <div
        aria-hidden="true"
        className="absolute bottom-[-18vw] left-[-12vw] size-[44vw] max-h-170 max-w-170 rounded-full border-[1.5px] border-white/5"
      />

      <div className="relative mx-auto flex max-w-330 flex-wrap items-center gap-[clamp(18px,2.6vw,44px)] px-[clamp(18px,5vw,48px)] pt-[clamp(122px,14vw,180px)] pb-[clamp(52px,6vw,88px)]">
        {/* Text column */}
        <div className="min-w-72.5 flex-[1_1_400px]">
          <div className="inline-flex animate-[wy-up_0.8s_0.05s_both] items-center gap-3.25">
            <span
              aria-hidden="true"
              className="inline-block h-0.5 w-7.5 bg-sand"
            />
            <span className="font-sans text-[12.5px] leading-none font-semibold tracking-[0.24em] text-white/82 uppercase">
              {hero.eyebrow}
            </span>
          </div>

          <h1 className="mt-[0.34em] max-w-[15ch] font-display text-[clamp(38px,5.6vw,72px)] leading-[1.02] font-normal tracking-[-0.018em]">
            {hero.titleLead}
            <em className="text-sand italic">{hero.titleEmphasis}</em>
            {hero.titleTrail}
          </h1>

          <p className="mt-[clamp(20px,2.4vw,30px)] max-w-[52ch] animate-[wy-up_0.8s_0.16s_both] text-[clamp(16.5px,1.25vw,19px)] leading-[1.72] text-white/80">
            {hero.lead}
          </p>

          <div className="mt-[clamp(28px,3.2vw,40px)] flex animate-[wy-up_0.8s_0.26s_both] flex-wrap items-center gap-x-5.5 gap-y-4">
            <Button asChild variant="inverse" size="pillLg">
              <a href="#contato">
                <WhatsappLogoIcon size={20} weight="light" />
                {primaryCtaLabel}
              </a>
            </Button>
            <a
              href="#marcas"
              className="group inline-flex items-center gap-2.75 px-0.5 py-1.5 font-sans text-[15.5px] font-semibold text-white transition-[gap,color] duration-300 hover:gap-4 hover:text-sand focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-hidden"
            >
              {hero.secondaryCtaLabel}
              <ArrowRightIcon size={19} weight="light" />
            </a>
          </div>
        </div>

        {/* Figure column */}
        <div
          data-herofig
          className="relative flex min-h-[clamp(500px,80vh,780px)] min-w-72.5 flex-[1_1_350px] animate-[wy-fade_1.1s_0.2s_both] justify-center max-sm:min-h-0"
        >
          {/* Brand outline watermark (parallax layer) */}
          <img
            src="/images/outline-white.png"
            alt=""
            aria-hidden="true"
            data-par="24"
            width={900}
            height={900}
            className="pointer-events-none absolute top-[-4%] left-[-17%] w-[134%] max-w-none opacity-8 will-change-transform"
          />
          {/* Soft radial glow (parallax layer) */}
          <div
            aria-hidden="true"
            data-par="10"
            className="pointer-events-none absolute top-[6%] left-[13%] aspect-square w-[74%] bg-[radial-gradient(circle_at_50%_46%,rgba(255,255,255,.16),rgba(255,255,255,0)_62%)] will-change-transform"
          />
          {/* Photo — desktop crop with mobile swap below 640px */}
          <picture>
            <source
              media="(max-width:639px)"
              type="image/avif"
              srcSet="/images/carolina-desk-mobile.avif"
            />
            <source
              media="(max-width:639px)"
              type="image/webp"
              srcSet="/images/carolina-desk-mobile.webp"
            />
            <source
              media="(max-width:639px)"
              srcSet="/images/carolina-desk-mobile.png"
            />
            <source type="image/avif" srcSet="/images/carolina-desk.avif" />
            <source type="image/webp" srcSet="/images/carolina-desk.webp" />
            <img
              src="/images/carolina-desk.png"
              alt={hero.photoAlt}
              width={1200}
              height={1600}
              fetchPriority="high"
              decoding="async"
              className="pointer-events-none absolute bottom-[-1%] left-1/2 z-2 aspect-3/4 w-[min(112%,660px)] max-w-none -translate-x-1/2 max-sm:static max-sm:aspect-15/16 max-sm:translate-x-0"
            />
          </picture>
          {/* Floating badge */}
          <div className="absolute bottom-[34%] left-[-2%] z-3 flex animate-float items-center gap-3.25 rounded-[17px] bg-white/97 px-5 py-3 pl-3.75 shadow-[0_26px_46px_-22px_rgb(1_18_32/0.6)] max-sm:bottom-[30%] max-sm:left-2.5">
            <img
              src="/images/monogram-blue.png"
              alt=""
              aria-hidden="true"
              width={28}
              height={28}
              className="size-7 object-contain"
            />
            <div>
              <div className="font-sans text-[10px] leading-tight font-semibold tracking-[0.16em] text-muted uppercase">
                {hero.badgeLabel}
              </div>
              <div className="mt-0.75 font-sans text-[14.5px] leading-tight font-semibold text-navy">
                {hero.badgeValue}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom fade into paper */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 bottom-0 h-27.5 bg-linear-to-b from-transparent to-paper"
      />
    </section>
  )
}
