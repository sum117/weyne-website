/**
 * Centralized RBAC contract: the capability catalog and the role-to-capability
 * matrix.
 *
 * SAFE IN THE BROWSER. Like `contract.ts`, this module holds only data and
 * pure functions — no server-only import, so route components, nav menus, and
 * capability-driven UI visibility (card `t_d3e33344`) can share the exact
 * matrix the server enforces without dragging `auth.server.ts` into a client
 * chunk. UI use is presentation only; every server function re-derives the
 * decision from the request cookie through
 * `requireCapability()` (`authorization.server.ts`).
 *
 * SINGLE SOURCE OF TRUTH. This file transcribes
 * `docs/domain/role-permission-matrix.md` (card `t_3091b9b9`), which remains
 * the authoritative policy document: a change to authorization policy happens
 * in the matrix doc FIRST, then lands here as code. Consumers must never
 * compare role strings or restate permissions locally — they name a
 * capability and ask the matrix. The transcription tests in
 * `tests/unit/rbac-capability-matrix.test.ts` pin this file against the doc's
 * normative tables so drift fails the build.
 *
 * Naming conventions:
 * - Capabilities are `<resource>.<verb>` in English, matching the command
 *   vocabulary of the matrix document one cell at a time.
 * - A resource with per-record scope gets a paired `<resource>.scope`
 *   capability whose value names how the actor may locate records
 *   (`all`, `own_assigned`, `explicit_assigned`, `active_catalog`, `none`);
 *   workflow commands inherit their parent resource's scope.
 * - Field-class projections (O/F1/F2/W) and record-state preconditions are
 *   domain concerns (matrix §4, §12): the catalog says WHO may attempt a
 *   command, never WHAT a draft contains. State precedence (S11) is enforced
 *   by the owning domain service after authorization.
 */

import type { AppSessionRole } from './contract'

export type Role = AppSessionRole

/**
 * How an actor may locate records of a scoped resource, before any
 * state/precondition check. Mirrors matrix §2.2.
 */
export type RecordScope =
  | 'all'
  | 'own_assigned'
  | 'explicit_assigned'
  | 'active_catalog'
  | 'none'

/**
 * Every authorization decision the application can make for a role,
 * expressed as one string literal union member. Adding a command to the
 * matrix means adding it here; forgetting to means the compiler — not a
 * silent default — catches it at every call site that switches on it.
 */
export const CAPABILITIES = [
  // Users, assignments, audit, settings (matrix §11; settings service).
  'user.create',
  'user.update_role',
  'user.disable',
  'assignment.create',
  'assignment.revoke',
  'audit.view',
  'settings.read',
  'settings.update',

  // Customer master data (§5).
  'customer.create',
  'customer.view',
  'customer.list',
  'customer.update_operational',
  'customer.update_credit_limit',
  'customer.assign',
  'customer.unassign',
  'customer.archive',
  'customer.restore',

  // Industry and carrier catalogs (§6).
  'industry.create',
  'industry.view',
  'industry.update_operational',
  'industry.archive',
  'industry.restore',
  'carrier.create',
  'carrier.view',
  'carrier.update_operational',
  'carrier.archive',
  'carrier.restore',

  // Product catalog and product files (§7). NOTE: `product.setCommissionOverride`
  // is an INTERNAL ALIAS of commission-rule management (§7), not a separate
  // capability — the canonical surface is `commission_rule.manage`.
  'product.create',
  'product.view',
  'product.update_operational',
  'product.update_tax_catalog_data',
  'product.manage_files',
  'product.view_files',
  'product.archive',
  'product.restore',

  // Prices and commission rules (§8).
  'price_list.view',
  'price_list.manage',
  'commission_rule.view',
  'commission_rule.manage',

  // Quote registration and content (§9.1).
  'quote.create',
  'quote.view',
  'quote.update_operational',
  'quote.edit_lines',
  'quote.select_price_list',
  'quote.override_unit_price',
  'quote.set_discount',
  'quote.set_logistics',
  'quote.reassign',
  'quote.duplicate',
  'quote.generate_pdf',

  // Quote workflow (§9.2). System jobs do NOT appear here: they run under a
  // dedicated system identity with exactly one granted command (§11), never
  // as a role in this matrix.
  'quote.send',
  'quote.approve',
  'quote.reject',
  'quote.expire',
  'quote.cancel',
  'quote.convert',

  // Order registration and content (§10.1).
  'order.view',
  'order.update_operational',
  'order.reassign',
  'order.add_attachment',
  'order.remove_attachment',
  'order.view_attachment',

  // Order workflow (§10.2).
  'order.confirm',
  'order.mark_invoiced',
  'order.complete',
  'order.cancel',

  // Exports and reports (§11). Phase 1 ships no export endpoint: the
  // capabilities exist so downstream cards cannot mint them silently —
  // granting nothing today, they are reserved vocabulary.
  'export.customers',
  'export.quotes',
  'export.orders',
] as const

export type Capability = (typeof CAPABILITIES)[number]

/**
 * Commands that do not exist in Phase 1 for ANY role (matrix rows marked
 * N/S). They are deliberately absent from `CAPABILITIES`: asking for one via
 * `authorize()` is a compile error, and a caller holding an arbitrary string
 * gets `unsupported_command`, never a silent pass. Listed here so tests can
 * pin the N/S set explicitly.
 */
export const UNSUPPORTED_COMMANDS = [
  'customer.delete',
  'industry.delete',
  'carrier.delete',
  'product.delete',
  'price_history.view',
  'quote.archive',
  'quote.restore',
  'quote.delete',
  'order.create_direct',
  'order.update_price',
  'order.update_discount',
  'order.update_commission',
  'order.generate_pdf',
  'order.archive',
  'order.restore',
  'order.delete',
  'report.commissions',
] as const

export type UnsupportedCommand = (typeof UNSUPPORTED_COMMANDS)[number]

export const SCOPED_RESOURCES = [
  'customer',
  'industry',
  'carrier',
  'product',
  'price_list',
  'commission_rule',
  'quote',
  'order',
] as const

export type ScopedResource = (typeof SCOPED_RESOURCES)[number]

/** The `<resource>.scope` key for a scoped resource. */
export type ScopeKey = `${ScopedResource}.scope`

/**
 * The matrix shape: command capabilities carry a boolean; each scoped
 * resource additionally carries one `<resource>.scope` row naming how the
 * role may locate records. TypeScript's excess-property check on the
 * `satisfies` below enforces that every role defines EXACTLY this set —
 * no role can quietly omit or invent rows.
 */
export type RoleMatrixRow = Readonly<Record<Capability, boolean> & Record<ScopeKey, RecordScope>>

export type RoleMatrix = Readonly<Record<Role, RoleMatrixRow>>

export const ROLE_MATRIX: RoleMatrix = {
  admin: {
    // §11 + settings service: full administration.
    'user.create': true,
    'user.update_role': true,
    'user.disable': true,
    'assignment.create': true,
    'assignment.revoke': true,
    'audit.view': true,
    'settings.read': true,
    'settings.update': true,

    // §5: ALL, including archived records and restore.
    'customer.scope': 'all',
    'customer.create': true,
    'customer.view': true,
    'customer.list': true,
    'customer.update_operational': true,
    'customer.update_credit_limit': true,
    'customer.assign': true,
    'customer.unassign': true,
    'customer.archive': true,
    'customer.restore': true,

    // §6: global catalog, all states.
    'industry.scope': 'all',
    'industry.create': true,
    'industry.view': true,
    'industry.update_operational': true,
    'industry.archive': true,
    'industry.restore': true,
    'carrier.scope': 'all',
    'carrier.create': true,
    'carrier.view': true,
    'carrier.update_operational': true,
    'carrier.archive': true,
    'carrier.restore': true,

    // §7: full product administration, including commission override and
    // technical/safety sheet management.
    'product.scope': 'all',
    'product.create': true,
    'product.view': true,
    'product.update_operational': true,
    'product.update_tax_catalog_data': true,
    'product.manage_files': true,
    'product.view_files': true,
    'product.archive': true,
    'product.restore': true,

    // §8: prices visible with values; full price-list and rule management.
    'price_list.scope': 'all',
    'price_list.view': true,
    'price_list.manage': true,
    'commission_rule.scope': 'all',
    'commission_rule.view': true,
    'commission_rule.manage': true,

    // §9.1/9.2: everything, everywhere, all states.
    'quote.scope': 'all',
    'quote.create': true,
    'quote.view': true,
    'quote.update_operational': true,
    'quote.edit_lines': true,
    'quote.select_price_list': true,
    'quote.override_unit_price': true,
    'quote.set_discount': true,
    'quote.set_logistics': true,
    'quote.reassign': true,
    'quote.duplicate': true,
    'quote.generate_pdf': true,
    'quote.send': true,
    'quote.approve': true,
    'quote.reject': true,
    'quote.expire': true,
    'quote.cancel': true,
    'quote.convert': true,

    // §10: everything except the immutable-snapshot edits, which no role has.
    'order.scope': 'all',
    'order.view': true,
    'order.update_operational': true,
    'order.reassign': true,
    'order.add_attachment': true,
    'order.remove_attachment': true,
    'order.view_attachment': true,
    'order.confirm': true,
    'order.mark_invoiced': true,
    'order.complete': true,
    'order.cancel': true,

    // §11: exports are Phase 2; granted to nobody yet (see RESERVED note).
    'export.customers': false,
    'export.quotes': false,
    'export.orders': false,
  },

  representative: {
    // §11: none of these.
    'user.create': false,
    'user.update_role': false,
    'user.disable': false,
    'assignment.create': false,
    'assignment.revoke': false,
    'audit.view': false,
    // Settings are admin-only for read AND write (least privilege default;
    // the settings service already enforces admin-only reads).
    'settings.read': false,
    'settings.update': false,

    // §5: OWN_ASSIGNED; creates own; no credit limit, assignment, archive,
    // or restore.
    'customer.scope': 'own_assigned',
    'customer.create': true,
    'customer.view': true,
    'customer.list': true,
    'customer.update_operational': true,
    'customer.update_credit_limit': false,
    'customer.assign': false,
    'customer.unassign': false,
    'customer.archive': false,
    'customer.restore': false,

    // §6/§7: active global catalog, redacted projection (F2 hidden); no
    // mutations, no archived history outside documents.
    'industry.scope': 'active_catalog',
    'industry.create': false,
    'industry.view': true,
    'industry.update_operational': false,
    'industry.archive': false,
    'industry.restore': false,
    'carrier.scope': 'active_catalog',
    'carrier.create': false,
    'carrier.view': true,
    'carrier.update_operational': false,
    'carrier.archive': false,
    'carrier.restore': false,

    // §7: active catalog view incl. current price needed to quote and file
    // viewing; no mutation, no overrides, no restore.
    'product.scope': 'active_catalog',
    'product.create': false,
    'product.view': true,
    'product.update_operational': false,
    'product.update_tax_catalog_data': false,
    'product.manage_files': false,
    'product.view_files': true,
    'product.archive': false,
    'product.restore': false,

    // §8: current values visible for quoting; no management, no rules.
    'price_list.scope': 'active_catalog',
    'price_list.view': true,
    'price_list.manage': false,
    'commission_rule.scope': 'none',
    'commission_rule.view': false,
    'commission_rule.manage': false,

    // §9: own quotes; selects active lists; NEVER overrides price or sets
    // discount (S7); sends and cancels pre-approval; converts own approved;
    // approval/rejection/expiry are admin-only (S6).
    'quote.scope': 'own_assigned',
    'quote.create': true,
    'quote.view': true,
    'quote.update_operational': true,
    'quote.edit_lines': true,
    'quote.select_price_list': true,
    'quote.override_unit_price': false,
    'quote.set_discount': false,
    'quote.set_logistics': true,
    'quote.reassign': false,
    'quote.duplicate': true,
    'quote.generate_pdf': true,
    'quote.send': true,
    'quote.approve': false,
    'quote.reject': false,
    'quote.expire': false,
    'quote.cancel': true,
    'quote.convert': true,

    // §10: own orders; operational notes and attachments within state
    // limits; confirm/invoice/complete/cancel are admin-only (S9).
    'order.scope': 'own_assigned',
    'order.view': true,
    'order.update_operational': true,
    'order.reassign': false,
    'order.add_attachment': true,
    'order.remove_attachment': true,
    'order.view_attachment': true,
    'order.confirm': false,
    'order.mark_invoiced': false,
    'order.complete': false,
    'order.cancel': false,

    'export.customers': false,
    'export.quotes': false,
    'export.orders': false,
  },

  read_only: {
    'user.create': false,
    'user.update_role': false,
    'user.disable': false,
    'assignment.create': false,
    'assignment.revoke': false,
    'audit.view': false,
    'settings.read': false,
    'settings.update': false,

    // §5: EXPLICIT_ASSIGNED only; no creation, no mutation (S3/S4).
    'customer.scope': 'explicit_assigned',
    'customer.create': false,
    'customer.view': true,
    'customer.list': true,
    'customer.update_operational': false,
    'customer.update_credit_limit': false,
    'customer.assign': false,
    'customer.unassign': false,
    'customer.archive': false,
    'customer.restore': false,

    // §6/§7: active catalog, O-only projection; no downloads of archived
    // history (S4/HISTORICAL_REFERENCE).
    'industry.scope': 'active_catalog',
    'industry.create': false,
    'industry.view': true,
    'industry.update_operational': false,
    'industry.archive': false,
    'industry.restore': false,
    'carrier.scope': 'active_catalog',
    'carrier.create': false,
    'carrier.view': true,
    'carrier.update_operational': false,
    'carrier.archive': false,
    'carrier.restore': false,

    // §7: view only, no prices (S8), no file content by default.
    'product.scope': 'active_catalog',
    'product.create': false,
    'product.view': true,
    'product.update_operational': false,
    'product.update_tax_catalog_data': false,
    'product.manage_files': false,
    'product.view_files': false,
    'product.archive': false,
    'product.restore': false,

    // §8: catalog structure without values; no rules at all.
    'price_list.scope': 'active_catalog',
    'price_list.view': true,
    'price_list.manage': false,
    'commission_rule.scope': 'none',
    'commission_rule.view': false,
    'commission_rule.manage': false,

    // §9/§10: explicit-assigned reads only; every workflow and content
    // command denied (S4, §13.2).
    'quote.scope': 'explicit_assigned',
    'quote.create': false,
    'quote.view': true,
    'quote.update_operational': false,
    'quote.edit_lines': false,
    'quote.select_price_list': false,
    'quote.override_unit_price': false,
    'quote.set_discount': false,
    'quote.set_logistics': false,
    'quote.reassign': false,
    'quote.duplicate': false,
    'quote.generate_pdf': false,
    'quote.send': false,
    'quote.approve': false,
    'quote.reject': false,
    'quote.expire': false,
    'quote.cancel': false,
    'quote.convert': false,

    'order.scope': 'explicit_assigned',
    'order.view': true,
    'order.update_operational': false,
    'order.reassign': false,
    'order.add_attachment': false,
    'order.remove_attachment': false,
    'order.view_attachment': false,
    'order.confirm': false,
    'order.mark_invoiced': false,
    'order.complete': false,
    'order.cancel': false,

    'export.customers': false,
    'export.quotes': false,
    'export.orders': false,
  },
} satisfies RoleMatrix

/** True when the role holds the capability, ignoring record scope. */
export function hasCapability(role: Role, capability: Capability): boolean {
  return ROLE_MATRIX[role][capability] === true
}

/**
 * The record scope the role may use for a scoped resource. Resources whose
 * commands are uniformly allowed-or-denied (users, settings, exports) have
 * no scope row: there is nothing to locate.
 */
export function recordScope(role: Role, resource: ScopedResource): RecordScope {
  return ROLE_MATRIX[role][`${resource}.scope` satisfies ScopeKey]
}

/**
 * Pure authorization decision for a role/capability pair. This is the
 * matrix lookup UI and server helpers share; it carries NO session and NO
 * request context, so it is trivially testable.
 */
export function authorize(
  role: Role,
  capability: Capability,
): 'allow' | 'forbidden' {
  return hasCapability(role, capability) ? 'allow' : 'forbidden'
}
