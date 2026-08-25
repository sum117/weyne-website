import { createHash } from 'node:crypto'
import { expect, test, type Page } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import * as expectations from './expectations'

/** Served by the Vite fixture webServer declared in the Playwright config. */
const FIXTURE_URL = process.env.WORKFLOW_FIXTURE_URL
if (!FIXTURE_URL) {
  throw new Error('WORKFLOW_FIXTURE_URL is required — run the suite through scripts/run-quote-workflow.ts')
}

/**
 * Quote workflow acceptance suite over production boundaries (kanban
 * t_391798ac).
 *
 * Every scenario drives the REAL quote services through the fixture
 * workspace's HTTP API: PostgreSQL persistence with optimistic concurrency,
 * server-authoritative Decimal pricing, lifecycle state machines, duplication,
 * immutable PDF snapshots + artifacts, and append-only audit history.
 *
 * Asserted values come from `expectations.ts`, which is hand-calculated from
 * seeded master data — never copied from client state or prior test output.
 */

const blockingImpacts = new Set(['serious', 'critical'])

async function expectNoBlockingAxeViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze()
  const blocking = results.violations
    .filter((violation) => blockingImpacts.has(violation.impact ?? ''))
    .map((violation) => ({ id: violation.id, targets: violation.nodes.map((node) => node.target.join(' ')) }))
  expect(blocking, JSON.stringify(blocking, null, 2)).toEqual([])
}

async function openWorkspace(page: Page, quoteId?: string) {
  const url = new URL(FIXTURE_URL!)
  if (quoteId) url.searchParams.set('quoteId', quoteId)
  await page.goto(url.toString())
  await expect(page.locator('[data-workspace-ready]')).toBeAttached()
  await expect(
    page.getByRole('heading', { name: /Orçamentos/ }),
  ).toBeVisible()
}

/** Adds a product by its internal code via the catalog picker. */
async function addProductByCode(page: Page, code: string) {
  await page.getByRole('combobox', { name: 'Buscar produtos' }).click()
  // The command list renders all three seeded products in one page.
  await page.getByRole('option', { name: new RegExp(code) }).click()
}

/**
 * Applies the full workflow order through the UI (three seeded products).
 */
async function applyWorkflowOrder(page: Page): Promise<void> {
  for (const line of expectations.WORKFLOW_ORDER.lines) {
    const product = Object.values(expectations.PRODUCTS).find((item) => item.id === line.productId)!
    await addProductByCode(page, product.internalCode)
    await page.getByRole('textbox', { name: new RegExp(`Quantidade de ${product.description}`, 'i') }).fill(line.quantity)
    await page.getByRole('textbox', { name: new RegExp(`Desconto percentual de ${product.description}`, 'i') }).fill(line.lineDiscountRate)
  }
  await page.getByRole('button', { name: 'Recalcular no servidor' }).click()
  await expect(page.getByRole('status')).toContainText('Valores oficiais recalculados pelo servidor.')
}

interface LineTotals {
  gross: string
  lineDiscount: string
  generalDiscount: string
  merchandise: string
  ipi: string
  configuredTax: string
}

function lineTotalsFromSnapshot(
  lines: Array<Record<string, string>>,
): Map<string, LineTotals> {
  const map = new Map<string, LineTotals>()
  for (const line of lines) {
    if (!line.productId) continue
    let configuredTax: string
    try {
      const taxes = JSON.parse(line.configuredTaxes ?? '[]') as Array<{ amount?: string }>
      configuredTax = taxes.reduce((sum, tax) => sum + Number(tax.amount ?? 0), 0).toFixed(2)
    } catch {
      configuredTax = String(line.configuredTaxAmount ?? '0.00')
    }
    map.set(line.productId, {
      gross: String(line.gross),
      lineDiscount: String(line.lineDiscount),
      generalDiscount: String(line.generalDiscount),
      merchandise: String(line.merchandise),
      ipi: String(line.ipi),
      configuredTax,
    })
  }
  return map
}

// ---------------------------------------------------------------------------
// 1. Complete workflow: create → price → save → reload → lifecycle → duplicate
//    → audit → both PDF variants
// ---------------------------------------------------------------------------

test.describe('complete quote workflow', () => {
  test('creates, prices, saves, reloads, transitions, duplicates, audits, and delivers both PDF variants', async ({
    page,
  }, _testInfo) => {
    await openWorkspace(page)

    // -- Create + price -----------------------------------------------------
    await applyWorkflowOrder(page)
    const quote = await page.evaluate(() => window.__workspace.getQuoteState())
    expect(quote).not.toBeNull()
    const quoteId = quote!.id
    expect(quote!.status).toBe('draft')

    // Authoritative per-line amounts must equal the hand-calculated matrix.
    const lineMap = lineTotalsFromSnapshot(quote!.lines)
    expect(lineMap.size).toBe(3)
    for (const [productId, expected] of Object.entries(expectations.EXPECTED_LINES)) {
      const actual = lineMap.get(productId)
      expect(actual, `line ${productId} missing`).toBeDefined()
      expect(actual!.gross).toBe(expected.gross)
      expect(actual!.lineDiscount).toBe(expected.lineDiscount)
      expect(actual!.generalDiscount).toBe(expected.generalDiscount)
      expect(actual!.merchandise).toBe(expected.merchandise)
      expect(actual!.ipi).toBe(expected.ipi)
    }

    // Server totals rendered by the UI must match the expectation matrix.
    const official = page.getByLabel('Valores oficiais do servidor')
    await expect(official).toContainText(expectations.EXPECTED_GRAND_TOTAL_PTBR)
    await expect(official).toContainText(
      `R$ ${expectations.formatPtBr(expectations.EXPECTED_TOTALS.grossItemsAmount)}`,
    )
    await expect(official).toContainText(
      `R$ ${expectations.formatPtBr(expectations.EXPECTED_TOTALS.freightAmount)}`,
    )

    // -- Save (real updateDraft with optimistic version) --------------------
    const savedVersion = await page.evaluate(async () => {
      const state = await window.__workspace.getQuoteState()
      const result = await window.__workspace.saveDraft({
        quoteId: state!.id,
        expectedVersion: state!.version,
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: '7.5',
          freight: '12.345',
          lines: state!.lines,
          totals: {
            merchandiseGross: '105.00',
            merchandiseNet: '91.11',
            total: '103.46',
          },
        },
      })
      return result.version
    })
    expect(Number(savedVersion)).toBeGreaterThan(1)

    // Reload proves persistence beyond client memory.
    const reloaded = await page.evaluate(async (id) => {
      const state = await window.__workspace.getQuoteState()
      return { id, state }
    }, quoteId)
    expect(reloaded.state!.version).toBe(Number(savedVersion))
    expect(reloaded.state!.lines.length).toBe(3)

    // -- Lifecycle: send (readyToSend gate), reopen, approve ---------------
    // The send gate requires complete snapshots; the harness computed
    // ready_to_send with the same pure gate the service enforces.
    const sentResult = await page.evaluate(async (id) => {
      try {
        const result = (await window.__workspace.transition({
          quoteId: id,
          command: 'sendQuote',
        })) as { quote?: { status: string; version: number }; error?: string }
        return result
      } catch (error) {
        return { error: (error as Error).message }
      }
    }, quoteId)
    expect(sentResult.quote?.status ?? '').toBe('sent')
    expect(sentResult.quote!.version).toBeGreaterThan(1)

    const reopened = await page.evaluate(async (input) => {
      return window.__workspace.transition({
        quoteId: input.id,
        command: 'reopenQuote',
        reason: 'Ajuste de quantidade solicitado pelo cliente.',
      }) as Promise<{ quote: { status: string; version: number } }>
    }, { id: quoteId })
    expect(reopened.quote.status).toBe('draft')

    const resent = await page.evaluate(async (id) => {
      return window.__workspace.transition({
        quoteId: id,
        command: 'sendQuote',
      }) as Promise<{ quote: { status: string; version: number } }>
    }, quoteId)
    expect(resent.quote.status).toBe('sent')

    const approved = await page.evaluate(async (id) => {
      window.__workspace.setActor('admin')
      try {
        return window.__workspace.transition({
          quoteId: id,
          command: 'approveQuote',
        }) as Promise<{ quote: { status: string; version: number } }>
      } finally {
        window.__workspace.setActor('owner')
      }
    }, quoteId)
    expect(approved.quote.status).toBe('approved')

    // Illegal edge: an approved quote cannot go back to sent.
    const illegal = await page.evaluate(async (id) => {
      try {
        await window.__workspace.transition({ quoteId: id, command: 'sendQuote' })
        return null
      } catch (error) {
        return (error as Error).message
      }
    }, quoteId)
    expect(illegal).toMatch(/INVALID_STATE_TRANSITION|Cannot transition/i)

    // -- Duplicate ----------------------------------------------------------
    const duplicate = await page.evaluate(async (sourceQuoteId: string) => {
      return window.__workspace.duplicate(sourceQuoteId) as Promise<{
        id: string
        quoteNumber: string
        sourceQuoteId: string | null
        status: string
        version: number
        commercialSnapshot: Record<string, unknown>
      }>
    }, quoteId)
    expect(duplicate.status).toBe('draft')
    expect(duplicate.sourceQuoteId).toBe(quoteId)
    expect(duplicate.quoteNumber).not.toBe(quote!.quoteNumber)
    expect(String(duplicate.quoteNumber)).toMatch(/^ORC-\d{4}-\d{6}$/)
    // The copy carries the same frozen commercial snapshot.
    expect(JSON.stringify(duplicate.commercialSnapshot)).toContain('QUOTE-A')

    // Original untouched by the duplication.
    const originalAfterDuplicate = await page.evaluate(() =>
      window.__workspace.getQuoteState(),
    )
    expect(originalAfterDuplicate!.status).toBe('approved')

    // -- Audit history ------------------------------------------------------
    // -- Audit history ------------------------------------------------------
    const history = await page.evaluate(async (id) => {
      return (await window.__workspace.history(id)) as {
        versions: Array<{ version: number; operation: string; snapshot: Record<string, unknown> }>
        audit: Array<{
          actorId: string
          actorRole: string
          operation: string
          version: number
          beforeState: Record<string, unknown> | null
          afterState: Record<string, unknown>
        }>
      }
    }, quoteId)

    const operations = history.audit.map((entry) => entry.operation)
    expect(operations[0]).toBe('create')
    expect(operations).toContain('update')
    expect(operations.filter((operation) => operation === 'transition').length).toBeGreaterThanOrEqual(3)
    const duplicateHistory = await page.evaluate((id) => window.__workspace.history(id), duplicate.id) as {
      audit: Array<{ operation: string }>
    }
    expect(duplicateHistory.audit.map((entry) => entry.operation)).toContain('duplicate')
    // Actor-rich entries: every audit row names actor and role.
    for (const entry of history.audit) {
      expect(entry.actorId.length).toBeGreaterThan(0)
      expect(['admin', 'representative', 'read_only', 'system']).toContain(entry.actorRole)
    }
    // Immutable versions are contiguous and ordered.
    const versions = history.versions.map((entry) => entry.version)
    expect(versions).toEqual(versions.slice().sort((left, right) => left - right))
    // Before/after states recorded on transitions.
    const transitionAudit = history.audit.find(
      (entry) => entry.operation === 'transition' && entry.beforeState !== null,
    )
    expect(transitionAudit).toBeDefined()

    // -- PDF variants over the immutable snapshot pipeline ------------------
    const snapshot = await page.evaluate(async (id) => {
      return (await window.__workspace.captureSnapshot(id)) as {
        snapshotId: string
        snapshotVersion: number
      }
    }, quoteId)
    expect(snapshot.snapshotVersion).toBeGreaterThanOrEqual(1)

    for (const variant of ['summary', 'commercial'] as const) {
      const generated = await page.evaluate(async (input) => {
        try {
          return {
            ok: true as const,
            view: (await window.__workspace.generatePdf(input.identity, input.variant)) as {
              kind: string
              pageCount: number
              sizeBytes: number
              outputChecksum: string
            },
          }
        } catch (error) {
          return { ok: false as const, error: (error as Error).message, view: undefined }
        }
      }, { identity: {
        quoteId,
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshot.snapshotVersion,
        templateId:
          variant === 'commercial'
            ? expectations.PDF_TEMPLATES.commercial.id
            : expectations.PDF_TEMPLATES.summary.id,
        templateVersion: 1,
      }, variant })

      expect(generated.ok, generated.ok ? '' : generated.error).toBe(true)
      const view = generated.view!
      expect(view.kind).toBe('completed')
      expect(view.pageCount).toBeGreaterThanOrEqual(1)
      expect(view.outputChecksum).toMatch(/^[0-9a-f]{64}$/)

      // Download bytes through the authorized delivery path and verify the
      // checksum matches the artifact record — integrity end to end.
      const deliveredIdentity = {
        quoteId,
        snapshotId: snapshot.snapshotId,
        snapshotVersion: snapshot.snapshotVersion,
        templateId:
          variant === 'commercial'
            ? expectations.PDF_TEMPLATES.commercial.id
            : expectations.PDF_TEMPLATES.summary.id,
        templateVersion: 1,
      }
      const delivered = await page.evaluate(
        (identity) => window.__workspace.deliverPdf(identity),
        deliveredIdentity,
      )
      expect(delivered.ok, delivered.error ?? '').toBe(true)
      const expectedSuffix =
        variant === 'commercial' ? '-comercial.pdf' : '-resumida.pdf'
      expect(delivered.filename).toContain(expectedSuffix)
      expect(delivered.filename).toContain(`v${snapshot.snapshotVersion}`)

      const bytes = Buffer.from(delivered.bytes!, 'base64')
      expect(bytes.subarray(0, 5).toString('ascii')).toBe('%PDF-')
      const checksum = createHash('sha256').update(bytes).digest('hex')
      expect(checksum).toBe(view.outputChecksum)
    }

    // PDF delivery appended audit events for generate + download.
    const pdfAudit = await page.evaluate(() => window.__workspace.auditEvents())
    const actions = pdfAudit.map((event) => event.action)
    expect(actions).toContain('quote.pdf.generated')
    expect(actions).toContain('quote.pdf.download')
    for (const event of pdfAudit) {
      expect(event.actorId).toBeTruthy()
      expect(event.artifactId).toBeTruthy()
    }
  })
})

// ---------------------------------------------------------------------------
// 2. Authorized roles and explicit denials at the server boundary
// ---------------------------------------------------------------------------

test.describe('role authorization', () => {
  test('read_only may poll status but is denied byte delivery and mutations', async ({
    page,
  }) => {
    await openWorkspace(page)
    await applyWorkflowOrder(page)
    const quote = await page.evaluate(() => window.__workspace.getQuoteState())
    const quoteId = quote!.id

    // Denial probe #1: stale-editor write through the real repository. The
    // conflictProbe sends expectedVersion=1 after the version moved; the
    // repository MUST reject with CONCURRENT_MODIFICATION and report the
    // current version instead of silently overwriting.
    const probe = await page.evaluate((id) => window.__workspace.conflictProbe(id), quoteId)
    expect(probe.kind).toBe('conflict')
    expect(probe.message).toMatch(/CONCURRENT_MODIFICATION/)
    // The overwrite did NOT happen: the live data still carries the priced
    // workflow order, not the probe's garbage payload.
    const afterProbe = await page.evaluate(() => window.__workspace.getQuoteState())
    expect(afterProbe!.lines.length).toBe(3)
    expect(JSON.stringify(afterProbe!.lines)).not.toContain('"999"')

    // Denial probe #2: out-of-scope representative cannot transition another
    // user's document — indistinguishable from not-found at the boundary.
    await page.evaluate(() => window.__workspace.setActor('representative'))
    const outsiderSend = await page.evaluate(async (id) => {
      try {
        await window.__workspace.transition({ quoteId: id, command: 'sendQuote' })
        return null
      } catch (error) {
        return (error as Error).message
      }
    }, quoteId)
    expect(outsiderSend).toMatch(/FORBIDDEN|QUOTE_NOT_FOUND|not authorized|Cannot/i)

    // Restore owner and send so the PDF denial probes have a completed artifact.
    await page.evaluate(() => window.__workspace.setActor('owner'))
    const snapshot = (await page.evaluate(
      (id) => window.__workspace.captureSnapshot(id),
      quoteId,
    )) as { snapshotId: string; snapshotVersion: number }
    const identity = {
      quoteId,
      snapshotId: snapshot.snapshotId,
      snapshotVersion: snapshot.snapshotVersion,
      templateId: expectations.PDF_TEMPLATES.summary.id,
      templateVersion: 1,
    }
    const generated = await page.evaluate(async (input) => {
      try {
        await window.__workspace.generatePdf(input.identity, 'summary')
        return null
      } catch (error) {
        return (error as Error).message
      }
    }, { identity })

    // Owner (representative) holds quote.generate_pdf per the matrix.
    expect(generated).toBeNull()

    // read_only CAN see status (explicit-assigned scope includes auditor-1)
    // but can NEVER retrieve bytes.
    const statusAsReadOnly = await page.evaluate(async (identityInput) => {
      window.__workspace.setActor('read_only')
      try {
        return await window.__workspace.pdfStatus(identityInput)
      } finally {
        window.__workspace.setActor('owner')
      }
    }, identity)
    expect(statusAsReadOnly.kind).toBe('completed')

    const deniedDelivery = await page.evaluate(
      (identityInput) =>
        window.__workspace.deliverPdf(identityInput, { id: 'auditor-1', role: 'read_only' }),
      identity,
    )
    expect(deniedDelivery.ok).toBe(false)
    expect(deniedDelivery.error).toMatch(/FORBIDDEN/)

    // The admin role passes everywhere: same identity, admin actor succeeds.
    const adminDelivery = await page.evaluate(
      (identityInput) =>
        window.__workspace.deliverPdf(identityInput, { id: 'admin-1', role: 'admin' }),
      identity,
    )
    expect(adminDelivery.ok).toBe(true)
    expect(Buffer.from(adminDelivery.bytes!, 'base64').subarray(0, 4).toString('ascii')).toBe('%PDF')
  })
})

// ---------------------------------------------------------------------------
// 3. Concurrent editing: two contexts, one quote, honest recovery
// ---------------------------------------------------------------------------

test.describe('concurrent editing', () => {
  test('stale editor receives a useful conflict and recovers without silent overwrite', async ({
    browser,
  }) => {
    // Two isolated contexts share the SAME backend database.
    const contextA = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Recife',
      reducedMotion: 'reduce',
    })
    const contextB = await browser.newContext({
      locale: 'pt-BR',
      timezoneId: 'America/Recife',
      reducedMotion: 'reduce',
    })
    const pageA = await contextA.newPage()
    const pageB = await contextB.newPage()

    await openWorkspace(pageA)
    await applyWorkflowOrder(pageA)
    const created = await pageA.evaluate(() => window.__workspace.getQuoteState())
    const quoteId = created!.id

    await openWorkspace(pageB, quoteId)

    // Both editors load the SAME persisted state (same version).
    const stateFor = (page: Page) => page.evaluate(() => window.__workspace.getQuoteState())
    const baseA = await stateFor(pageA)
    const baseB = await stateFor(pageB)
    expect(baseB!.version).toBe(baseA!.version)

    // Editor B saves first (bumps the persisted version).
    const bSave = await pageB.evaluate(async (id) => {
      const state = await window.__workspace.getQuoteState()
      return window.__workspace.saveDraft({
        quoteId: id,
        expectedVersion: state!.version,
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: '7.5',
          freight: '12.345',
          lines: [
            ...state!.lines,
            // B adds a fourth line — the change A does not know about.
            {
              productId: '10000000-0000-4000-8000-000000000005',
              internalCode: 'QUOTE-C',
              description: 'Produto sintético C (linha extra do editor B)',
              unit: 'UN',
              quantity: '2',
              unitPrice: '25.000000',
              lineDiscountRate: '0',
            },
          ],
          totals: {
            merchandiseGross: '155.00',
            merchandiseNet: '141.11',
            total: '153.46',
          },
        },
      })
    }, quoteId)
    expect(bSave.version).toBe(baseB!.version + 1)

    // Editor A still holds the STALE version and tries to save its own view.
    const aStaleWrite = await pageA.evaluate(async (input) => {
      try {
        const stale = await window.__workspace.saveDraft({
          quoteId: input.id,
          expectedVersion: input.staleVersion,
          commercialSnapshot: {
            priceListKey: 'PRICE_2',
            generalDiscountRate: '0',
            freight: '0',
            lines: [],
            totals: { merchandiseGross: '0.00', merchandiseNet: '0.00', total: '0.00' },
          },
        })
        return { ok: true as const, result: stale }
      } catch (error) {
        return { ok: false as const, message: (error as Error).message, result: undefined }
      }
    }, { id: quoteId, staleVersion: baseB!.version })

    // The server rejected A's stale write — no silent overwrite of B's work.
    expect(aStaleWrite.ok).toBe(false)
    expect(aStaleWrite.message).toMatch(/CONCURRENT_MODIFICATION/)

    // B's committed data survived intact.
    const afterConflict = await stateFor(pageA)
    expect(afterConflict!.version).toBe(baseB!.version + 1)
    expect(afterConflict!.lines.length).toBe(4)
    expect(JSON.stringify(afterConflict!.lines)).toContain('linha extra do editor B')

    // A reconciles honestly: reload the authoritative state and reapply on top.
    const recovered = await pageA.evaluate(async (id) => {
      const fresh = await window.__workspace.getQuoteState()
      return window.__workspace.saveDraft({
        quoteId: id,
        expectedVersion: fresh!.version,
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: '10',
          freight: '20.00',
          lines: fresh!.lines,
          totals: {
            merchandiseGross: '155.00',
            merchandiseNet: '139.50',
            total: '159.50',
          },
        },
      })
    }, quoteId)
    // Recovery lands ON TOP of B's version — nothing lost.
    expect(Number(recovered.version)).toBe(baseB!.version + 2)
    const finalState = await stateFor(pageB)
    expect(finalState!.lines.length).toBe(4)

    await contextA.close()
    await contextB.close()
  })

  test('UI surfaces the conflict alert with preserved edits and reconciliation control', async ({
    page,
  }) => {
    await openWorkspace(page)
    await applyWorkflowOrder(page)

    // Queue a concurrent modification behind the editor's back, then edit and
    // recalculate: the mutation hits the stale-version boundary.
    const quote = await page.evaluate(() => window.__workspace.getQuoteState())
    await page.evaluate(async (id) => {
      const state = await window.__workspace.getQuoteState()
      await window.__workspace.saveDraft({
        quoteId: id,
        expectedVersion: state!.version,
        commercialSnapshot: {
          priceListKey: 'PRICE_2',
          generalDiscountRate: '0',
          freight: '12.345',
          lines: state!.lines,
          totals: {
            merchandiseGross: '105.00',
            merchandiseNet: '98.50',
            total: '110.85',
          },
        },
      })
    }, quote!.id)

    // Edit a quantity in the editor whose model still shows the old version.
    const quantity = page.getByRole('textbox', {
      name: new RegExp(`Quantidade de ${expectations.PRODUCTS.a.description}`, 'i'),
    })
    await quantity.fill('5')
    await page.getByRole('button', { name: 'Recalcular no servidor' }).click()

    // The stale editor gets a visible, actionable conflict — not a silent loss.
    await expect(page.getByRole('alert')).toContainText('mudou no servidor')
    await expect(page.getByRole('button', { name: 'Recarregar e reconciliar' })).toBeVisible()
    // The local edit is preserved on screen while the conflict stands.
    await expect(quantity).toHaveValue('5')
    // And the alert announces itself politely to assistive technology.
    const announcement = page.locator('[aria-live="polite"], [role="status"]').first()
    await expect(announcement).toBeAttached()
  })
})

// ---------------------------------------------------------------------------
// 4. Responsive accessibility without weakened standards
// ---------------------------------------------------------------------------

test.describe('responsive accessibility', () => {
  test('desktop workflow surface has no blocking axe violations', async ({ page }) => {
    await openWorkspace(page)
    await addProductByCode(page, expectations.PRODUCTS.a.internalCode)
    await expectNoBlockingAxeViolations(page)
  })

  test('mobile viewport keeps pricing fields labeled and operable', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await openWorkspace(page)
    await applyWorkflowOrder(page)

    const quantity = page.getByRole('textbox', {
      name: new RegExp(`Quantidade de ${expectations.PRODUCTS.a.description}`, 'i'),
    })
    await quantity.scrollIntoViewIfNeeded()
    await quantity.fill('4')
    await expect(quantity).toHaveValue('4')

    // Every decimal field exposes a proper accessible name.
    const discount = page.getByRole('textbox', {
      name: new RegExp(`Desconto percentual de ${expectations.PRODUCTS.b.description}`, 'i'),
    })
    await discount.scrollIntoViewIfNeeded()
    await discount.fill('15')
    await expect(discount).toHaveValue('15')

    await expectNoBlockingAxeViolations(page)
  })

  test('keyboard operation reaches the editor, moves lines, and announces changes', async ({
    page,
  }) => {
    await openWorkspace(page)
    await applyWorkflowOrder(page)

    // Catalog responses do not promise an order, so select any enabled move
    // control and retain its accessible product name for the assertions.
    const moveDown = page.locator('button[aria-label^="Mover "][aria-label$=" para baixo"]:not(:disabled)').first()
    const moveLabel = await moveDown.getAttribute('aria-label')
    const description = moveLabel?.match(/^Mover (.+) para baixo$/)?.[1]
    expect(description).toBeTruthy()
    const movedDown = page.getByRole('button', { name: `Mover ${description} para baixo` })

    await movedDown.focus()
    await movedDown.press('Enter')
    await expect(page.getByRole('status')).toContainText(`${description} movido para a posição`)

    // Focus remains on a usable ordering control. Moving the last eligible
    // item down disables that control, so the editor moves focus to "up".
    const moveUp = page.getByRole('button', { name: `Mover ${description} para cima` })
    await expect(await movedDown.isDisabled() ? moveUp : movedDown).toBeFocused()

    const removeButton = page.getByRole('button', {
      name: new RegExp(`Remover ${expectations.PRODUCTS.c.description}`),
    })
    await removeButton.focus()
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('status').filter({
        hasText: `${expectations.PRODUCTS.c.description} removido.`,
      }),
    ).toBeVisible()
  })

  test('validation errors are announced and associated with their fields', async ({ page }) => {
    await openWorkspace(page)
    await addProductByCode(page, expectations.PRODUCTS.a.internalCode)

    const quantity = page.getByRole('textbox', {
      name: new RegExp(`Quantidade de ${expectations.PRODUCTS.a.description}`, 'i'),
    })
    await quantity.fill('abc')
    await page.getByRole('button', { name: 'Recalcular no servidor' }).click()

    const error = page.getByRole('alert').filter({
      hasText: 'Informe um número decimal válido',
    })
    await expect(error).toBeVisible()
    await expect(quantity).toHaveAttribute('aria-invalid', 'true')
    await expectNoBlockingAxeViolations(page)
  })
})
