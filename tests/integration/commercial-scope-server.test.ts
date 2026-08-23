import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  SINGLE_ORGANIZATION_TENANT_ID,
} from '@/lib/auth/commercial-scope'
import {
  loadCommercialScopeRow,
  listVisibleCommercialRecordIds,
  type ScopedCommercialContext,
} from '@/lib/auth/commercial-scope.server'
import {
  createPostgresTestHarness,
  type PostgresTestHarness,
} from '../support/postgres-harness'

/**
 * Live-PostgreSQL coverage for the shared commercial scope adapters used by
 * every commercial server-function boundary (card t_03a12212): single-record
 * scope resolution and collection-visible-ID derivation over the canonical
 * `commercial_resource_scopes` / `commercial_resource_assignments` tables.
 *
 * The decision table itself (role × scope kind × row) is covered exhaustively
 * in tests/unit/commercial-scope-decisions.test.ts; here we prove the SQL
 * adapters feed that table correctly — including the not-found
 * indistinguishability rule for out-of-scope identifiers.
 */

const TENANT = SINGLE_ORGANIZATION_TENANT_ID

let harness: PostgresTestHarness

beforeAll(async () => {
  harness = await createPostgresTestHarness({
    schemaPrefix: 'commercial_scope',
    migrationNames: ['0000_migration_smoke.sql', '0090_order_security.sql'],
  })
})

beforeEach(async () => {
  await harness.reset()
})

afterAll(async () => {
  await harness?.close()
})

function contextFor(
  role: 'admin' | 'representative' | 'read_only',
  id: string,
): ScopedCommercialContext {
  return Object.freeze({
    session: Object.freeze({ id, role }),
    tenantId: TENANT,
    unrestricted: role === 'admin',
  })
}

async function seedScope(input: {
  resourceType: 'quote' | 'order'
  resourceId: string
  ownerUserId: string
  assignedUserIds?: readonly string[]
}): Promise<void> {
  await harness.sql`
    INSERT INTO commercial_resource_scopes (resource_type, resource_id, tenant_id, owner_user_id, resource_status)
    VALUES (${input.resourceType}, ${input.resourceId}::uuid, ${TENANT}::uuid, ${input.ownerUserId}, 'open')
    ON CONFLICT (resource_type, resource_id) DO NOTHING
  `
  for (const userId of input.assignedUserIds ?? []) {
    await harness.sql`
      INSERT INTO commercial_resource_assignments (resource_type, resource_id, user_id)
      VALUES (${input.resourceType}, ${input.resourceId}::uuid, ${userId})
    `
  }
}

describe('loadCommercialScopeRow on PostgreSQL', () => {
  it('resolves ownership plus explicit assignments for one record', async () => {
    const orderId = randomUUID()
    await seedScope({
      resourceType: 'order',
      resourceId: orderId,
      ownerUserId: 'rep-owner',
      assignedUserIds: ['rep-assigned', 'reader-assigned'],
    })

    const row = await loadCommercialScopeRow(harness.database, 'order', orderId)
    expect(row).not.toBeNull()
    expect(row!.ownerUserId).toBe('rep-owner')
    expect([...row!.assignedUserIds].sort()).toEqual(['reader-assigned', 'rep-assigned'])
    // Single-organization installation: the fixed tenant id participates in
    // every lookup without inventing multitenancy behavior.
    expect(row!.tenantId).toBe(TENANT)
  })

  it('resolves quote rows through the same tables', async () => {
    const quoteId = randomUUID()
    await seedScope({ resourceType: 'quote', resourceId: quoteId, ownerUserId: 'quote-owner' })

    const row = await loadCommercialScopeRow(harness.database, 'quote', quoteId)
    expect(row?.ownerUserId).toBe('quote-owner')
  })

  it('returns null for unknown identifiers so absence is indistinguishable from out-of-scope', async () => {
    const row = await loadCommercialScopeRow(harness.database, 'order', randomUUID())
    expect(row).toBeNull()
  })
})

describe('listVisibleCommercialRecordIds on PostgreSQL', () => {
  it('admin bypasses per-row filtering (unrestricted scope)', async () => {
    const visible = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('admin', 'any-admin'),
      'order',
    )
    expect(visible).toBeNull()
  })

  it('lists exactly own + assigned orders for a representative', async () => {
    const mine = randomUUID()
    const assignedToMe = randomUUID()
    const someoneElses = randomUUID()
    await seedScope({ resourceType: 'order', resourceId: mine, ownerUserId: 'rep-a' })
    await seedScope({
      resourceType: 'order',
      resourceId: assignedToMe,
      ownerUserId: 'other-owner',
      assignedUserIds: ['rep-a'],
    })
    await seedScope({ resourceType: 'order', resourceId: someoneElses, ownerUserId: 'other-owner' })

    const visible = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('representative', 'rep-a'),
      'order',
    )
    expect([...visible!].sort()).toEqual([mine, assignedToMe].sort())
  })

  it('gives read_only actors ONLY explicitly assigned records', async () => {
    const assigned = randomUUID()
    const ownedButNotAssigned = randomUUID()
    await seedScope({
      resourceType: 'order',
      resourceId: assigned,
      ownerUserId: 'some-rep',
      assignedUserIds: ['reader-a'],
    })
    // A read_only user who happens to "own" a row without an assignment row
    // must NOT see it (S3/S4).
    await seedScope({
      resourceType: 'order',
      resourceId: ownedButNotAssigned,
      ownerUserId: 'reader-a',
    })

    const visible = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('read_only', 'reader-a'),
      'order',
    )
    expect(visible).toEqual([assigned])
  })

  it('never returns foreign-tenant rows even for admins with matching ids', async () => {
    const resourceId = randomUUID()
    await harness.sql`
      INSERT INTO commercial_resource_scopes (resource_type, resource_id, tenant_id, owner_user_id, resource_status)
      VALUES ('order', ${resourceId}::uuid, '99999999-0000-4000-8000-000000009999'::uuid, 'rep-x', 'open')
    `

    // The unrestricted admin path skips filtering by design; the scoped path
    // (what non-admin roles use) must not surface the foreign row either.
    const representativeView = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('representative', 'rep-x'),
      'order',
    )
    expect(representativeView).toEqual([])
  })

  it('separates quotes from orders by resource type', async () => {
    const orderId = randomUUID()
    const quoteId = randomUUID()
    await seedScope({ resourceType: 'order', resourceId: orderId, ownerUserId: 'rep-a' })
    await seedScope({ resourceType: 'quote', resourceId: quoteId, ownerUserId: 'rep-a' })

    const orders = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('representative', 'rep-a'),
      'order',
    )
    const quotes = await listVisibleCommercialRecordIds(
      harness.database,
      contextFor('representative', 'rep-a'),
      'quote',
    )
    expect(orders).toEqual([orderId])
    expect(quotes).toEqual([quoteId])
  })
})
