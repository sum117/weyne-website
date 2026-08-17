import { expect, test } from '@playwright/test'

const immutableCache = /(?:^|,)\s*immutable(?:,|$)/i
const hashedAsset = /^\/assets\/.+-[A-Za-z0-9_-]{8,}\.(?:css|js)$/

function cacheControl(response: { headers(): Record<string, string> }): string {
  return response.headers()['cache-control'] ?? ''
}

test('production stack serves prerendered, healthy, cache-safe responses', async ({
  request,
}) => {
  const health = await request.get('/healthz')
  expect(health.status()).toBe(200)
  expect(await health.json()).toEqual({ status: 'ok' })
  expect(cacheControl(health)).toContain('no-store')

  const home = await request.get('/')
  expect(home.status()).toBe(200)
  expect(home.headers()['content-type']).toContain('text/html')
  expect(cacheControl(home)).not.toMatch(immutableCache)
  const html = await home.text()
  expect(html).toMatch(/<!doctype html>/i)
  expect(html).toContain('data-hero="true"')
  expect(html).toContain('Relacionamento, conhecimento e soluções')

  const assets = [...new Set(html.match(/\/assets\/[A-Za-z0-9_.-]+\.(?:css|js)/g) ?? [])]
  expect(assets.length).toBeGreaterThan(0)
  for (const asset of assets) {
    expect(asset).toMatch(hashedAsset)
    const response = await request.get(asset)
    expect(response.status(), asset).toBe(200)
    expect(cacheControl(response), asset).toMatch(immutableCache)
  }

  const app = await request.get('/app')
  expect(app.status()).toBe(200)
  expect(app.headers()['content-type']).toContain('text/html')
  expect(cacheControl(app)).not.toMatch(immutableCache)
  const appHtml = await app.text()
  expect(appHtml).toContain('Área de gestão')
  expect(appHtml).toContain('data-server-rendered-at=')
})

test('prerendered landing page hydrates its mobile menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('link').first()).toBeFocused()
})

test('direct application navigation SSRs and hydrates client routing', async ({ page }) => {
  const documentRequests: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentRequests.push(request.url())
  })

  await page.goto('/app')
  await expect(page.getByRole('heading', { name: 'Weyne Representações' })).toBeVisible()
  await expect(page.locator('[data-server-rendered-at]')).toBeVisible()

  await page.getByRole('link', { name: 'Voltar ao site institucional' }).click()
  await expect(page).toHaveURL(/\/$/)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  expect(documentRequests).toHaveLength(1)
})
