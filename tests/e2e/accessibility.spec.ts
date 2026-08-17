import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { siteConfig } from '../../src/features/landing/content'

const blockingImpacts = new Set(['serious', 'critical'])

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations
    .filter((violation) => blockingImpacts.has(violation.impact ?? ''))
    .map((violation) => ({
      id: violation.id,
      impact: violation.impact,
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }))

  expect(blocking).toEqual([])
}

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
      await route.continue()
    } else {
      await route.abort('blockedbyclient')
    }
  })
})

test('public landing and validation errors have no blocking axe violations', async ({
  page,
}) => {
  await page.goto('/#contato')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await page
    .getByRole('button', { name: siteConfig.contact.form.submitLabel })
    .click()
  await expect(page.getByText('Informe seu nome')).toBeVisible()

  await expectNoBlockingAxeViolations(page)
})

test('mobile navigation sheet is accessible and restores focus', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  const trigger = page.getByRole('button', { name: 'Menu' })
  await trigger.focus()
  await trigger.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Menu de navegação' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('link').first()).toBeFocused()
  await expectNoBlockingAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('management SSR foundation has no blocking axe violations', async ({ page }) => {
  await page.goto('/app')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Weyne Representações' }),
  ).toBeVisible()

  await expectNoBlockingAxeViolations(page)
})

test('product catalog empty state has no blocking axe violations', async ({ page }) => {
  await page.goto('/app/produtos')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Produtos' }),
  ).toBeVisible()
  await expect(page.getByRole('status')).toContainText('Nenhum produto cadastrado.')

  await expectNoBlockingAxeViolations(page)
})

test('report table empty state and tab flow are accessible', async ({ page }) => {
  await page.goto('/app/relatorios')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Relatórios' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Vendas por cliente', exact: true })).toContainText(
    'Nenhum resultado',
  )

  const productsTab = page.getByRole('tab', { name: 'Vendas por produto' })
  await productsTab.focus()
  await productsTab.press('Enter')
  await expect(productsTab).toHaveAttribute('aria-selected', 'true')
  await expect(page).toHaveURL(/(?:\?|&)tab=produtos(?:&|$)/)
  await expect(page.getByRole('region', { name: 'Vendas por produto', exact: true })).toContainText(
    'Nenhum resultado',
  )

  await expectNoBlockingAxeViolations(page)
})
