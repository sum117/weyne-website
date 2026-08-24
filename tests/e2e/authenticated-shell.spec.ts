import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import {
  AUTHENTICATED_SHELL_BASE_URL,
  AUTHENTICATED_SHELL_USERS,
} from './authenticated-shell.fixture'

const blockingImpacts = new Set(['serious', 'critical'])
const canonicalViewports = [
  { width: 1440, height: 1000 },
  { width: 1024, height: 900 },
  { width: 390, height: 844 },
] as const

async function signIn(page: Page, user: (typeof AUTHENTICATED_SHELL_USERS)[keyof typeof AUTHENTICATED_SHELL_USERS]) {
  await page.goto('/entrar')
  await page.getByLabel('E-mail').fill(user.email)
  await page.getByLabel('Senha').fill(user.password)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page).toHaveURL('/app')
}

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

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBe(overflow.clientWidth)
}

test('authenticated nested routes retain the shell after direct load and reload', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize(canonicalViewports[0])
  await page.goto('/app/produtos')

  await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()
  await expect(page.locator('[data-app-shell-sidebar]')).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Navegação principal do aplicativo' })).toBeVisible()
  await expect(page.getByRole('navigation', { name: 'Localização atual' })).toContainText('Produtos')
  await expect(page.getByRole('button', { name: /Abrir menu da conta de Ana Administradora/ })).toBeVisible()
  await expectNoBlockingAxeViolations(page)

  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Produtos' })).toBeVisible()

  for (const viewport of canonicalViewports) {
    await page.setViewportSize(viewport)
    await expectNoPageOverflow(page)
  }
})

test('the mobile Sheet is keyboard-operated and restores focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app')

  const trigger = page.getByRole('button', { name: 'Abrir navegação' })
  await trigger.focus()
  await trigger.press('Enter')

  const dialog = page.getByRole('dialog', { name: 'Navegação principal' })
  await expect(dialog).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.activeElement?.closest('[role="dialog"]')?.getAttribute('role') ?? null,
      ),
    )
    .toBe('dialog')
  await expectNoBlockingAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('skip link, account logout, and in-shell not-found behavior remain usable', async ({ page }) => {
  await page.goto('/app')

  const skipLink = page.getByRole('link', { name: 'Pular para o conteúdo principal' })
  await skipLink.focus()
  await skipLink.press('Enter')
  await expect(page.locator('#app-main')).toBeFocused()

  await page.goto('/app/rota-inexistente')
  await expect(page.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Voltar ao início da área de gestão' }),
  ).toHaveAttribute('href', '/app')

  await page.goto('/app')
  await page.getByRole('button', { name: /Abrir menu da conta de Ana Administradora/ }).click()
  await page.getByRole('menuitem', { name: 'Sair' }).click()
  await expect(page).toHaveURL('/entrar')
  await expect(page.getByRole('heading', { level: 1, name: 'Entrar' })).toBeVisible()
})

test('role-aware navigation excludes unavailable destinations and anonymous routes stay guarded', async ({ browser }) => {
  const signedOutContext = await browser.newContext({ baseURL: AUTHENTICATED_SHELL_BASE_URL })
  const signedOutPage = await signedOutContext.newPage()
  await signedOutPage.goto('/app/produtos')
  await expect(signedOutPage).toHaveURL('/entrar?redirect=%2Fapp%2Fprodutos')
  await signedOutContext.close()

  const readOnlyContext = await browser.newContext({ baseURL: AUTHENTICATED_SHELL_BASE_URL })
  const readOnlyPage = await readOnlyContext.newPage()
  await signIn(readOnlyPage, AUTHENTICATED_SHELL_USERS.readOnly)

  const navigation = readOnlyPage.getByRole('navigation', {
    name: 'Navegação principal do aplicativo',
  })
  await expect(navigation.getByRole('link', { name: 'Início' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Produtos' })).toBeVisible()
  await expect(navigation.getByRole('link', { name: 'Auditoria de atividades' })).toHaveCount(0)

  await readOnlyPage.goto('/app/configuracoes/auditoria')
  await expect(readOnlyPage).toHaveURL('/app?negado=audit.view')
  await expect(readOnlyPage.getByRole('alert')).toContainText('Acesso não permitido')
  await readOnlyContext.close()
})

test('the public document remains independent from the authenticated shell', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false })
  const page = await context.newPage()
  await page.goto('/')

  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.locator('[data-app-shell]')).toHaveCount(0)
  await expect(page.locator('html')).not.toHaveAttribute('data-js', '')
  await context.close()
})
