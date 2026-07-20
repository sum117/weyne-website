import { Reveal } from '../components/reveal'
import { SectionEyebrow } from '../components/section-eyebrow'
import { IconTile } from '../components/icon-tile'
import { siteConfig } from '../content'

const { differentiators } = siteConfig

export function DifferentiatorsSection() {
  return (
    <section
      id="diferenciais"
      className="relative border-y border-line bg-white py-[clamp(84px,11vw,140px)]"
    >
      <div className="mx-auto max-w-300 px-[clamp(18px,5vw,48px)]">
        <Reveal className="max-w-190" rise={24} fadeMs={900} riseMs={900}>
          <SectionEyebrow tone="light">{differentiators.eyebrow}</SectionEyebrow>
          <h2 className="mt-[0.32em] font-display text-[clamp(30px,4.1vw,52px)] leading-[1.06] font-normal tracking-[-0.015em] text-navy">
            {differentiators.title}
          </h2>
          <p className="mt-5.5 max-w-[56ch] text-[clamp(16px,1.15vw,18px)] leading-[1.72] text-muted">
            {differentiators.lead}
          </p>
        </Reveal>

        <div className="mt-[clamp(40px,5vw,64px)] grid grid-cols-[repeat(auto-fit,minmax(290px,1fr))] gap-[clamp(16px,1.6vw,22px)]">
          {differentiators.items.map((item, i) => {
            const Icon = item.icon
            return (
              <Reveal key={item.key} className="h-full" rise={26} delay={(i % 3) * 60}>
                <article className="group relative h-full overflow-hidden rounded-[22px] border border-line bg-white p-[clamp(28px,2.6vw,36px)] transition-[translate,box-shadow,border-color] duration-500 ease-house hover:-translate-y-2 hover:border-transparent hover:shadow-card-hover">
                  <span
                    aria-hidden="true"
                    className="absolute top-5.5 right-6.5 font-display text-[34px] text-[rgb(3_79_131/0.18)] transition-colors duration-500 group-hover:text-sand"
                  >
                    {String(i + 1).padStart(2, '0')}
                  </span>
                  <IconTile
                    size="md"
                    className="group-hover:bg-blue group-hover:text-white"
                  >
                    <Icon size={31} weight="light" />
                  </IconTile>
                  <h3 className="mt-6 font-sans text-[20px] leading-tight font-semibold text-navy">
                    {item.title}
                  </h3>
                  <p className="mt-2.75 text-[15px] leading-[1.66] text-muted">
                    {item.body}
                  </p>
                </article>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}
