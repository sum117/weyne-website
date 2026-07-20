import { Reveal } from '../components/reveal'
import { CountUp } from '../components/count-up'
import { siteConfig } from '../content'

const { stats } = siteConfig

export function StatsSection() {
  return (
    <div className="relative z-5 mx-auto -mt-18 max-w-300 px-[clamp(18px,5vw,48px)] max-sm:-mt-11">
      <Reveal
        className="grid grid-cols-[repeat(auto-fit,minmax(190px,1fr))] overflow-hidden rounded-3xl border border-line bg-white shadow-band *:border-r *:border-line max-sm:*:border-r-0 max-sm:*:border-b [&>*:last-child]:border-r-0 max-sm:[&>*:last-child]:border-b-0"
        rise={28}
        fadeMs={900}
        riseMs={900}
      >
        {stats.map((stat) => (
          <div
            key={stat.key}
            className="px-[clamp(20px,3vw,40px)] py-8.5 text-center"
          >
            <div className="flex items-baseline justify-center gap-1 font-display leading-none font-normal text-blue">
              <CountUp
                value={stat.value}
                prefix={stat.prefix}
                className="text-[clamp(44px,4.6vw,60px)]"
              />
            </div>
            <div className="mt-3 font-sans text-[14.5px] leading-[1.45] font-medium whitespace-pre-line text-muted">
              {stat.label}
            </div>
          </div>
        ))}
      </Reveal>
    </div>
  )
}
