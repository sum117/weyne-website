import { test, expect } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { siteConfig } from '../../src/features/landing/content'
import { SECTION_IDS } from '../../src/features/landing/content.schema'
import {
  buildLeadMessage,
  buildWhatsAppUrl,
  normalizeWhatsAppNumber,
} from '../../src/features/landing/whatsapp'

/**
 * Smoke suite for the prerendered site as a static host serves it
 * (dist/client via scripts/serve-dist.ts — see playwright.config.ts).
 *
 * Assertions are driven by the typed content config, so copy edits in
 * content.ts never break tests — only broken contracts do: prerendered HTML,
 * the no-JS guarantee, the wa.me URL contract, and accessibility.
 */

const digits = normalizeWhatsAppNumber(siteConfig.contactInfo.whatsappNumber)
const formCopy = siteConfig.contact.form
const reflowViewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 768, height: 1024 },
  { width: 430, height: 932 },
  { width: 390, height: 844 },
  { width: 360, height: 800 },
  { width: 320, height: 800 },
] as const

test('prerendered document carries the SEO head contract', async ({ page }) => {
  await page.goto('/')

  await expect(page).toHaveTitle(siteConfig.seo.title)
  await expect(page.locator('html')).toHaveAttribute('lang', 'pt-BR')

  const canonical = page.locator('link[rel="canonical"]')
  await expect(canonical).toHaveAttribute('href', siteConfig.seo.canonicalUrl!)

  const jsonLd = page.locator('script[type="application/ld+json"]')
  const parsed = JSON.parse((await jsonLd.first().textContent()) ?? '{}')
  expect(parsed['@type']).toContain('Organization')
  expect(parsed.telephone).toBe(`+${digits}`)
})

test('renders every section and the hero without JavaScript', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')

  // The reveal-boot script never ran, so the hide rule must not apply.
  await expect(page.locator('html')).not.toHaveAttribute('data-js', '')

  await expect(page.locator('h1')).toContainText(siteConfig.hero.titleEmphasis)
  for (const id of SECTION_IDS) {
    await expect(page.locator(`#${id}`), `section #${id}`).toBeVisible()
  }
  // Count-ups must ship their final value in the prerendered HTML.
  for (const stat of siteConfig.stats) {
    await expect(page.locator('body')).toContainText(String(stat.value))
  }

  await context.close()
})

test('hydrates: reveal boot flag set and nav is usable', async ({ page }) => {
  await page.goto('/')

  await expect(page.locator('html')).toHaveAttribute('data-js', '')
  const nav = page.getByRole('navigation').first()
  for (const item of siteConfig.nav) {
    await expect(nav.getByRole('link', { name: item.label })).toHaveAttribute(
      'href',
      item.href,
    )
  }
})

test('reflows without page-level horizontal overflow at every canonical width', async ({
  page,
}) => {
  for (const viewport of reflowViewports) {
    await page.setViewportSize(viewport)
    await page.goto('/')
    await expect(page.locator('html')).toHaveAttribute('data-js', '')

    const overflow = await page.evaluate(() => {
      const clientWidth = document.documentElement.clientWidth
      const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
        .map((element) => {
          const bounds = element.getBoundingClientRect()
          return {
            element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}`,
            classes: element.className.toString().slice(0, 160),
            left: Math.round(bounds.left),
            right: Math.round(bounds.right),
          }
        })
        .filter(({ left, right }) => left < 0 || right > clientWidth)
        .slice(0, 10)

      return {
        clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        offenders,
      }
    })
    expect(
      overflow.scrollWidth,
      `${viewport.width}px overflow candidates: ${JSON.stringify(overflow.offenders)}`,
    ).toBe(overflow.clientWidth)
  }
})

test('every WhatsApp CTA follows the wa.me contract', async ({ page }) => {
  await page.goto('/')

  const links = page.locator('a[href*="wa.me"]')
  const count = await links.count()
  expect(count).toBeGreaterThanOrEqual(1)
  for (let i = 0; i < count; i++) {
    const href = await links.nth(i).getAttribute('href')
    expect(href).toMatch(
      new RegExp(`^https://wa\\.me/${digits}\\?text=`),
    )
  }
})

test('lead form composes the WhatsApp message from its fields', async ({
  page,
}) => {
  // Stub window.open so the test stays hermetic — no external navigation.
  await page.addInitScript(() => {
    const opened: string[] = []
    ;(window as Window & { __opened?: string[] }).__opened = opened
    window.open = (url?: string | URL) => {
      opened.push(String(url))
      return null
    }
  })
  await page.goto('/#contato')

  const lead = {
    nome: 'Ana Silva',
    empresa: 'Hotel Recife',
    mensagem: 'Gostaria de um orçamento para o hotel.',
  }
  await page.getByLabel(formCopy.nameLabel).fill(lead.nome)
  await page.getByLabel(formCopy.companyLabel).fill(lead.empresa)
  await page.getByLabel(formCopy.messageLabel).fill(lead.mensagem)
  await page.getByRole('button', { name: formCopy.submitLabel }).click()

  await expect
    .poll(async () =>
      page.evaluate(() => (window as Window & { __opened?: string[] }).__opened),
    )
    .toEqual([buildWhatsAppUrl(digits, buildLeadMessage(lead))])
})

test('lead form surfaces validation instead of opening WhatsApp', async ({
  page,
}) => {
  await page.goto('/#contato')

  await page.getByRole('button', { name: formCopy.submitLabel }).click()
  await expect(page.getByText('Informe seu nome')).toBeVisible()
})

test('has no serious or critical accessibility violations', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/')
  await expect(page.locator('html')).toHaveAttribute('data-js', '')

  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  )
  expect(
    blocking.map((v) => `${v.id}: ${v.nodes.length}×`),
  ).toEqual([])
})
