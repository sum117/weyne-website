import type { ReactNode } from 'react'
import type { Icon } from '@phosphor-icons/react'
import { EnvelopeSimpleIcon, MapPinIcon, WhatsappLogoIcon } from '@phosphor-icons/react/dist/ssr'
import { Reveal } from '../components/reveal'
import { SectionEyebrow } from '../components/section-eyebrow'
import { IconTile } from '../components/icon-tile'
import { ContactForm } from '../components/contact-form'
import {
  CONTACT_FORM_ANCHOR,
  DEFAULT_WHATSAPP_MESSAGE,
  buildWhatsAppUrl,
  isUsableWhatsAppNumber,
} from '../whatsapp'
import { KNOWN_PLACEHOLDERS } from '../content.schema'
import { siteConfig } from '../content'

const { contact, contactInfo } = siteConfig

// Links only when the value is real; otherwise a non-clickable placeholder.
const whatsappHref = isUsableWhatsAppNumber(contactInfo.whatsappNumber)
  ? buildWhatsAppUrl(contactInfo.whatsappNumber, DEFAULT_WHATSAPP_MESSAGE)
  : undefined
const emailConfirmed =
  contactInfo.email !== KNOWN_PLACEHOLDERS.email &&
  !/PREENCHER/i.test(contactInfo.email)
const emailHref = emailConfirmed ? `mailto:${contactInfo.email}` : undefined

type RowProps = {
  icon: Icon
  label: string
  href?: string
  children: ReactNode
}

function ContactRow({ icon: RowIcon, label, href, children }: RowProps) {
  const inner = (
    <>
      <IconTile size="sm">
        <RowIcon size={24} weight="light" />
      </IconTile>
      <span className="min-w-0">
        <span className="block font-sans text-[11px] leading-none font-semibold tracking-[0.14em] text-muted uppercase">
          {label}
        </span>
        {children}
      </span>
    </>
  )

  const base =
    'flex items-center gap-4 rounded-2xl border border-line bg-white px-5.5 py-4.5'

  if (!href) return <div className={base}>{inner}</div>

  return (
    <a
      href={href}
      className={`${base} group transition-[border-color,translate] duration-350 ease-house hover:translate-x-1 hover:border-baltic focus-visible:ring-2 focus-visible:ring-baltic focus-visible:ring-offset-2 focus-visible:ring-offset-paper focus-visible:outline-hidden`}
    >
      {inner}
    </a>
  )
}

export function ContactSection() {
  return (
    <section id="contato" className="py-[clamp(84px,11vw,150px)]">
      <div className="mx-auto grid max-w-300 grid-cols-[repeat(auto-fit,minmax(320px,1fr))] items-start gap-[clamp(36px,5vw,72px)] px-[clamp(18px,5vw,48px)]">
        {/* Left: heading + contact rows */}
        <Reveal rise={26} fadeMs={900} riseMs={900}>
          <SectionEyebrow tone="light">{contact.eyebrow}</SectionEyebrow>
          <h2 className="mt-[0.3em] max-w-[16ch] font-display text-[clamp(30px,4.1vw,52px)] leading-[1.05] font-normal tracking-[-0.015em] text-navy">
            {contact.title}
          </h2>
          <p className="mt-5.5 max-w-[46ch] text-[clamp(16px,1.15vw,18px)] leading-[1.72] text-muted">
            {contact.lead}
          </p>

          <div className="mt-8.5 flex flex-col gap-3">
            <ContactRow icon={WhatsappLogoIcon} label={contact.whatsappLabel} href={whatsappHref}>
              <span className="mt-1.25 block font-sans text-[17px] leading-none font-semibold text-navy">
                {contactInfo.phoneDisplay}
              </span>
            </ContactRow>

            <ContactRow icon={EnvelopeSimpleIcon} label={contact.emailLabel} href={emailHref}>
              <span className="mt-1.25 block font-sans text-[clamp(13px,3.5vw,17px)] leading-tight font-semibold wrap-anywhere text-navy">
                {contactInfo.email}
              </span>
            </ContactRow>

            <ContactRow icon={MapPinIcon} label={contact.regionsLabel}>
              <span className="mt-1.25 block font-sans text-[17px] leading-tight font-semibold text-navy">
                {contact.regionsValue}
              </span>
            </ContactRow>
          </div>
        </Reveal>

        {/* Right: form card */}
        <Reveal
          id={CONTACT_FORM_ANCHOR.slice(1)}
          className="relative overflow-hidden rounded-[26px] p-[clamp(30px,3.6vw,46px)] text-white shadow-form bg-card-gradient"
          rise={26}
          fadeMs={1000}
          riseMs={1000}
          delay={100}
        >
          <img
            src="/images/monogram-white.png"
            alt=""
            aria-hidden="true"
            width={150}
            height={150}
            className="pointer-events-none absolute -top-6 -right-6 w-37.5 opacity-8"
          />
          <div className="relative font-display text-[clamp(22px,2vw,27px)] leading-[1.2]">
            {contact.form.title}
          </div>
          <p className="relative mt-2 mb-6.5 text-[14.5px] leading-[1.6] text-white/70">
            {contact.form.helper}
          </p>
          <ContactForm />
        </Reveal>
      </div>
    </section>
  )
}
