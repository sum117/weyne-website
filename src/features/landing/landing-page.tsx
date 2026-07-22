import { SiteHeader } from '@/components/site/site-header'
import { SiteFooter } from '@/components/site/site-footer'
import { FloatingActions } from '@/components/site/floating-actions'
import { HeroSection } from './sections/hero-section'
import { StatsSection } from './sections/stats-section'
import { AboutSection } from './sections/about-section'
import { DifferentiatorsSection } from './sections/differentiators-section'
import { BrandsSection } from './sections/brands-section'
import { SegmentsSection } from './sections/segments-section'
import { ContactSection } from './sections/contact-section'

export function LandingPage() {
  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:absolute focus:top-4 focus:left-4 focus:z-skip focus:rounded-lg focus:bg-navy focus:px-4 focus:py-2 focus:font-medium focus:text-white focus:ring-2 focus:ring-baltic focus:outline-hidden"
      >
        Ir para o conteúdo
      </a>
      <SiteHeader />
      <main id="conteudo">
        <HeroSection />
        <StatsSection />
        <AboutSection />
        <DifferentiatorsSection />
        <BrandsSection />
        <SegmentsSection />
        <ContactSection />
      </main>
      <SiteFooter />
      <FloatingActions />
    </>
  )
}
