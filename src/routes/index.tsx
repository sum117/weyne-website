import { createFileRoute } from '@tanstack/react-router'
import { LandingPage } from '@/features/landing/landing-page'
import { siteConfig } from '@/features/landing/content'

const { seo } = siteConfig

export const Route = createFileRoute('/')({
  head: () => ({
    meta: [
      { title: seo.title },
      { name: 'description', content: seo.description },
      { property: 'og:type', content: 'website' },
      { property: 'og:locale', content: 'pt_BR' },
      { property: 'og:site_name', content: siteConfig.siteName },
      { property: 'og:title', content: seo.title },
      { property: 'og:description', content: seo.description },
      ...(seo.ogImageAbsoluteUrl
        ? [
            { property: 'og:image', content: seo.ogImageAbsoluteUrl },
            { name: 'twitter:image', content: seo.ogImageAbsoluteUrl },
          ]
        : []),
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: seo.title },
      { name: 'twitter:description', content: seo.description },
    ],
    links: seo.canonicalUrl
      ? [{ rel: 'canonical', href: seo.canonicalUrl }]
      : [],
    scripts: seo.localBusinessJsonLd
      ? [
          {
            type: 'application/ld+json',
            children: JSON.stringify(seo.localBusinessJsonLd),
          },
        ]
      : [],
  }),
  component: LandingPage,
})
