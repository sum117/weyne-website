import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { siteConfig } from '@/features/landing/content'
import {
  SECTION_IDS,
  validateContentIntegrity,
  validateProductionReadiness,
} from '@/features/landing/content.schema'

describe('content integrity', () => {
  it('has no integrity errors', () => {
    const errors = validateContentIntegrity(siteConfig).filter(
      (i) => i.level === 'error',
    )
    expect(errors).toEqual([])
  })

  it('has the exact required list counts', () => {
    expect(siteConfig.stats).toHaveLength(4)
    expect(siteConfig.differentiators.items).toHaveLength(6)
    expect(siteConfig.brands.items).toHaveLength(8)
    expect(siteConfig.segments.items).toHaveLength(7)
  })

  it('uses unique keys within each list', () => {
    const unique = (arr: ReadonlyArray<{ key: string }>) =>
      new Set(arr.map((i) => i.key)).size === arr.length
    expect(unique(siteConfig.stats)).toBe(true)
    expect(unique(siteConfig.differentiators.items)).toBe(true)
    expect(unique(siteConfig.brands.items)).toBe(true)
    expect(unique(siteConfig.segments.items)).toBe(true)
  })

  it('maps every nav anchor (header + footer) to a real section', () => {
    const targets = new Set<string>(SECTION_IDS)
    for (const item of [...siteConfig.nav, ...siteConfig.footer.nav]) {
      expect(targets.has(item.href.replace(/^#/, ''))).toBe(true)
    }
  })

  it('references brand logo assets that exist on disk', () => {
    for (const brand of siteConfig.brands.items) {
      expect(brand.logo.startsWith('/images/brands/')).toBe(true)
      const abs = resolve(process.cwd(), 'public', brand.logo.replace(/^\//, ''))
      expect(existsSync(abs), `missing ${brand.logo}`).toBe(true)
    }
  })
})

describe('production readiness (placeholder rejection)', () => {
  it('has no readiness errors — all contact data is confirmed', () => {
    const issues = validateProductionReadiness(siteConfig)
    // WhatsApp, phone, email, CNPJ, canonical, and OG image are all confirmed.
    expect(issues.filter((i) => i.level === 'error')).toEqual([])
    // Anything left is an optional social link, surfaced as a warning only.
    for (const issue of issues) expect(issue.level).toBe('warn')
  })

  it('passes production readiness when real values are supplied', () => {
    const ready = {
      ...siteConfig,
      contactInfo: {
        whatsappNumber: '5581999998888',
        phoneDisplay: '(81) 9 9999-8888',
        email: 'contato@weyne.com.br',
        cnpj: '12.345.678/0001-90',
        instagramUrl: 'https://instagram.com/weyne',
        linkedinUrl: 'https://linkedin.com/company/weyne',
      },
      seo: {
        ...siteConfig.seo,
        canonicalUrl: 'https://weyne.com.br/',
        ogImageAbsoluteUrl: 'https://weyne.com.br/og/weyne-home.jpg',
      },
    }
    const errors = validateProductionReadiness(ready).filter(
      (i) => i.level === 'error',
    )
    expect(errors).toEqual([])
  })
})
