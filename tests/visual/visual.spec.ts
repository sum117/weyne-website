import { expect, test, type Page } from '@playwright/test'

const viewports = {
  desktop: { width: 1440, height: 1000 },
  tablet: { width: 1024, height: 900 },
  mobile: { width: 390, height: 844 },
} as const
const fixtureUrl = 'http://localhost:3201/tests/visual/fixture.html'

async function stabilize(page: Page) {
  await page.addStyleTag({ content: '*,*::before,*::after{animation-delay:0s!important;animation-duration:0s!important;transition:none!important} html{scroll-behavior:auto!important}' })
  await page.evaluate(async () => {
    document.documentElement.setAttribute('data-reveal-fallback', '')
    await document.fonts.ready
  })
  await expect(page.locator('body')).toBeVisible()
}

async function open(page: Page, path: string, viewport: keyof typeof viewports) {
  await page.setViewportSize(viewports[viewport])
  await page.goto(path, { waitUntil: 'networkidle' })
  await stabilize(page)
}

for (const viewport of ['desktop', 'tablet', 'mobile'] as const) {
  test(`public landing — ${viewport}`, async ({ page }) => {
    await open(page, '/', viewport)
    await expect(page).toHaveScreenshot(`landing-${viewport}.png`, { fullPage: true })
  })
}

test('public landing — mobile navigation sheet', async ({ page }) => {
  await open(page, `${fixtureUrl}?surface=menu`, 'mobile')
  await page.getByRole('button', { name: 'Menu' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toBeVisible()
  await expect(page).toHaveScreenshot('landing-mobile-menu.png')
})

for (const viewport of ['desktop', 'mobile'] as const) {
  test(`authenticated catalog — ${viewport}`, async ({ page }) => {
    await open(page, `${fixtureUrl}?surface=catalog`, viewport)
    await expect(page).toHaveScreenshot(`app-catalog-${viewport}.png`, { fullPage: true })
  })
}

test('authenticated archive dialog', async ({ page }) => {
  await open(page, `${fixtureUrl}?surface=client`, 'tablet')
  await page.getByRole('button', { name: 'Arquivar cliente' }).click()
  await expect(page.getByRole('alertdialog')).toBeVisible()
  await expect(page).toHaveScreenshot('app-client-archive-dialog.png', { fullPage: true })
})

test('authenticated quote detail — desktop', async ({ page }) => {
  await open(page, `${fixtureUrl}?surface=quote`, 'desktop')
  await expect(page).toHaveScreenshot('app-quote-desktop.png', { fullPage: true })
})

for (const viewport of ['tablet', 'mobile'] as const) {
  test(`forms, chart, and files — ${viewport}`, async ({ page }) => {
    await open(page, `${fixtureUrl}?surface=controls`, viewport)
    await expect(page).toHaveScreenshot(`app-controls-${viewport}.png`, { fullPage: true })
  })
}

test('loading, empty, and error matrix', async ({ page }) => {
  await open(page, `${fixtureUrl}?surface=states`, 'desktop')
  await expect(page).toHaveScreenshot('app-states-desktop.png', { fullPage: true })
})