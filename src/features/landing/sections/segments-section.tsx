import { Reveal } from '../components/reveal'
import { SectionEyebrow } from '../components/section-eyebrow'
import { WaveDivider } from '../components/wave-divider'
import { siteConfig } from '../content'

const { segments } = siteConfig

export function SegmentsSection() {
  return (
    <section
      id="segmentos"
      className="relative overflow-hidden py-[clamp(84px,11vw,140px)] text-white bg-segments-gradient"
    >
      <WaveDivider variant="segTop" edge="top" className="h-[clamp(46px,6vw,92px)]" />
      <WaveDivider
        variant="segBottom"
        edge="bottom"
        className="h-[clamp(46px,6vw,92px)]"
      />

      {/* Decorative flowing curves */}
      <svg
        viewBox="0 0 1440 520"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 size-full"
      >
        <path
          d="M-60,160 C300,350 560,30 880,210 S1420,310 1680,160"
          fill="none"
          stroke="rgba(255,255,255,.11)"
          strokeWidth="1.4"
        />
        <path
          d="M-60,262 C320,452 600,132 920,312 S1460,412 1720,262"
          fill="none"
          stroke="rgba(255,255,255,.06)"
          strokeWidth="1.4"
        />
      </svg>

      {/* Giant monogram watermark */}
      <img
        src="/images/monogram-white.png"
        alt=""
        aria-hidden="true"
        width={520}
        height={520}
        className="pointer-events-none absolute right-[-6%] bottom-[-14%] w-[min(46vw,520px)] opacity-5"
      />

      <div className="relative z-2 mx-auto max-w-300 px-[clamp(18px,5vw,48px)]">
        <Reveal className="max-w-180" rise={24} fadeMs={900} riseMs={900}>
          <SectionEyebrow tone="dark">{segments.eyebrow}</SectionEyebrow>
          <h2 className="mt-[0.32em] font-display text-[clamp(29px,3.9vw,50px)] leading-[1.08] font-normal tracking-[-0.015em] text-white">
            {segments.title}
          </h2>
          <p className="mt-5.5 max-w-[60ch] text-[clamp(16px,1.15vw,18px)] leading-[1.72] text-white/78">
            {segments.lead}
          </p>
        </Reveal>

        <div className="mt-3.5 pt-[clamp(30px,4vw,48px)] font-sans text-[12px] leading-none font-semibold tracking-[0.16em] text-sand uppercase">
          {segments.subLabel}
        </div>

        <div className="mt-5.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-3.5">
          {segments.items.map((item, i) => {
            const Icon = item.icon
            return (
              <Reveal
                key={item.key}
                className="h-full"
                rise={22}
                fadeMs={700}
                riseMs={700}
                delay={i * 40}
              >
                <div className="flex h-full flex-col items-center gap-3.5 rounded-[18px] border border-white/10 bg-white/5 px-4 py-7.5 text-center transition-[background-color,translate] duration-400 ease-house hover:-translate-y-1 hover:bg-white/10">
                  <Icon size={34} weight="light" className="text-sand" />
                  <span className="font-sans text-[14.5px] leading-none font-medium">
                    {item.label}
                  </span>
                </div>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
