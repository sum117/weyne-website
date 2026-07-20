import type { ReactNode } from 'react'
import {
  InstagramLogo,
  LinkedinLogo,
  WhatsappLogo,
} from '@phosphor-icons/react/dist/ssr'
import { WaveDivider } from '@/features/landing/components/wave-divider'
import { resolveWhatsAppHref } from '@/features/landing/whatsapp'
import { KNOWN_PLACEHOLDERS } from '@/features/landing/content.schema'
import { siteConfig } from '@/features/landing/content'

const { footer, contactInfo, contact } = siteConfig
const whatsappHref = resolveWhatsAppHref(contactInfo.whatsappNumber)
const emailConfirmed = contactInfo.email !== KNOWN_PLACEHOLDERS.email
const emailHref = emailConfirmed ? `mailto:${contactInfo.email}` : '#contato'

function FooterHeading({ children }: { children: ReactNode }) {
  return (
    <div className="font-sans text-[11.5px] leading-none font-semibold tracking-[0.16em] text-sand uppercase">
      {children}
    </div>
  )
}

function Social({
  href,
  label,
  children,
}: {
  href: string
  label: string
  children: ReactNode
}) {
  return (
    <a
      href={href}
      aria-label={label}
      className="grid size-10.5 place-items-center rounded-[11px] border border-white/16 text-white transition duration-300 hover:border-sand hover:bg-sand hover:text-navy focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-navy focus-visible:outline-hidden"
    >
      {children}
    </a>
  )
}

export function SiteFooter() {
  return (
    <footer className="relative overflow-hidden bg-navy pt-[clamp(78px,9vw,116px)] pb-8.5 text-white">
      <WaveDivider
        variant="footerTop"
        edge="top"
        className="h-[clamp(44px,5.5vw,82px)]"
      />
      <div className="relative z-1 mx-auto max-w-300 px-[clamp(18px,5vw,48px)]">
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-8 gap-y-10 border-b border-white/12 pb-[clamp(40px,5vw,56px)]">
          {/* Brand */}
          <div className="max-w-75">
            <img
              src="/images/logo-horizontal-white.png"
              alt={footer.logoAlt}
              width={168}
              height={44}
              className="h-auto w-42"
            />
            <p className="mt-5 text-[14.5px] leading-[1.65] text-white/66">
              {footer.tagline}
            </p>
          </div>

          {/* Navigation */}
          <nav aria-label="Rodapé — navegação">
            <FooterHeading>{footer.navTitle}</FooterHeading>
            <div className="mt-4.5 flex flex-col gap-3">
              {footer.nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="text-[15px] text-white/75 transition duration-200 hover:text-white focus-visible:text-white"
                >
                  {item.label}
                </a>
              ))}
            </div>
          </nav>

          {/* Regions */}
          <div>
            <FooterHeading>{footer.regionsTitle}</FooterHeading>
            <div className="mt-4.5 flex flex-col gap-3 text-[15px] text-white/75">
              {footer.regions.map((region) => (
                <span key={region}>{region}</span>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div>
            <FooterHeading>{footer.contactTitle}</FooterHeading>
            <div className="mt-4.5 flex flex-col gap-3 text-[15px] text-white/75">
              <a
                href={whatsappHref}
                className="transition duration-200 hover:text-white focus-visible:text-white"
              >
                {contact.whatsappLabel}: {contactInfo.phoneDisplay}
              </a>
              <a
                href={emailHref}
                className="wrap-break-word transition duration-200 hover:text-white focus-visible:text-white"
              >
                {contactInfo.email}
              </a>
            </div>
            <div className="mt-5 flex gap-2.5">
              <Social href={whatsappHref} label="WhatsApp">
                <WhatsappLogo size={21} weight="light" />
              </Social>
              {contactInfo.instagramUrl && (
                <Social href={contactInfo.instagramUrl} label="Instagram">
                  <InstagramLogo size={21} weight="light" />
                </Social>
              )}
              {contactInfo.linkedinUrl && (
                <Social href={contactInfo.linkedinUrl} label="LinkedIn">
                  <LinkedinLogo size={21} weight="light" />
                </Social>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 pt-6.5 text-[13px] text-white/50">
          <span>{footer.copyright}</span>
          <span>CNPJ {contactInfo.cnpj}</span>
        </div>
      </div>
    </footer>
  )
}
