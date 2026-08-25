/**
 * Pure command-authorization for the quote lifecycle, duplication, and
 * conversion services, derived from the CENTRALIZED capability matrix
 * (`capabilities.ts`) instead of per-service permission-string arrays.
 *
 * This replaces the scattered `quotes:<command>:any|own` permission-string
 * scheme: the matrix remains the single source of truth, and record scope is
 * computed by `recordScope(role, 'quote')` exactly as the matrix §2.2
 * prescribes. The system identity keeps its single dedicated command
 * (`system:expire_quotes`) — it never maps to a human role (matrix §11).
 *
 * SAFE IN THE BROWSER: pure data and functions only. Server functions call
 * these through their service boundary after session resolution.
 */

import { authorize, hasCapability, type Role } from '../auth/capabilities'

export interface ScopedCommandActor {
  readonly id: string
  readonly role: Role | 'system'
  /** Dedicated grant for the system identity; ignored for human roles. */
  readonly permissions?: readonly string[]
}

/**
 * The lifecycle/duplication/conversion commands and their capabilities.
 * `expireQuote` is intentionally absent: no human role holds it — the matrix
 * routes expiry through the dedicated system identity (§11), checked below.
 */
export const QUOTE_COMMAND_CAPABILITIES = Object.freeze({
  sendQuote: 'quote.send',
  reopenQuote: 'quote.update_operational',
  approveQuote: 'quote.approve',
  rejectQuote: 'quote.reject',
  cancelQuote: 'quote.cancel',
  duplicateQuote: 'quote.duplicate',
  convertQuote: 'quote.convert',
} as const)

export type HumanQuoteCommand = keyof typeof QUOTE_COMMAND_CAPABILITIES
export type QuoteCommand = HumanQuoteCommand | 'expireQuote'

export type RecordCommandDecision = 'allow' | 'forbidden' | 'not_found'

/**
 * May this actor execute this command on a record owned by `ownerUserId`?
 *
 * - Capability check first (matrix): a denied role is FORBIDDEN only when the
 *   record is already legitimately visible; callers that have not yet proven
 *   visibility should treat any denial as NOT_FOUND to avoid leaking which
 *   records exist.
 * - Scope check second: non-admin roles may act ONLY inside their own
 *   assigned set (`own_assigned`).
 * - The system identity holds exactly one command and nothing else.
 */
export function evaluateQuoteCommand(input: {
  readonly actor: ScopedCommandActor
  readonly ownerUserId: string
  readonly command: QuoteCommand
}): RecordCommandDecision {
  const { actor, ownerUserId, command } = input

  if (actor.role === 'system') {
    return command === 'expireQuote'
      && actor.permissions?.includes('system:expire_quotes')
      ? 'allow'
      : 'not_found'
  }
  if (command === 'expireQuote') {
    // No human role may expire; expiry belongs to the system job alone.
    return 'not_found'
  }

  if (!hasCapability(actor.role, QUOTE_COMMAND_CAPABILITIES[command])) {
    return 'forbidden'
  }
  // Matrix §2.2: admin record scope is ALL — any document; every other human
  // role acts only on own-assigned records.
  if (actor.role === 'admin' || actor.id === ownerUserId) return 'allow'
  return 'not_found'
}

/**
 * Matrix-backed decision used where the legacy boolean API is still
 * consumed. Kept pure so services stay framework-free (catalog §4).
 */
export function isQuoteCommandAuthorized(input: {
  readonly actor: ScopedCommandActor
  readonly ownerUserId: string
  readonly command: QuoteCommand
}): boolean {
  return evaluateQuoteCommand(input) === 'allow'
}

/**
 * Convenience for read paths: does the role hold the quote-view capability
 * at all? Scope narrowing stays with `recordScope`.
 */
export function canViewQuotes(role: Role): boolean {
  return authorize(role, 'quote.view') === 'allow'
}
