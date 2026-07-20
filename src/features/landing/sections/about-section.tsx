import { Reveal } from '../components/reveal'
import { SectionEyebrow } from '../components/section-eyebrow'
import { siteConfig } from '../content'

const { about } = siteConfig

export function AboutSection() {
  return (
    <section
      id="sobre"
      className="pt-[clamp(88px,11vw,150px)] pb-[clamp(72px,9vw,120px)]"
    >
      <div className="mx-auto grid max-w-300 grid-cols-[repeat(auto-fit,minmax(330px,1fr))] items-center gap-[clamp(40px,6vw,88px)] px-[clamp(18px,5vw,48px)]">
        {/* Left: heading + quote */}
        <Reveal rise={28} fadeMs={900} riseMs={900}>
          <SectionEyebrow tone="light">{about.eyebrow}</SectionEyebrow>
          <h2 className="mt-[0.34em] font-display text-[clamp(30px,3.9vw,50px)] leading-[1.08] font-normal tracking-[-0.015em] text-navy">
            {about.title}
          </h2>
          <p className="mt-6.5 max-w-[52ch] text-[clamp(16px,1.15vw,18px)] leading-[1.78] text-muted">
            {about.paragraph}
          </p>
          <blockquote className="mt-8.5 border-l-[3px] border-sand py-1.5 pl-6.5">
            <p className="max-w-[40ch] font-display text-[clamp(19px,1.7vw,24px)] leading-normal font-normal text-navy italic">
              {about.quote}
            </p>
          </blockquote>
        </Reveal>

        {/* Right: founder card */}
        <Reveal
          className="relative overflow-hidden rounded-[26px] border border-line bg-white p-[clamp(30px,3.6vw,50px)] shadow-founder"
          rise={28}
          fadeMs={1000}
          riseMs={1000}
          delay={100}
        >
          <img
            src="/images/monogram-sand.png"
            alt=""
            aria-hidden="true"
            width={180}
            height={180}
            className="w-45ity-50 pointer-events-none absolute -top-7.5 -right-7.5"
          />
          <div className="relative font-sans text-[11.5px] leading-none font-semibold tracking-[0.2em] text-blue uppercase">
            {about.founder.label}
          </div>
          <div className="relative mt-5.5 flex flex-col gap-4.25 text-[clamp(15px,1.08vw,16.5px)] leading-[1.75] text-[#3a5064]">
            {about.founder.paragraphs.map((para, i) => (
              <p key={i}>
                {para.map((run, j) =>
                  run.strong ? (
                    <strong key={j} className="font-semibold text-navy">
                      {run.text}
                    </strong>
                  ) : (
                    <span key={j}>{run.text}</span>
                  ),
                )}
              </p>
            ))}
          </div>
          <div className="relative mt-7 flex items-center gap-3.75 border-t border-line pt-6">
            <div className="grid size-12.5 shrink-0 place-items-center rounded-full border border-line bg-paper">
              <img
                src="/images/monogram-blue.png"
                alt=""
                aria-hidden="true"
                width={26}
                height={26}
                className="size-6.5 object-contain"
              />
            </div>
            <div>
              <div className="font-display text-[21px] leading-none text-navy">
                {about.founder.name}
              </div>
              <div className="mt-1.25 font-sans text-[12.5px] leading-none font-medium tracking-[0.03em] text-muted">
                {about.founder.role}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  )
}
