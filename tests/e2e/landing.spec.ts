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
