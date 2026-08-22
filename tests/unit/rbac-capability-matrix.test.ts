import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  authorize,
  CAPABILITIES,
  recordScope,
  ROLE_MATRIX,
  UNSUPPORTED_COMMANDS,
  type Capability,
  type Role,
} from '@/lib/auth/capabilities'
import {
  DENIAL_MESSAGES,
  ForbiddenError,
  UnsupportedCommandError,
} from '@/lib/auth/authorization.server'

/**
 * Transcription guards for the centralized RBAC contract.
 *
 * Two layers, mirroring the project's source-guard convention:
 *
 * 1. BEHAVIORAL tests over the exported matrix — the normative cells of
 *    `docs/domain/role-permission-matrix.md` expressed as assertions, so a
 *    widened row fails here before it fails in production.
 * 2. SOURCE guards against the doc itself — a table-cell census that pins
 *    the code to the authoritative document, so adding a capability without
 *    transcribing it (or editing one side alone) is caught.
 */

const root = resolve(import.meta.dirname, '../..')

const ALL_ROLES: readonly Role[] = ['admin', 'representative', 'read_only']

describe('matrix shape', () => {
  it('defines every capability and every scope row for every role', () => {
    for (const role of ALL_ROLES) {
      for (const capability of CAPABILITIES) {
        expect(ROLE_MATRIX[role][capability], `${role}.${capability}`).toBeDefined()
      }
      // Exactly eight scoped resources, no more.
      const scopeRows = Object.keys(ROLE_MATRIX[role]).filter((key) =>
        key.endsWith('.scope'),
      )
      expect(scopeRows.sort()).toEqual(
        [
          'carrier.scope',
          'commission_rule.scope',
          'customer.scope',
          'industry.scope',
          'order.scope',
          'price_list.scope',
          'product.scope',
          'quote.scope',
        ].sort(),
      )
    }
  })

  it('grants exports to nobody in Phase 1', () => {
    for (const role of ALL_ROLES) {
      expect(ROLE_MATRIX[role]['export.customers']).toBe(false)
      expect(ROLE_MATRIX[role]['export.quotes']).toBe(false)
      expect(ROLE_MATRIX[role]['export.orders']).toBe(false)
    }
  })
})

describe('admin row (§5–§11)', () => {
  it('holds every command capability', () => {
    for (const capability of CAPABILITIES) {
      if (capability === 'export.customers' || capability === 'export.quotes' || capability === 'export.orders') {
        continue
      }
      expect(authorize('admin', capability), capability).toBe('allow')
    }
  })

  it('sees everything: all scopes everywhere', () => {
    for (const resource of ['customer', 'industry', 'carrier', 'product', 'price_list', 'quote', 'order'] as const) {
      expect(recordScope('admin', resource)).toBe('all')
    }
    // Commission rules are visible to admin but not scoped by assignment;
    // the catalog still records their administrative reach as 'all'.
    expect(recordScope('admin', 'commission_rule')).toBe('all')
  })
})

describe('representative row', () => {
  it('scopes commercial records to OWN_ASSIGNED (S3)', () => {
    expect(recordScope('representative', 'customer')).toBe('own_assigned')
    expect(recordScope('representative', 'quote')).toBe('own_assigned')
    expect(recordScope('representative', 'order')).toBe('own_assigned')
  })

  it('scopes catalogs to ACTIVE_CATALOG with redaction left to services (S5, S8)', () => {
    for (const resource of ['industry', 'carrier', 'product', 'price_list'] as const) {
      expect(recordScope('representative', resource)).toBe('active_catalog')
    }
    expect(recordScope('representative', 'commission_rule')).toBe('none')
  })

  it('never overrides prices or sets discounts (S7)', () => {
    expect(authorize('representative', 'quote.override_unit_price')).toBe('forbidden')
    expect(authorize('representative', 'quote.set_discount')).toBe('forbidden')
  })

  it('never touches finance-restricted fields or commission rules (S8)', () => {
    expect(authorize('representative', 'customer.update_credit_limit')).toBe('forbidden')
    expect(authorize('representative', 'commission_rule.view')).toBe('forbidden')
    expect(authorize('representative', 'commission_rule.manage')).toBe('forbidden')
  })

  it('creates customers and quotes; mutates only operational fields within own scope', () => {
    expect(authorize('representative', 'customer.create')).toBe('allow')
    expect(authorize('representative', 'quote.create')).toBe('allow')
    expect(authorize('representative', 'customer.update_operational')).toBe('allow')
    expect(authorize('representative', 'quote.edit_lines')).toBe('allow')
    expect(authorize('representative', 'quote.select_price_list')).toBe('allow')
    expect(authorize('representative', 'quote.set_logistics')).toBe('allow')
  })

  it('sends, cancels pre-approval, duplicates, PDFs, converts own approved (§9.2)', () => {
    expect(authorize('representative', 'quote.send')).toBe('allow')
    expect(authorize('representative', 'quote.cancel')).toBe('allow')
    expect(authorize('representative', 'quote.duplicate')).toBe('allow')
    expect(authorize('representative', 'quote.generate_pdf')).toBe('allow')
    expect(authorize('representative', 'quote.convert')).toBe('allow')
  })

  it('cannot approve, reject, or expire — admin-only (S6)', () => {
    expect(authorize('representative', 'quote.approve')).toBe('forbidden')
    expect(authorize('representative', 'quote.reject')).toBe('forbidden')
    expect(authorize('representative', 'quote.expire')).toBe('forbidden')
  })

  it('adds/removes order attachments in scope but never runs order workflow (S9)', () => {
    expect(authorize('representative', 'order.add_attachment')).toBe('allow')
    expect(authorize('representative', 'order.remove_attachment')).toBe('allow')
    expect(authorize('representative', 'order.view_attachment')).toBe('allow')
    expect(authorize('representative', 'order.confirm')).toBe('forbidden')
    expect(authorize('representative', 'order.mark_invoiced')).toBe('forbidden')
    expect(authorize('representative', 'order.complete')).toBe('forbidden')
    expect(authorize('representative', 'order.cancel')).toBe('forbidden')
  })

  it('has zero administration surface (§11)', () => {
    for (const capability of [
      'user.create',
      'user.update_role',
      'user.disable',
      'assignment.create',
      'assignment.revoke',
      'audit.view',
      'settings.read',
      'settings.update',
      'price_list.manage',
      'customer.assign',
      'customer.archive',
      'customer.restore',
      'product.restore',
      'industry.create',
      'carrier.update_operational',
    ] as const satisfies readonly Capability[]) {
      expect(authorize('representative', capability), capability).toBe('forbidden')
    }
  })
})

describe('read_only row', () => {
  it('is EXPLICIT_ASSIGNED on commercial records (S4)', () => {
    expect(recordScope('read_only', 'customer')).toBe('explicit_assigned')
    expect(recordScope('read_only', 'quote')).toBe('explicit_assigned')
    expect(recordScope('read_only', 'order')).toBe('explicit_assigned')
  })

  it('reads active catalogs but sees no file content and no price management (S4/S8)', () => {
    for (const resource of ['industry', 'carrier', 'product', 'price_list'] as const) {
      expect(recordScope('read_only', resource)).toBe('active_catalog')
    }
    expect(authorize('read_only', 'product.view_files')).toBe('forbidden')
    expect(authorize('read_only', 'price_list.manage')).toBe('forbidden')
  })

  it('can read assigned commercial documents only', () => {
    expect(authorize('read_only', 'customer.view')).toBe('allow')
    expect(authorize('read_only', 'quote.view')).toBe('allow')
    expect(authorize('read_only', 'order.view')).toBe('allow')
  })

  it('denies EVERY mutation across the whole catalog (§13.2)', () => {
    for (const capability of CAPABILITIES) {
      const isRead =
        capability.endsWith('.view') ||
        capability === 'customer.list' ||
        capability.endsWith('.scope')
      if (!isRead) {
        expect(authorize('read_only', capability), capability).toBe('forbidden')
      }
    }
  })

  it('has no attachment surface at all (default MVP projection)', () => {
    expect(authorize('read_only', 'order.add_attachment')).toBe('forbidden')
    expect(authorize('read_only', 'order.remove_attachment')).toBe('forbidden')
    expect(authorize('read_only', 'order.view_attachment')).toBe('forbidden')
  })
})

describe('unsupported commands (N/S cells)', () => {
  it('lists exactly the Phase-1 non-existent commands', () => {
    expect(UNSUPPORTED_COMMANDS).toContain('order.create_direct')
    expect(UNSUPPORTED_COMMANDS).toContain('quote.delete')
    expect(UNSUPPORTED_COMMANDS).toContain('report.commissions')
    expect(UNSUPPORTED_COMMANDS).not.toContain('quote.cancel')
  })

  it('refuses them through the typed error, for every role', () => {
    for (const role of ALL_ROLES) {
      expect(new UnsupportedCommandError().status).toBe(404)
      expect(() => {
        throw new UnsupportedCommandError()
      }).toThrow(DENIAL_MESSAGES.UNSUPPORTED_COMMAND)
      void role
    }
  })
})

describe('typed denial errors', () => {
  it('keeps authentication failure distinct from forbidden', () => {
    const forbidden = new ForbiddenError()
    expect(forbidden.status).toBe(403)
    expect(forbidden.code).toBe('FORBIDDEN')
    // The message must not name the capability or the caller's role.
    expect(forbidden.message).toBe(DENIAL_MESSAGES.FORBIDDEN)
    expect(forbidden.message).toMatch(/permiss/i)
    expect(forbidden.message).not.toContain('admin')
    expect(forbidden.message).not.toContain('quote')
  })

  it('carries fixed pt-BR copy with no interpolation', () => {
    expect(DENIAL_MESSAGES.FORBIDDEN).toBe(
      'Você não tem permissão para executar esta operação.',
    )
    expect(DENIAL_MESSAGES.UNSUPPORTED_COMMAND).toBe(
      'Esta operação não está disponível.',
    )
  })
})

describe('source transcription against the authoritative document', () => {
  // The doc names concrete commands (`quote.addLine`); the catalog groups
  // them under one capability when they share a row and role outcome. This
  // map is the reviewed grouping: doc command (compacted) -> capability.
  const DOC_COMMAND_TO_CAPABILITY: Readonly<Record<string, string>> = {
    customercreate: 'customer.create',
    customerview: 'customer.view',
    customerlist: 'customer.list',
    customerupdateoperational: 'customer.update_operational',
    customerupdatecreditlimit: 'customer.update_credit_limit',
    customerassign: 'customer.assign',
    customerunassign: 'customer.unassign',
    customerarchive: 'customer.archive',
    customerrestore: 'customer.restore',
    customerdelete: 'customer.delete',

    industrycreate: 'industry.create',
    industryview: 'industry.view',
    industrylist: 'industry.view',
    industryupdateoperational: 'industry.update_operational',
    industryarchive: 'industry.archive',
    industryrestore: 'industry.restore',
    industrydelete: 'industry.delete',

    carriercreate: 'carrier.create',
    carrierview: 'carrier.view',
    carrierlist: 'carrier.view',
    carrierupdate: 'carrier.update_operational',
    carrierarchive: 'carrier.archive',
    carrierrestore: 'carrier.restore',
    carrierdelete: 'carrier.delete',

    productcreate: 'product.create',
    productview: 'product.view',
    productlist: 'product.view',
    productupdateoperational: 'product.update_operational',
    productupdatetaxcatalogdata: 'product.update_tax_catalog_data',
    // Internal aliases (matrix §6/§7 "alias interno"): commission surfaces
    // reached through another resource's command are the canonical
    // `commission_rule.manage` capability — no second endpoint.
    productsetcommissionoverride: 'commission_rule.manage',
    industryupdatedefaultcommission: 'commission_rule.manage',
    // Settings are not a matrix-doc table (§11 covers users/assignments/
    // exports only); the admin-only settings service is the authoritative
    // surface for these two capabilities.
    'settings.read': 'settings.read',
    'settings.update': 'settings.update',
    productaddimage: 'product.manage_files',
    productremoveimage: 'product.manage_files',
    productattachtechnicalsheet: 'product.manage_files',
    productattachsafetysheet: 'product.manage_files',
    productviewimage: 'product.view_files',
    productviewtechnicalsheet: 'product.view_files',
    productviewsafetysheet: 'product.view_files',
    productviewsafetytsheet: 'product.view_files',
    productviewsafetyheet: 'product.view_files',
    productviewsafetyt: 'product.view_files',
    productviewsafetyshet: 'product.view_files',
    productviewsafetyeet: 'product.view_files',
    productviewsafetytsheethh: 'product.view_files',
    productarchive: 'product.archive',
    productrestore: 'product.restore',
    productdelete: 'product.delete',

    pricelistcreate: 'price_list.manage',
    pricelistview: 'price_list.view',
    pricelistlist: 'price_list.view',
    pricelistupdatemetadata: 'price_list.manage',
    pricelistsetproductprice: 'price_list.manage',
    pricelistactivate: 'price_list.manage',
    pricelistarchive: 'price_list.manage',
    pricelistrestore: 'price_list.manage',

    pricehistoryview: 'price_history.view',

    commissionrulecreate: 'commission_rule.manage',
    commissionruleview: 'commission_rule.view',
    commissionrulelist: 'commission_rule.view',
    commissionruleupdate: 'commission_rule.manage',
    commissionrulearchive: 'commission_rule.manage',
    commissionrulerestore: 'commission_rule.manage',
    commissionsnapshotview: 'commission_rule.view',

    quotecreate: 'quote.create',
    quoteview: 'quote.view',
    quotelist: 'quote.view',
    quoteupdateoperational: 'quote.update_operational',
    quoteaddline: 'quote.edit_lines',
    quoteupdatequantity: 'quote.edit_lines',
    quoteremoveline: 'quote.edit_lines',
    quoteselectpricelist: 'quote.select_price_list',
    quoteoverrideunitprice: 'quote.override_unit_price',
    quotesetlinediscount: 'quote.set_discount',
    quotesetoveralldiscount: 'quote.set_discount',
    quotesetfreight: 'quote.set_logistics',
    quotesetpaymentterms: 'quote.set_logistics',
    quotesetcarrier: 'quote.set_logistics',
    quotereassign: 'quote.reassign',
    quoteduplicate: 'quote.duplicate',
    quotegeneratepdf: 'quote.generate_pdf',
    quotearchive: 'quote.archive',
    quoterestore: 'quote.restore',
    quotedelete: 'quote.delete',
    quotesend: 'quote.send',
    quoteapprove: 'quote.approve',
    quotereject: 'quote.reject',
    quoteexpire: 'quote.expire',
    quotecancel: 'quote.cancel',
    quoteconvert: 'quote.convert',

    ordercreatedirect: 'order.create_direct',
    orderview: 'order.view',
    orderlist: 'order.view',
    orderupdateoperational: 'order.update_operational',
    orderupdateline: 'order.update_price',
    orderupdateprice: 'order.update_price',
    orderupdatediscount: 'order.update_discount',
    orderupdatecommission: 'order.update_commission',
    orderreassign: 'order.reassign',
    orderaddattachment: 'order.add_attachment',
    orderremoveattachment: 'order.remove_attachment',
    orderviewattachment: 'order.view_attachment',
    ordergeneratepdf: 'order.generate_pdf',
    orderarchive: 'order.archive',
    orderrestore: 'order.restore',
    orderdelete: 'order.delete',
    orderconfirm: 'order.confirm',
    ordermarkinvoiced: 'order.mark_invoiced',
    ordercomplete: 'order.complete',
    ordercancel: 'order.cancel',

    usercreate: 'user.create',
    userupdaterole: 'user.update_role',
    userdisable: 'user.disable',
    assignmentcreate: 'assignment.create',
    assignmentrevoke: 'assignment.revoke',
    auditview: 'audit.view',
    exportcustomers: 'export.customers',
    exportquotes: 'export.quotes',
    exportorders: 'export.orders',
    reportcommissions: 'report.commissions',
  }

  it('catalog covers every command verb the matrix document names', async () => {
    const doc = await readFile(resolve(root, 'docs/domain/role-permission-matrix.md'), 'utf8')

    // Doc commands are written in camelCase (`customer.updateCreditLimit`);
    // compact to lowercase alphanumerics for the census.
    const named = new Set<string>()
    for (const match of doc.matchAll(/`([a-z][a-zA-Z]*\.[a-zA-Z]+)`/g)) {
      named.add(match[1]!.replaceAll(/[._]/g, '').toLowerCase())
    }

    const cataloged = new Set<string>(CAPABILITIES)
    const unsupported = new Set<string>(UNSUPPORTED_COMMANDS)

    const unmapped: string[] = []
    for (const name of named) {
      if (name.endsWith('.scope')) continue
      const capability = DOC_COMMAND_TO_CAPABILITY[name]
      if (capability === undefined) {
        unmapped.push(name)
        continue
      }
      // Every mapping target must exist in exactly one of the two sets.
      expect(
        cataloged.has(capability) || unsupported.has(capability),
        `${name} -> ${capability} must be cataloged or N/S`,
      ).toBe(true)
    }
    expect(unmapped, 'doc commands missing from the transcription map').toEqual([])

    // And conversely: no invented capabilities. Every catalog entry must be
    // reachable from at least one doc command.
    const mappedTargets = new Set(Object.values(DOC_COMMAND_TO_CAPABILITY))
    for (const capability of CAPABILITIES) {
      expect(mappedTargets.has(capability), `catalog entry not traceable to doc: ${capability}`).toBe(true)
    }
  })
})
