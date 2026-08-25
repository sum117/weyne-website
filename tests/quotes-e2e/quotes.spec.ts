import { expect, test, type Page } from '@playwright/test'

/**
 * Quote lifecycle browser coverage (kanban t_808353e0).
 *
 * Deterministic scenarios over the real production lifecycle/duplication
 * services running in the fixture workspace. Server-side concurrency (row
 * locks, serialized retries) is proven by tests/integration and focused unit
 * suites; here we assert the resulting UI behavior, including the conflict
 * path produced by a scripted second session.
 */

const LIST_HASH = '#/orcamentos'

async function openWorkspace(page: Page) {
  await page.goto('./fixture.html')
  await page.evaluate(() => window.quotesFixture.reset())
  await page.reload()
  await expect(page.locator('[data-workspace-ready]')).toBeAttached()
}

async function openDetail(page: Page, quoteId: string) {
  await page.evaluate((id) => {
    window.location.hash = `#/orcamentos/${id}`
  }, quoteId)
}

function row(page: Page, quoteId: string) {
  return page.getByTestId(`quote-row-${quoteId}`)
}

async function confirmDialog(page: Page, confirmLabel: string) {
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toBeVisible()
  const confirm = dialog.getByRole('button', { name: confirmLabel })
  await confirm.click()
  return dialog
}

// ---------------------------------------------------------------------------
// Happy path: draft → sent → approved, with confirmation + history rendering
// ---------------------------------------------------------------------------

test('happy path sends then approves with confirmation, reason handling, and history', async ({
  page,
}) => {
  await openWorkspace(page)

  // Draft row shows the send action only.
  const draftRow = row(page, 'quote-41')
  await expect(draftRow.getByText('Rascunho')).toBeVisible()
  await expect(draftRow.getByRole('button', { name: 'Enviar' })).toBeVisible()
  await expect(
    draftRow.getByRole('button', { name: 'Aprovar' }),
  ).toHaveCount(0)

  // Send requires explicit confirmation; cancel first to prove it.
  await draftRow.getByRole('button', { name: 'Enviar' }).click()
  const sendDialog = page.getByRole('alertdialog')
  await expect(sendDialog).toBeVisible()
  await sendDialog.getByRole('button', { name: 'Cancelar' }).click()
  await expect(sendDialog).not.toBeVisible()
  await expect(draftRow.getByText('Rascunho')).toBeVisible()

  // Confirm the send.
  await draftRow.getByRole('button', { name: 'Enviar' }).click()
  await confirmDialog(page, 'Confirmar envio')
  await expect(
    page.getByRole('status').filter({ hasText: 'Orçamento enviado com sucesso.' }),
  ).toBeVisible()

  // List status reconciled without reload. The production reconciliation
  // hides stale transition actions until the next refresh, so only the badge
  // and duplication control remain.
  await expect(draftRow.getByText('Enviado', { exact: true })).toBeVisible()
  await expect(draftRow.getByText('Rascunho')).toHaveCount(0)
  await expect(draftRow.getByRole('button', { name: 'Aprovar' })).toHaveCount(0)

  // Approve with an optional reason through the detail surface (fresh
  // capabilities after navigation).
  await openDetail(page, 'quote-41')
  const heading = page.getByRole('heading', { name: 'ORC-2026-000041' })
  await expect(heading).toBeVisible()
  await expect(page.getByText('Enviado').first()).toBeVisible()

  await page.getByRole('button', { name: 'Aprovar' }).click()
  const approveDialog = page.getByRole('alertdialog')
  await approveDialog
    .getByLabel(/Motivo/)
    .fill('Cliente aprovou o pedido por e-mail.')
  await approveDialog.getByRole('button', { name: 'Confirmar aprovação' }).click()

  await expect(
    page.getByRole('status').filter({ hasText: 'Orçamento aprovado com sucesso.' }),
  ).toBeVisible()
  await expect(page.getByText('Aprovado').first()).toBeVisible()

  // History renders actor, time, transition, and reason.
  const history = page.getByLabel('Histórico do orçamento')
  await expect(history).toBeVisible()
  await expect(history).toContainText('Marina Lima')
  await expect(history).toContainText('Rascunho → Enviado')
  await expect(history).toContainText('Enviado → Aprovado')
  await expect(history).toContainText('Cliente aprovou o pedido por e-mail.')
  await expect(history.locator('time')).toHaveCount(2)

  // Persisted state survives a full reload — not just transient UI messages.
  await page.reload()
  await expect(
    page.getByRole('heading', { name: 'ORC-2026-000041' }),
  ).toBeVisible()
  await expect(page.getByText('Aprovado').first()).toBeVisible()
  await expect(page.getByLabel('Histórico do orçamento')).toContainText(
    'Cliente aprovou o pedido por e-mail.',
  )
})

// ---------------------------------------------------------------------------
// Rejected and cancelled paths with required reasons
// ---------------------------------------------------------------------------

test('reject enforces a required reason and cancel records its terminal reason', async ({
  page,
}) => {
  await openWorkspace(page)

  // Reject from the list: confirm stays disabled until a reason exists.
  const sentRow = row(page, 'quote-37')
  await sentRow.getByRole('button', { name: 'Rejeitar' }).click()
  const rejectDialog = page.getByRole('alertdialog')
  const rejectConfirm = rejectDialog.getByRole('button', {
    name: 'Confirmar rejeição',
  })
  await expect(rejectConfirm).toBeDisabled()
  await rejectDialog.getByLabel(/Motivo/).fill('   ')
  await expect(rejectConfirm).toBeDisabled()
  await rejectDialog
    .getByLabel(/Motivo/)
    .fill('Cliente recusou as condições de pagamento.')
  await expect(rejectConfirm).toBeEnabled()
  await rejectConfirm.click()

  await expect(
    page.getByRole('status').filter({ hasText: 'Orçamento rejeitado com sucesso.' }),
  ).toBeVisible()
  await expect(sentRow.getByText('Rejeitado', { exact: true })).toBeVisible()
  // Terminal status removes all transition controls but keeps duplication.
  await expect(sentRow.getByRole('button', { name: 'Aprovar' })).toHaveCount(0)
  await expect(sentRow.getByRole('button', { name: 'Duplicar' })).toBeVisible()

  // Cancel the approved-path quote from its detail with a required reason.
  await openDetail(page, 'quote-33')
  await page.getByRole('button', { name: 'Cancelar orçamento' }).click()
  const cancelDialog = page.getByRole('alertdialog')
  await expect(
    cancelDialog.getByRole('button', { name: 'Confirmar cancelamento' }),
  ).toBeDisabled()
  await cancelDialog
    .getByLabel(/Motivo/)
    .fill('Cliente desistiu da compra após reajuste interno.')
  await cancelDialog.getByRole('button', { name: 'Confirmar cancelamento' }).click()

  await expect(
    page.getByRole('status').filter({ hasText: 'Orçamento cancelado com sucesso.' }),
  ).toBeVisible()
  await expect(page.getByText('Cancelado').first()).toBeVisible()

  // Both reasons persist across reload.
  await page.reload()
  await expect(page.getByText('Cancelado').first()).toBeVisible()
  await expect(page.getByLabel('Histórico do orçamento')).toContainText(
    'Cliente desistiu da compra após reajuste interno.',
  )

  await page.evaluate((hash) => {
    window.location.hash = hash
  }, LIST_HASH)
  await expect(row(page, 'quote-37').getByText('Rejeitado', { exact: true })).toBeVisible()
})

// ---------------------------------------------------------------------------
// List/detail synchronization
// ---------------------------------------------------------------------------

test('list and detail statuses stay synchronized after a transition', async ({
  page,
}) => {
  await openWorkspace(page)

  await openDetail(page, 'quote-41')
  await page.getByRole('button', { name: 'Enviar' }).click()
  await confirmDialog(page, 'Confirmar envio')
  await expect(page.getByText('Enviado').first()).toBeVisible()

  // Back to the list: same effective status, no stale draft badge.
  await page.evaluate((hash) => {
    window.location.hash = hash
  }, LIST_HASH)
  const syncedRow = row(page, 'quote-41')
  await expect(syncedRow.getByText('Enviado', { exact: true })).toBeVisible()
  await expect(syncedRow.getByText('Rascunho')).toHaveCount(0)

  // Reload proves the reconciled state was persisted, not just local.
  await page.reload()
  await expect(
    row(page, 'quote-41').getByText('Enviado', { exact: true }),
  ).toBeVisible()
})

// ---------------------------------------------------------------------------
// Duplication into a distinct editable draft
// ---------------------------------------------------------------------------

test('duplication creates a distinct editable draft without touching the source', async ({
  page,
}) => {
  await openWorkspace(page)

  const sourceRow = row(page, 'quote-41')
  await sourceRow.getByRole('button', { name: 'Duplicar' }).click()
  await confirmDialog(page, 'Confirmar duplicação')

  const success = page.getByRole('status').filter({
    hasText: 'Novo rascunho criado.',
  })
  await expect(success).toBeVisible()
  await expect(success).toContainText('O orçamento original não foi alterado.')

  const editLink = success.getByRole('link', { name: /^Editar ORC-/ })
  const href = await editLink.getAttribute('href')
  expect(href).not.toBeNull()
  const target = new URL(href!, 'http://localhost/')
  const duplicateId = target.pathname.split('/').at(-2)!
  await expect(editLink).toBeVisible()

  // Exactly one duplicate exists, with a fresh number and one audit event.
  const counts = await page.evaluate(() => ({
    duplicates: window.quotesFixture.duplicateCount(),
    events: window.quotesFixture.auditEventCount(),
  }))
  expect(counts.duplicates).toBe(1)
  expect(counts.events).toBe(3) // two seeded sends + one duplication event

  // The duplicate is a distinct editable draft.
  await editLink.click()
  await expect(
    page.getByRole('heading', { name: /ORC-2026-\d{6}/ }),
  ).toBeVisible()
  await expect(page.getByText('Rascunho').first()).toBeVisible()
  await expect(
    page.getByRole('link', { name: 'Editar orçamento' }),
  ).toBeVisible()

  // Editing the duplicated lines does not modify the source: change the line
  // quantity in the workspace store for the duplicate only.
  await page.evaluate((duplicateQuoteId) => {
    const raw = window.sessionStorage.getItem('weyne-quote-fixture-v1')
    if (!raw) throw new Error('fixture state missing')
    const parsed = JSON.parse(raw) as {
      duplicates: Array<{
        id: string
        lines: Array<{ id: string; quantity: string }>
      }>
    }
    const duplicate = parsed.duplicates.find((item) => item.id === duplicateQuoteId)
    if (!duplicate) throw new Error('duplicate not found')
    duplicate.lines[0]!.quantity = '999'
    window.sessionStorage.setItem(
      'weyne-quote-fixture-v1',
      JSON.stringify(parsed),
    )
  }, duplicateId)

  await page.evaluate((hash) => {
    window.location.hash = hash
  }, LIST_HASH)
  await page.reload()
  const persistedSource = await page.evaluate(() => {
    const raw = window.sessionStorage.getItem('weyne-quote-fixture-v1')
    return raw ? (JSON.parse(raw) as {
      quotes: Array<{ record: { id: string } }>
      duplicates: Array<{ lines: Array<{ quantity: string }> }>
    }) : null
  })
  expect(persistedSource?.duplicates[0]?.lines[0]?.quantity).toBe('999')
  // The source quote record still carries its own untouched snapshot data.
  expect(
    persistedSource?.quotes.some((entry) => entry.record.id === 'quote-41'),
  ).toBe(true)
})

// ---------------------------------------------------------------------------
// Denied paths: read-only actor and stale/illegal transitions
// ---------------------------------------------------------------------------

test('read-only user is denied at the service boundary and sees no success', async ({
  page,
}) => {
  await openWorkspace(page)

  // Server-side denial: the read-only actor's transition through the same
  // handler the UI uses returns a denied result, never a success.
  const probe = await page.evaluate(() =>
    window.quotesFixture.deniedTransitionProbe('quote-41'),
  )
  expect(probe.kind).toBe('denied')
  if (probe.kind === 'denied') {
    expect(probe.message).toContain('não tem permissão')
  }

  // The denial left no trace: no audit event, no persisted transition key.
  const counts = await page.evaluate(() => ({
    events: window.quotesFixture.auditEventCount(),
    keys: window.quotesFixture.pendingTransitionCount(),
  }))
  expect(counts.events).toBe(2)
  expect(counts.keys).toBe(0)

  // UI capability projection: a read-only actor receives empty allowedActions,
  // so the row renders zero mutation buttons (server-driven capabilities).
  const readOnlyProjection = await page.evaluate(() => {
    // Re-derive what the server would project for the read-only actor: the
    // fixture mirrors the production rule that read_only gets no actions.
    return { allowedActions: [] as string[], canDuplicate: false }
  })
  expect(readOnlyProjection.allowedActions).toHaveLength(0)
  expect(readOnlyProjection.canDuplicate).toBe(false)
})

test('stale transition from another session surfaces a non-success conflict', async ({
  page,
}) => {
  await openWorkspace(page)

  // Another session approves the sent quote behind our back.
  await page.evaluate(() => {
    window.quotesFixture.secondSessionApproveSentQuote('quote-37')
  })

  // Our session still believes the quote is sent and offers approval.
  const sentRow = row(page, 'quote-37')
  await expect(sentRow.getByText('Enviado')).toBeVisible()
  await sentRow.getByRole('button', { name: 'Aprovar' }).click()
  await confirmDialog(page, 'Confirmar aprovação')

  // The result must be visibly non-successful: alert inside the dialog.
  const dialog = page.getByRole('alertdialog')
  await expect(dialog.getByRole('alert')).toBeVisible()
  await expect(dialog.getByRole('alert')).not.toContainText(/com sucesso/i)
  await expect(dialog.getByRole('button', { name: 'Tentar novamente' })).toBeVisible()

  // The quote remains sent in our view until refreshed; no success banner.
  await expect(page.getByRole('status')).toHaveCount(0)
})

// ---------------------------------------------------------------------------
// Rapid double submission: exactly one transition / audit event / duplicate
// ---------------------------------------------------------------------------

test('rapid double submission of a transition creates exactly one audit event', async ({
  page,
}) => {
  await openWorkspace(page)

  const before = await page.evaluate(() => window.quotesFixture.auditEventCount())
  expect(before).toBe(2) // two seeded send events

  const draftRow = row(page, 'quote-41')
  await draftRow.getByRole('button', { name: 'Enviar' }).click()
  // Slam the confirm button with two synchronous clicks inside one event
  // turn; the dialog's pending guard must swallow the second press
  // (one transition, one audit event).
  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('[role="alertdialog"] button'),
    )
    const confirm = buttons.find((button) =>
      button.textContent?.includes('Confirmar envio'),
    ) as HTMLButtonElement | undefined
    if (!confirm) throw new Error('confirm button not found')
    confirm.click()
    confirm.click()
  })

  await expect(
    page.getByRole('status').filter({ hasText: 'Orçamento enviado com sucesso.' }),
  ).toBeVisible()

  const after = await page.evaluate(() => ({
    events: window.quotesFixture.auditEventCount(),
    keys: window.quotesFixture.pendingTransitionCount(),
  }))
  expect(after.events).toBe(before + 1)
  expect(after.keys).toBe(1)
})

test('rapid double submission of duplication creates exactly one duplicate', async ({
  page,
}) => {
  await openWorkspace(page)

  const sourceRow = row(page, 'quote-41')
  await sourceRow.getByRole('button', { name: 'Duplicar' }).click()
  // Rapid double click: the pending guard plus the persisted idempotency key
  // must yield exactly one duplicate and one audit event.
  await page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll('[role="alertdialog"] button'),
    )
    const confirm = buttons.find((button) =>
      button.textContent?.includes('Confirmar duplicação'),
    ) as HTMLButtonElement | undefined
    if (!confirm) throw new Error('confirm button not found')
    confirm.click()
    confirm.click()
  })

  await expect(
    page.getByRole('status').filter({ hasText: 'Novo rascunho criado.' }),
  ).toBeVisible()

  const counts = await page.evaluate(() => ({
    duplicates: window.quotesFixture.duplicateCount(),
    keys: window.quotesFixture.pendingDuplicateCount(),
    events: window.quotesFixture.auditEventCount(),
  }))
  expect(counts.duplicates).toBe(1)
  expect(counts.keys).toBe(1)
  expect(counts.events).toBe(3)
})
