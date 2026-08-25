import { describe, expect, it } from 'vitest'

import { SINGLE_ORGANIZATION_TENANT_ID, evaluateRecordScope } from '@/lib/auth/commercial-scope'
import {
  QUOTE_COMMAND_CAPABILITIES,
  evaluateQuoteCommand,
} from '@/lib/quotes/command-authorization'

const TENANT = SINGLE_ORGANIZATION_TENANT_ID
const FOREIGN_TENANT = '99999999-0000-4000-8000-000000009999'

const scopeRow = (overrides: Partial<{
  tenantId: string
  ownerUserId: string
  assignedUserIds: readonly string[]
}> = {}) => ({
  tenantId: TENANT,
  ownerUserId: 'rep-1',
  assignedUserIds: [] as readonly string[],
  ...overrides,
})

describe('evaluateRecordScope (matrix §2.2 over commercial records)', () => {
  it('lets admin locate any record in the single organization', () => {
    expect(
      evaluateRecordScope({
        role: 'admin',
        actorId: 'admin-1',
        resource: 'quote',
        row: scopeRow(),
      }),
    ).toBe('allow')
    expect(
      evaluateRecordScope({
        role: 'admin',
        actorId: 'admin-1',
        resource: 'order',
        row: scopeRow({ ownerUserId: 'someone-else' }),
      }),
    ).toBe('allow')
  })

  it('denies admin when the record carries no scope row', () => {
    expect(
      evaluateRecordScope({
        role: 'admin',
        actorId: 'admin-1',
        resource: 'quote',
        row: null,
      }),
    ).toBe('not_found')
  })

  it('resolves representative ownership and explicit assignment', () => {
    const actorId = 'rep-1'
    expect(
      evaluateRecordScope({
        role: 'representative',
        actorId,
        resource: 'quote',
        row: scopeRow({ ownerUserId: actorId }),
      }),
    ).toBe('allow')
    expect(
      evaluateRecordScope({
        role: 'representative',
        actorId: 'assignee-1',
        resource: 'quote',
        row: scopeRow({ assignedUserIds: ['assignee-1'] }),
      }),
    ).toBe('allow')
  })

  it('hides unassigned records from representatives as not_found', () => {
    expect(
      evaluateRecordScope({
        role: 'representative',
        actorId: 'outsider',
        resource: 'quote',
        row: scopeRow(),
      }),
    ).toBe('not_found')
    expect(
      evaluateRecordScope({
        role: 'representative',
        actorId: 'outsider',
        resource: 'order',
        row: scopeRow(),
      }),
    ).toBe('not_found')
  })

  it('gives read_only actors ONLY explicit assignment — never ownership', () => {
    expect(
      evaluateRecordScope({
        role: 'read_only',
        actorId: 'reader-1',
        resource: 'quote',
        row: scopeRow({ assignedUserIds: ['reader-1'] }),
      }),
    ).toBe('allow')
    // Owner but not assigned: S3/S4 forbids implicit ownership.
    expect(
      evaluateRecordScope({
        role: 'read_only',
        actorId: 'rep-1',
        resource: 'quote',
        row: scopeRow(),
      }),
    ).toBe('not_found')
  })

  it('never leaks foreign-tenant rows regardless of role', () => {
    for (const role of ['admin', 'representative', 'read_only'] as const) {
      expect(
        evaluateRecordScope({
          role,
          actorId: 'rep-1',
          resource: 'order',
          row: scopeRow({ tenantId: FOREIGN_TENANT, ownerUserId: 'rep-1' }),
        }),
      ).toBe('not_found')
    }
  })

  it('fails closed on a missing row for every non-admin role', () => {
    for (const role of ['representative', 'read_only'] as const) {
      expect(
        evaluateRecordScope({
          role,
          actorId: 'anyone',
          resource: 'quote',
          row: null,
        }),
      ).toBe('not_found')
    }
  })
})

describe('evaluateQuoteCommand (centralized matrix decisions)', () => {
  it('maps each lifecycle/duplication/conversion command to its matrix capability', () => {
    expect(QUOTE_COMMAND_CAPABILITIES.sendQuote).toBe('quote.send')
    expect(QUOTE_COMMAND_CAPABILITIES.reopenQuote).toBe('quote.update_operational')
    expect(QUOTE_COMMAND_CAPABILITIES.approveQuote).toBe('quote.approve')
    expect(QUOTE_COMMAND_CAPABILITIES.rejectQuote).toBe('quote.reject')
    expect(QUOTE_COMMAND_CAPABILITIES.cancelQuote).toBe('quote.cancel')
    expect(QUOTE_COMMAND_CAPABILITIES.duplicateQuote).toBe('quote.duplicate')
    expect(QUOTE_COMMAND_CAPABILITIES.convertQuote).toBe('quote.convert')
  })

  it('allows the representative send/cancel/duplicate/convert own quotes', () => {
    for (const command of ['sendQuote', 'cancelQuote', 'duplicateQuote', 'convertQuote'] as const) {
      expect(
        evaluateQuoteCommand({ actor: { id: 'rep-1', role: 'representative' }, ownerUserId: 'rep-1', command }),
      ).toBe('allow')
    }
  })

  it('forbids representative approve/reject/expire anywhere (S6)', () => {
    for (const command of ['approveQuote', 'rejectQuote'] as const) {
      expect(
        evaluateQuoteCommand({ actor: { id: 'rep-1', role: 'representative' }, ownerUserId: 'rep-1', command }),
      ).toBe('forbidden')
    }
    expect(
      evaluateQuoteCommand({
        actor: { id: 'system-job', role: 'system' },
        ownerUserId: 'rep-1',
        command: 'expireQuote',
      }),
    ).toBe('not_found')
  })

  it('expires only through the dedicated system identity grant (§11)', () => {
    expect(
      evaluateQuoteCommand({
        actor: { id: 'job', role: 'system', permissions: ['system:expire_quotes'] },
        ownerUserId: 'rep-1',
        command: 'expireQuote',
      }),
    ).toBe('allow')
    expect(
      evaluateQuoteCommand({
        actor: { id: 'job', role: 'system', permissions: ['quotes:decide:any'] },
        ownerUserId: 'rep-1',
        command: 'expireQuote',
      }),
    ).toBe('not_found')
    expect(
      evaluateQuoteCommand({
        actor: { id: 'admin-1', role: 'admin' },
        ownerUserId: 'rep-1',
        command: 'expireQuote',
      }),
    ).toBe('not_found')
  })

  it('denies read_only every mutation command (S4)', () => {
    for (const command of [
      'sendQuote',
      'reopenQuote',
      'approveQuote',
      'rejectQuote',
      'cancelQuote',
      'duplicateQuote',
      'convertQuote',
    ] as const) {
      expect(
        evaluateQuoteCommand({ actor: { id: 'reader', role: 'read_only' }, ownerUserId: 'reader', command }),
      ).toBe('forbidden')
    }
    // Even with the dedicated system grant, a human read_only cannot expire.
    expect(
      evaluateQuoteCommand({
        actor: { id: 'reader', role: 'read_only', permissions: ['system:expire_quotes'] },
        ownerUserId: 'reader',
        command: 'expireQuote',
      }),
    ).toBe('not_found')
  })

  it('lets admin act anywhere but hides out-of-scope commands as not_found', () => {
    expect(
      evaluateQuoteCommand({ actor: { id: 'admin-x', role: 'admin' }, ownerUserId: 'other', command: 'approveQuote' }),
    ).toBe('allow')
  })

  it('reports out-of-scope human commands as not_found so IDs cannot be enumerated', () => {
    expect(
      evaluateQuoteCommand({
        actor: { id: 'rep-b', role: 'representative' },
        ownerUserId: 'rep-a',
        command: 'convertQuote',
      }),
    ).toBe('not_found')
    expect(
      evaluateQuoteCommand({
        actor: { id: 'rep-b', role: 'representative' },
        ownerUserId: 'rep-a',
        command: 'cancelQuote',
      }),
    ).toBe('not_found')
  })
})
