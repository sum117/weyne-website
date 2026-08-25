import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

/**
 * The shared pattern catalogue lives behind the authenticated boundary at
 * `/app/padroes`, so this suite needs a signed-in session. The authenticated
 * end-to-end fixture is owned by the security-coverage card (t_ea4a2633);
 * until it lands, the guard redirects and this spec cannot reach the page.
 *
 * Skipping keeps the intent visible instead of silently deleting the
 * coverage. The guard itself is covered in `accessibility.spec.ts`, and the
 * component behavior below is covered by the jsdom suite in
 * `tests/unit/data-table.test.tsx` and its siblings.
 */
test.describe('shared app pattern catalogue', () => {
  test.skip(
    true,
    'Requires an authenticated end-to-end session fixture (t_ea4a2633).',
  )

  test('supports the documented keyboard, focus, form, and table interactions', async ({
    page,
  }) => {
    await page.goto('/app/padroes')
    await expect(
      page.getByRole('heading', {
        level: 1,
        name: 'Padrões compartilhados do app',
      }),
    ).toBeVisible()

    const tabOrder: string[] = []
    for (let index = 0; index < 6; index += 1) {
      await page.keyboard.press('Tab')
      tabOrder.push(
        await page.evaluate(() =>
          (document.activeElement?.textContent ?? '').trim().replace(/\s+/g, ' '),
        ),
      )
    }
    expect(tabOrder).toEqual([
      'Área de gestão',
      'Mostrar dados',
      'Mostrar carregamento',
      'Mostrar vazio',
      'Mostrar erro',
      'Status',
    ])

    const statusFilter = page.getByRole('button', { name: 'Filtrar por Status' })
    await statusFilter.focus()
    await page.keyboard.press('Enter')
    await page.getByRole('menuitemcheckbox', { name: 'Ativo' }).click()
    await page.keyboard.press('Escape')
    await expect
      .poll(() => {
        const value = new URL(page.url()).searchParams.get('status')
        return value ? (JSON.parse(value) as string[]) : []
      })
      .toContain('active')

    await page.getByRole('button', { name: 'Colunas' }).click()
    await page.getByRole('menuitemcheckbox', { name: 'Status' }).click()
    await page.keyboard.press('Escape')
    await expect(
      page.getByRole('columnheader', { name: /Status/ }),
    ).toHaveCount(0)

    await page.getByRole('checkbox', { name: 'Selecionar Mercado Aurora' }).click()
    await expect(
      page.getByRole('button', { name: 'Processar 1 selecionada(s)' }),
    ).toBeVisible()

    await page.getByRole('button', { name: 'Mostrar carregamento' }).click()
    await expect(page.getByRole('status', { name: 'Carregando dados…' })).toBeVisible()
    await page.getByRole('button', { name: 'Mostrar vazio' }).click()
    await expect(
      page.getByText('Nenhum registro corresponde aos filtros'),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Mostrar erro' }).click()
    await expect(page.getByRole('alert')).toContainText(
      'Falha simulada ao carregar as contas.',
    )
    await page.getByRole('button', { name: 'Mostrar dados' }).click()

    const combobox = page.getByRole('combobox', { name: 'Cidade' })
    await combobox.fill('Recife')
    await expect(combobox).toHaveValue('Recife')

    await page.getByRole('button', { name: 'Salvar cliente' }).click()
    const summaryLink = page.getByRole('link', {
      name: /Razão social: Informe a razão social/,
    })
    await expect(summaryLink).toBeVisible()
    await summaryLink.click()
    await expect(page.getByRole('textbox', { name: 'Razão social' })).toBeFocused()

    const confirmationTrigger = page.getByRole('button', {
      name: 'Excluir exemplo',
    })
    await confirmationTrigger.click()
    await expect(page.getByRole('button', { name: 'Cancelar' })).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(confirmationTrigger).toBeFocused()

    const accessibility = await new AxeBuilder({ page }).analyze()
    expect(
      accessibility.violations.filter(({ impact }) =>
        impact === 'serious' || impact === 'critical',
      ),
    ).toEqual([])
  })
})
