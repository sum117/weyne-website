import { Reveal } from '../components/reveal'
import { SectionEyebrow } from '../components/section-eyebrow'
import { BrandCard } from '../components/brand-card'
import { siteConfig } from '../content'

const { brands } = siteConfig

export function BrandsSection() {
  return (
    <section id="marcas" className="py-[clamp(84px,11vw,150px)]">
      <div className="mx-auto max-w-300 px-[clamp(18px,5vw,48px)]">
        <Reveal
          className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] items-end gap-x-[clamp(30px,5vw,70px)] gap-y-5"
          rise={24}
          fadeMs={900}
          riseMs={900}
        >
          <div>
            <SectionEyebrow tone="light">{brands.eyebrow}</SectionEyebrow>
            <h2 className="mt-[0.32em] font-display text-[clamp(30px,4.1vw,52px)] leading-[1.06] font-normal tracking-[-0.015em] text-navy">
              {brands.title}
            </h2>
          </div>
          <p className="max-w-[48ch] text-[clamp(15.5px,1.1vw,17px)] leading-[1.72] text-muted">
            {brands.lead}{' '}
            <span className="font-medium text-blue max-sm:hidden [@media(hover:none)]:hidden">
              {brands.hoverHint}
            </span>
          </p>
        </Reveal>

        <div className="mt-[clamp(38px,4.6vw,58px)] grid grid-cols-[repeat(auto-fit,minmax(232px,1fr))] gap-[clamp(14px,1.4vw,20px)]">
          {brands.items.map((brand, i) => (
            <Reveal key={brand.key} rise={24} delay={(i % 4) * 50}>
              <BrandCard brand={brand} />
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  )
}
