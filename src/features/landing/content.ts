import type { Icon } from '@phosphor-icons/react'
import {
  ArrowRight,
  Bed,
  Buildings,
  ChartLineUp,
  ChatsCircle,
  EnvelopeSimple,
  Factory,
  FirstAidKit,
  ForkKnife,
  GraduationCap,
  Handshake,
  InstagramLogo,
  Lightning,
  LinkedinLogo,
  MapPin,
  SealCheck,
  ShoppingCart,
  WashingMachine,
  WhatsappLogo,
} from '@phosphor-icons/react/dist/ssr'
import { publicEnv } from '../../lib/env'

/* ---------------------------------------------------------------------------
 * Types — the content contract consumed by the landing feature.
 * ------------------------------------------------------------------------- */

export type SectionId =
  | 'topo'
  | 'sobre'
  | 'diferenciais'
  | 'marcas'
  | 'segmentos'
  | 'contato'

export type NavItem = { label: string; href: `#${SectionId}` }

export type Stat = {
  key: string
  /** Static prefix glyph rendered at the same size as the number (e.g. "+"). */
  prefix?: string
  /** Count-up target and server-rendered final value. */
  value: number
  /** Two-line label; `\n` marks the intended break. */
  label: string
}

export type Differentiator = {
  key: string
  icon: Icon
  title: string
  body: string
}

export type Brand = {
  key: string
  /** Display name shown in the reveal overlay. */
  name: string
  /** Meaningful alt text for the logo image. */
  logoAlt: string
  /** Public path under /images/brands. */
  logo: string
  category: string
  /** Century Pro/Paper carry a small "marca Plestin" chip. */
  plestinBrand?: boolean
  /** Hand-balanced max render height (px) from the prototype. */
  logoMaxHeight: number
  /** Hand-balanced max render width (% of card) from the prototype. */
  logoMaxWidth: number
  description: string
}

export type Segment = { key: string; icon: Icon; label: string }

export type TextRun = { text: string; strong?: boolean }

export type SiteContact = {
  /** International WhatsApp number (digits or formatted). PUBLIC value. */
  whatsappNumber: string
  /** Human-readable phone shown in contact/footer. */
  phoneDisplay: string
  email: string
  cnpj: string
  instagramUrl?: string
  linkedinUrl?: string
}

export type LocalBusinessJsonLd = Record<string, unknown>

export type SeoConfig = {
  title: string
  description: string
  canonicalUrl?: string
  ogImageAbsoluteUrl?: string
  localBusinessJsonLd?: LocalBusinessJsonLd
}

export type LandingPageContent = {
  siteName: string
  wordmark: { primary: string; secondary: string }
  nav: ReadonlyArray<NavItem>
  primaryCtaLabel: string
  hero: {
    eyebrow: string
    /** Heading split so the emphasized run can be styled (sand italic). */
    titleLead: string
    titleEmphasis: string
    titleTrail: string
    lead: string
    secondaryCtaLabel: string
    photoAlt: string
    badgeLabel: string
    badgeValue: string
  }
  stats: ReadonlyArray<Stat>
  about: {
    eyebrow: string
    title: string
    paragraph: string
    quote: string
    founder: {
      label: string
      paragraphs: ReadonlyArray<ReadonlyArray<TextRun>>
      name: string
      role: string
    }
  }
  differentiators: {
    eyebrow: string
    title: string
    lead: string
    items: ReadonlyArray<Differentiator>
  }
  brands: {
    eyebrow: string
    title: string
    lead: string
    hoverHint: string
    items: ReadonlyArray<Brand>
  }
  segments: {
    eyebrow: string
    title: string
    lead: string
    subLabel: string
    items: ReadonlyArray<Segment>
  }
  contact: {
    eyebrow: string
    title: string
    lead: string
    whatsappLabel: string
    emailLabel: string
    regionsLabel: string
    regionsValue: string
    form: {
      title: string
      helper: string
      nameLabel: string
      namePlaceholder: string
      companyLabel: string
      companyPlaceholder: string
      messageLabel: string
      messagePlaceholder: string
      submitLabel: string
      submittingLabel: string
    }
  }
  footer: {
    logoAlt: string
    tagline: string
    navTitle: string
    nav: ReadonlyArray<NavItem>
    regionsTitle: string
    regions: ReadonlyArray<string>
    contactTitle: string
    copyright: string
  }
  floating: {
    whatsappLabel: string
    backToTopLabel: string
  }
  regions: ReadonlyArray<string>
  contactInfo: SiteContact
  seo: SeoConfig
}

/* ---------------------------------------------------------------------------
 * Launch configuration — the ONE place to update business values.
 *
 * Values marked PLACEHOLDER are rejected by `content.schema.ts` in production.
 * See scripts/check-content.ts and the maintenance guide in README.
 * ------------------------------------------------------------------------- */

const contactInfo: SiteContact = {
  // Confirmed by client (2026-07-20). Normalizes to 5581999964054.
  whatsappNumber: publicEnv.whatsappNumber ?? '+55 (81) 99996-4054',
  phoneDisplay: '+55 (81) 99996-4054',
  email: 'carolina@weynerepresentacoes.com.br',
  // Confirmed by client (2026-07-21).
  cnpj: '05.095.383/0001-42',
  // Not supplied — render as soft placeholder; remove only with approval.
  instagramUrl: undefined,
  linkedinUrl: undefined,
}

/**
 * Production origin (no trailing slash). Confirmed 2026-07-20 — the domain is
 * live on Cloudflare and this apex is the canonical home. `VITE_SITE_ORIGIN`
 * still overrides it (e.g. for a staging/preview deploy).
 */
const siteOrigin = publicEnv.siteOrigin ?? 'https://weynerepresentacoes.com.br'

const SEO_TITLE =
  'Weyne Representações — Relacionamento, conhecimento e soluções que geram resultados.'
const SEO_DESCRIPTION =
  'Representação comercial em higiene e limpeza profissional em PE, AL, PB e RN. Atendimento consultivo, marcas reconhecidas e soluções que geram resultados.'

/**
 * Structured data (schema.org). Built ONLY from client-confirmed facts —
 * business name, founder, the public WhatsApp/e-mail, and the states served.
 * CNPJ and a postal address are deliberately excluded until verified, so
 * nothing is invented for search engines.
 */
const socialProfiles = [
  contactInfo.instagramUrl,
  contactInfo.linkedinUrl,
].filter((url): url is string => Boolean(url))

const localBusinessJsonLd: LocalBusinessJsonLd = {
  '@context': 'https://schema.org',
  '@type': ['Organization', 'ProfessionalService'],
  '@id': `${siteOrigin}/#organization`,
  name: 'Weyne Representações',
  url: `${siteOrigin}/`,
  logo: `${siteOrigin}/icon-512.png`,
  image: `${siteOrigin}/og/weyne-home.jpg`,
  description: SEO_DESCRIPTION,
  slogan: 'Relacionamento, conhecimento e soluções que geram resultados.',
  email: contactInfo.email,
  // Confirmed WhatsApp line, in E.164.
  telephone: '+5581999964054',
  taxID: contactInfo.cnpj,
  founder: { '@type': 'Person', name: 'Carolina Weyne' },
  knowsLanguage: ['pt-BR'],
  areaServed: ['Pernambuco', 'Alagoas', 'Paraíba', 'Rio Grande do Norte'].map(
    (name) => ({ '@type': 'AdministrativeArea', name }),
  ),
  contactPoint: {
    '@type': 'ContactPoint',
    contactType: 'sales',
    telephone: '+5581999964054',
    email: contactInfo.email,
    areaServed: ['BR-PE', 'BR-AL', 'BR-PB', 'BR-RN'],
    availableLanguage: ['Portuguese'],
  },
  ...(socialProfiles.length ? { sameAs: socialProfiles } : {}),
}

const seo: SeoConfig = {
  title: SEO_TITLE,
  description: SEO_DESCRIPTION,
  canonicalUrl: `${siteOrigin}/`,
  ogImageAbsoluteUrl: `${siteOrigin}/og/weyne-home.jpg`,
  localBusinessJsonLd,
}

const REGIONS = [
  'Pernambuco',
  'Alagoas',
  'Paraíba',
  'Rio Grande do Norte',
] as const

/* ---------------------------------------------------------------------------
 * The immutable content object.
 * ------------------------------------------------------------------------- */

export const siteConfig: LandingPageContent = {
  siteName: 'Weyne Representações',
  wordmark: { primary: 'weyne', secondary: 'Representações' },
  nav: [
    { label: 'Sobre', href: '#sobre' },
    { label: 'Diferenciais', href: '#diferenciais' },
    { label: 'Marcas', href: '#marcas' },
    { label: 'Segmentos', href: '#segmentos' },
  ],
  primaryCtaLabel: 'Fale com um consultor',

  hero: {
    eyebrow: 'Representação comercial · Higiene profissional',
    titleLead: 'Relacionamento, conhecimento e soluções que ',
    titleEmphasis: 'geram resultados',
    titleTrail: '.',
    lead: 'Conectamos empresas às melhores marcas em higiene e limpeza profissional, com um atendimento consultivo, próximo e comprometido com resultados — em Pernambuco, Alagoas, Paraíba e Rio Grande do Norte.',
    secondaryCtaLabel: 'Conheça as marcas',
    photoAlt: 'Carolina Weyne, fundadora da Weyne Representações',
    badgeLabel: 'Atende',
    badgeValue: 'PE · AL · PB · RN',
  },

  stats: [
    { key: 'experiencia', value: 28, label: 'anos de experiência\nna área comercial' },
    { key: 'higiene', prefix: '+', value: 17, label: 'anos em higiene e\nlimpeza profissional' },
    { key: 'estados', value: 4, label: 'estados atendidos\nno Nordeste' },
    { key: 'marcas', value: 8, label: 'marcas industriais\nrepresentadas' },
  ],

  about: {
    eyebrow: 'Sobre a Weyne',
    title:
      'Nascemos para conectar empresas às melhores soluções em higiene profissional.',
    paragraph:
      'A Weyne Representações nasceu com o propósito de aproximar empresas das marcas mais confiáveis do mercado, por meio de um atendimento consultivo, próximo e comprometido com resultados.',
    quote:
      'Cada parceria é construída com seriedade, transparência e excelência — porque resultados consistentes começam com relacionamentos de confiança.',
    founder: {
      label: 'Palavra de quem representa',
      paragraphs: [
        [
          { text: 'Com ' },
          { text: '28 anos de experiência', strong: true },
          { text: ' na área comercial e mais de ' },
          { text: '17 anos', strong: true },
          {
            text: ' no segmento de higiene e limpeza profissional, construí uma trajetória baseada em confiança, relacionamento e conhecimento técnico.',
          },
        ],
        [
          {
            text: 'Represento marcas reconhecidas pela qualidade e inovação, sempre buscando soluções que agreguem valor aos negócios dos meus clientes. Atuo em Pernambuco, Alagoas, Paraíba e Rio Grande do Norte, atendendo distribuidores, indústrias, supermercados e empresas de diversos segmentos.',
          },
        ],
        [
          {
            text: 'Mais do que representar grandes marcas, meu compromisso é compreender cada necessidade e indicar a solução mais adequada para cada realidade — com suporte antes, durante e depois da venda.',
          },
        ],
      ],
      name: 'Carolina Weyne',
      role: 'Fundadora · Weyne Representações',
    },
  },

  differentiators: {
    eyebrow: 'Diferenciais',
    title: 'Por que escolher a Weyne Representações?',
    lead: 'Mais do que fornecer produtos, entregamos atendimento consultivo, relacionamento de confiança e soluções que geram resultados para o seu negócio.',
    items: [
      {
        key: 'consultivo',
        icon: ChatsCircle,
        title: 'Atendimento consultivo',
        body: 'Entendemos a realidade de cada cliente para indicar as soluções mais adequadas ao seu contexto.',
      },
      {
        key: 'relacionamento',
        icon: Handshake,
        title: 'Relacionamento próximo',
        body: 'Parcerias duradouras, construídas sobre confiança, transparência e disponibilidade real.',
      },
      {
        key: 'tecnico',
        icon: GraduationCap,
        title: 'Conhecimento técnico',
        body: 'Experiência e atualização constante para orientações seguras, precisas e eficientes.',
      },
      {
        key: 'marcas',
        icon: SealCheck,
        title: 'Marcas reconhecidas',
        body: 'Representamos empresas consolidadas, referência em qualidade, inovação e desempenho.',
      },
      {
        key: 'agilidade',
        icon: Lightning,
        title: 'Agilidade no atendimento',
        body: 'Respostas rápidas, acompanhamento contínuo e foco na melhor experiência do cliente.',
      },
      {
        key: 'resultados',
        icon: ChartLineUp,
        title: 'Compromisso com resultados',
        body: 'Geramos valor para o seu negócio, contribuindo para mais eficiência e produtividade.',
      },
    ],
  },

  brands: {
    eyebrow: 'Marcas representadas',
    title: 'Marcas que representamos com confiança',
    lead: 'Atuamos em parceria com indústrias reconhecidas pela qualidade, inovação e compromisso com seus clientes. Cada marca compartilha os valores que norteiam nosso trabalho — excelência, confiabilidade e foco em resultados.',
    hoverHint: 'Passe o cursor para conhecer cada uma.',
    items: [
      {
        key: 'total-clean',
        name: 'Total Clean',
        logoAlt: 'Total Clean',
        logo: '/images/brands/total-clean.png',
        category: 'Saneantes',
        logoMaxHeight: 70,
        logoMaxWidth: 74,
        description:
          'Indústria química de saneantes biodegradáveis e sustentáveis para os mercados institucional e doméstico.',
      },
      {
        key: 'life-clean',
        name: 'Life Clean',
        logoAlt: 'Life Clean',
        logo: '/images/brands/life-clean.png',
        category: 'Descartáveis',
        logoMaxHeight: 84,
        logoMaxWidth: 60,
        description:
          'Panos multiuso, embalagens e descartáveis para cozinha — papel alumínio, bandejas, filme PVC e panos de limpeza.',
      },
      {
        key: 'british',
        name: 'British',
        logoAlt: 'British',
        logo: '/images/brands/british.png',
        category: 'Abrasivos',
        logoMaxHeight: 52,
        logoMaxWidth: 74,
        description:
          'Maior fabricante de não tecido abrasivo do Brasil: fibras, esponjas e discos, exportando para mais de 25 países.',
      },
      {
        key: 'plestin',
        name: 'Plestin',
        logoAlt: 'Plestin',
        logo: '/images/brands/plestin.png',
        category: 'Dispensadores',
        logoMaxHeight: 60,
        logoMaxWidth: 72,
        description:
          'Dispensadores para higiene profissional — saboneteiras, toalheiros e papeleiras — com linha própria de químicos e refis.',
      },
      {
        key: 'century-pro',
        name: 'Century Pro',
        logoAlt: 'Century Pro',
        logo: '/images/brands/century-pro.png',
        category: 'Equipamentos',
        plestinBrand: true,
        logoMaxHeight: 56,
        logoMaxWidth: 70,
        description:
          'Equipamentos e acessórios para limpeza profissional: mops, baldes espremedores, carros de limpeza e microfibra.',
      },
      {
        key: 'century-paper',
        name: 'Century Paper',
        logoAlt: 'Century Paper',
        logo: '/images/brands/century-paper.png',
        category: 'Papéis',
        plestinBrand: true,
        logoMaxHeight: 72,
        logoMaxWidth: 74,
        description:
          'Papéis institucionais sustentáveis de alta performance — linhas Econômica, Tradicional e Premium.',
      },
      {
        key: 'kelldrin',
        name: 'Grupo Kelldrin',
        logoAlt: 'Grupo Kelldrin',
        logo: '/images/brands/kelldrin.png',
        category: 'Controle de pragas',
        logoMaxHeight: 58,
        logoMaxWidth: 80,
        description:
          'Soluções em higiene, limpeza e controle de pragas urbanas há mais de 20 anos — saúde animal, ambiental e humana.',
      },
      {
        key: 'bello-bella',
        name: 'Bello Bella Cosméticos',
        logoAlt: 'Bello Bella Cosméticos',
        logo: '/images/brands/bello-bella.png',
        category: 'Antissépticos',
        logoMaxHeight: 62,
        logoMaxWidth: 82,
        description:
          'Álcool antisséptico para mãos e superfícies — líquido e gel 46%, 70%, 80% e 92,8%, eliminando 99,9% de germes.',
      },
    ],
  },

  segments: {
    eyebrow: 'Segmentos',
    title: 'Atuação por meio de distribuidores parceiros',
    lead: 'Atuamos ao lado de distribuidores, conectando marcas reconhecidas a empresas de diversos segmentos. Nosso compromisso é fortalecer os parceiros comerciais com soluções de qualidade e suporte contínuo.',
    subLabel: 'As soluções representadas estão presentes em',
    items: [
      { key: 'hospitais', icon: FirstAidKit, label: 'Hospitais' },
      { key: 'hoteis', icon: Bed, label: 'Hotéis' },
      { key: 'industrias', icon: Factory, label: 'Indústrias' },
      { key: 'lavanderias', icon: WashingMachine, label: 'Lavanderias' },
      { key: 'supermercados', icon: ShoppingCart, label: 'Supermercados' },
      { key: 'food-service', icon: ForkKnife, label: 'Food service' },
      { key: 'empresas', icon: Buildings, label: 'Empresas e instituições' },
    ],
  },

  contact: {
    eyebrow: 'Contato',
    title: 'Pronto para encontrar as melhores soluções?',
    lead: 'Fale com a Weyne Representações e receba um atendimento consultivo, próximo e sob medida para o seu negócio.',
    whatsappLabel: 'WhatsApp',
    emailLabel: 'E-mail',
    regionsLabel: 'Regiões atendidas',
    regionsValue: REGIONS.join(' · '),
    form: {
      title: 'Solicite um contato',
      helper: 'Preencha os campos e retornamos o mais breve possível.',
      nameLabel: 'Nome',
      namePlaceholder: 'Seu nome',
      companyLabel: 'Empresa',
      companyPlaceholder: 'Nome da empresa',
      messageLabel: 'Mensagem',
      messagePlaceholder: 'Como podemos ajudar?',
      submitLabel: 'Enviar pelo WhatsApp',
      submittingLabel: 'Abrindo o WhatsApp…',
    },
  },

  footer: {
    logoAlt: 'Weyne Representações',
    tagline:
      'Relacionamento, conhecimento e soluções que geram resultados em higiene e limpeza profissional.',
    navTitle: 'Navegação',
    nav: [
      { label: 'Sobre a Weyne', href: '#sobre' },
      { label: 'Diferenciais', href: '#diferenciais' },
      { label: 'Marcas representadas', href: '#marcas' },
      { label: 'Segmentos', href: '#segmentos' },
    ],
    regionsTitle: 'Regiões',
    regions: REGIONS,
    contactTitle: 'Contato',
    copyright: '© 2026 Weyne Representações. Todos os direitos reservados.',
  },

  floating: {
    whatsappLabel: 'Fale conosco no WhatsApp',
    backToTopLabel: 'Voltar ao topo',
  },

  regions: REGIONS,
  contactInfo,
  seo,
}

/* Icon references used outside the content items (CTAs, rows, socials). */
export const uiIcons = {
  whatsapp: WhatsappLogo,
  email: EnvelopeSimple,
  mapPin: MapPin,
  instagram: InstagramLogo,
  linkedin: LinkedinLogo,
  arrowRight: ArrowRight,
} as const
