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

  // `/app` is protected at the server-side route boundary: an unauthenticated
  // request is redirected before any protected markup or loader data is
  // produced. This smoke stack has no reachable database, so session
  // resolution also fails closed here — both paths land on the same redirect.
  const app = await request.get('/app', { maxRedirects: 0 })
  expect(app.status()).toBe(307)
  expect(app.headers()['location']).toBe('/entrar?redirect=%2Fapp')
  expect(await app.text()).not.toContain('data-server-rendered-at')

  const login = await request.get('/entrar')
  expect(login.status()).toBe(200)
  expect(login.headers()['content-type']).toContain('text/html')
  expect(cacheControl(login)).not.toMatch(immutableCache)
  const loginHtml = await login.text()
  expect(loginHtml).toContain('Entrar')
  expect(loginHtml).toContain('E-mail')
})

test('prerendered landing page hydrates its mobile menu', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/')

  await page.getByRole('button', { name: 'Menu' }).click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await expect(page.getByRole('dialog').getByRole('link').first()).toBeFocused()
})

test('direct application navigation is guarded before any protected render', async ({
  page,
}) => {
  const documentRequests: string[] = []
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documentRequests.push(request.url())
  })

  // The guard runs during SSR, so the browser is redirected to the login page
  // before the protected component ever renders.
  await page.goto('/app')
  await expect(page).toHaveURL(/\/entrar\?redirect=%2Fapp$/)
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible()
  await expect(page.locator('[data-server-rendered-at]')).toHaveCount(0)

  // Exactly two document navigations: the original request and the redirect
  // the server answered it with. Anything more would mean the client
  // re-requested a protected document after hydration.
  expect(documentRequests).toEqual([
    `${new URL('/app', page.url()).origin}/app`,
    `${new URL('/app', page.url()).origin}/entrar?redirect=%2Fapp`,
  ])

  // The login page hydrates: the controlled input accepts typing, and no
  // further document request is issued while it does.
  await page.getByLabel('E-mail').fill('sem-conta@example.test')
  await expect(page.getByLabel('E-mail')).toHaveValue('sem-conta@example.test')
  expect(documentRequests).toHaveLength(2)
})
