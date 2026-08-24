import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const blockingImpacts = new Set(['serious', 'critical'])
const auditEvent = {
  description: 'Ana Administradora atualizou um orçamento.',
  correlationId: 'audit-e2e-command-901',
} as const

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

test('audit viewer filters the server-backed event list and keeps detail data redacted', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/app/configuracoes/auditoria')

  await expect(
    page.getByRole('heading', { level: 1, name: 'Auditoria de atividades' }),
  ).toBeVisible()
  await expect(page.getByRole('region', { name: 'Atividade de auditoria' })).toContainText(
    auditEvent.description,
  )

  await page.getByLabel('Correlação (ID de comando)').fill(auditEvent.correlationId)
  await page.getByRole('button', { name: 'Aplicar filtros' }).click()
  await expect(page).toHaveURL(/(?:\?|&)correlation=audit-e2e-command-901(?:&|$)/)
  await expect(page.getByRole('region', { name: 'Atividade de auditoria' })).toContainText(
    auditEvent.correlationId,
  )

  const trigger = page.getByRole('button', { name: 'Detalhes' })
  await trigger.focus()
  await trigger.press('Enter')

  const dialog = page.getByRole('dialog', { name: auditEvent.description })
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('Antes da alteração')
  await expect(dialog).toContainText('Depois da alteração')
  await expect(dialog).toContainText('[REDACTED]')
  await expect(dialog).not.toContainText('senha-audit-e2e')
  await expect(dialog).not.toContainText('token-audit-e2e')
  await expectNoBlockingAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  // The audit projection uses a dedicated schema. Reading it must not leak a
  // connection-level search_path into subsequent authenticated app requests.
  await page.goto('/app')
  await expect(
    page.getByRole('heading', { level: 1, name: 'Weyne Representações' }),
  ).toBeVisible()
})

test('audit viewer remains keyboard-operable without horizontal overflow on mobile', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/app/configuracoes/auditoria')

  const eventList = page.getByRole('region', { name: 'Atividade de auditoria (lista)' })
  await expect(eventList).toContainText(auditEvent.description)

  const trigger = eventList.getByRole('button', { name: 'Detalhes' })
  await trigger.focus()
  await trigger.press('Enter')
  const dialog = page.getByRole('dialog', { name: auditEvent.description })
  await expect(dialog).toBeVisible()
  await expectNoBlockingAxeViolations(page)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()

  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(overflow.scrollWidth).toBe(overflow.clientWidth)
})
