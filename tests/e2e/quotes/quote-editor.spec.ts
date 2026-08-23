import { expect, test, type Page } from '@playwright/test'

/**
 * Browser-level coverage for the integrated quote catalog picker and
 * line-item editor, over a deterministic in-memory QuoteDataService.
 * Decimal fixtures: unit price 42.0050 (standard) / 46.5000 (varejo),
 * IPI 5%, money rounding ROUND_HALF_UP at 2dp — mirroring the server engine.
 */

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/tests/e2e/fixtures/quote-editor.html')
  await expect(
    page.getByRole('heading', { name: 'Novo orçamento' }),
  ).toBeVisible()
})

async function addProduct(page: Page, name: string | RegExp) {
  const search = page.getByRole('combobox', { name: 'Buscar produtos' })
  await search.click()
  await page.getByRole('option', { name }).click()
}

test.describe('quote editor end-to-end', () => {
  test('chooses a price list and adds products from the catalog', async ({
    page,
  }) => {
    const priceList = page.getByLabel('Tabela de preços')
    await expect(priceList).toHaveValue('list-standard')
    await expect(page.getByRole('option', { name: /Detergente concentrado/ })).toContainText(
      'R$ 42,0050',
    )
    // The default list is marked in the select options.
    await expect(priceList).toContainText('(padrão)')

    // Switching to the retail table reprices the catalog rows.
    await priceList.selectOption('list-varejo')
    await expect(
      page.getByRole('option', { name: /Detergente concentrado/ }),
    ).toContainText('R$ 46,50')

    await addProduct(page, /Detergente concentrado/)
    await addProduct(page, /Papel toalha/)
    await expect(page.getByRole('button', { name: /Remover Detergente/ })).toBeVisible()

    // Archived products stay visible but unselectable.
    await expect(
      page.getByRole('option', { name: /Álcool antisséptico/ }),
    ).toHaveAttribute('aria-disabled', 'true')
    await expect(page.getByText(/Produto arquivado/)).toBeVisible()
  })

  test('edits quantities and discounts with server-authoritative rounding', async ({
    page,
  }) => {
    await addProduct(page, /Detergente concentrado/)

    const quantity = page.getByRole('textbox', { name: /Quantidade de Detergente/i })
    await quantity.fill('3')
    const discount = page.getByRole('textbox', {
      name: /Desconto percentual de Detergente/i,
    })
    await discount.fill('2.5')

    // Local preview: 3 × 42.005 = 126.015 → 126.02 (HALF_UP);
    // discount 2.5% of 126.015 = 3.150375 → 3.15; net 122.87;
    // IPI 5% display-only = 6.1435 → 6.14; total 122.87.
    const preview = page.getByLabel('Prévia de valores')
    await expect(preview).toContainText('126.02'.replace('.', ','))
    await expect(preview).toContainText('3,15')
    await expect(preview).toContainText('6,14')
    await expect(preview).toContainText('122,87')

    // Server recalculation publishes the authoritative totals.
    await page.getByRole('button', { name: 'Recalcular no servidor' }).click()
    const official = page.getByLabel('Valores oficiais do servidor')
    await expect(official).toContainText('R$ 126,02')
    await expect(official).toContainText('R$ 3,15')
    await expect(official).toContainText('R$ 6,14')
    await expect(official).toContainText('R$ 122,87')
  })

  test('surfaces changed source prices while keeping saved snapshots stable', async ({
    page,
  }) => {
    await addProduct(page, /Detergente concentrado/)

    // Another user bumps the source price before the next load.
    await page.evaluate(() => {
      ;(window as unknown as { __quoteFixture: { setSourcePriceShift(v: boolean): void } })
        .__quoteFixture.setSourcePriceShift(true)
    })

    await page.getByRole('button', { name: /Remover Detergente/ }).waitFor()
    // Trigger a fresh pricing load by adding another product.
    await addProduct(page, /Papel toalha/)

    const line = page.getByTestId(/^quote-editor-line-/)
    await expect(line.filter({ hasText: 'Detergente' })).toContainText(
      'Preço de origem alterado',
    )
    // Saved snapshot stays editable and unchanged until explicit adoption.
    await expect(line.filter({ hasText: 'Detergente' })).toContainText(
      'Preço salvo R$ 42,005',
    )
  })

  test('reports concurrent-update conflicts without discarding drafts', async ({
    page,
  }) => {
    await addProduct(page, /Detergente concentrado/)

    await page.evaluate(() => {
      ;(window as unknown as { __quoteFixture: { queueConflict(): void } })
        .__quoteFixture.queueConflict()
    })

    const quantity = page.getByRole('textbox', { name: /Quantidade de Detergente/i })
    await quantity.fill('4')
    await page.getByRole('button', { name: 'Recalcular no servidor' }).click()

    await expect(page.getByRole('alert')).toContainText(
      'alterado por outra pessoa',
    )
    await expect(quantity).toHaveValue('4')
    await expect(
      page.getByRole('button', { name: 'Recarregar e reconciliar' }),
    ).toBeVisible()
  })

  test('shows the empty-catalog state', async ({ page }) => {
    await page.goto('/tests/e2e/fixtures/quote-editor.html?empty-catalog=1')
    await expect(page.getByText(/Nenhum produto encontrado/)).toBeVisible()
  })

  test('empty quote renders the picker without an editor surface', async ({ page }) => {
    // Fresh fixture starts with zero lines; the editor shows its own empty state.
    await expect(
      page.getByText('O orçamento ainda não tem itens.'),
    ).toBeVisible()
  })

  test('catalog and pricing flows do not create N+1 requests', async ({ page }) => {
    await addProduct(page, /Detergente concentrado/)
    await addProduct(page, /Papel toalha/)

    // Two product selections → two aggregate pricing reloads (one per
    // selection), regardless of how many lines exist. StrictMode's double
    // mount adds one initial load; the bound stays line-count-independent.
    const { searchCount, pricingCount } = await page.evaluate(() => {
      const fx = (
        window as unknown as {
          __quoteFixture: {
            getSearchCatalogCallCount(): number
            getLoadQuotePricingCallCount(): number
          }
        }
      ).__quoteFixture
      return {
        searchCount: fx.getSearchCatalogCallCount(),
        pricingCount: fx.getLoadQuotePricingCallCount(),
      }
    })

    // Strict bounds: catalog requests grow with user actions only (never one
    // per product row), pricing loads are one batched request per reload for
    // any number of lines.
    expect(searchCount).toBeLessThanOrEqual(6)
    expect(pricingCount).toBeLessThanOrEqual(4)
  })

  test('mobile viewport keeps the editor operable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await addProduct(page, /Detergente concentrado/)

    const quantity = page.getByRole('textbox', { name: /Quantidade de Detergente/i })
    await quantity.scrollIntoViewIfNeeded()
    await quantity.fill('2')
    await expect(quantity).toHaveValue('2')

    // Reorder/remove controls remain reachable by touch-sized targets.
    const remove = page.getByRole('button', { name: /Remover Detergente/ })
    await remove.scrollIntoViewIfNeeded()
    await expect(remove).toBeVisible()

    const preview = page.getByLabel('Prévia de valores')
    await preview.scrollIntoViewIfNeeded()
    await expect(preview).toContainText('84,01')
  })
})
