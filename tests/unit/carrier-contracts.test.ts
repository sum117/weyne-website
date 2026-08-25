import { describe, expect, it } from 'vitest'
import {
  carrierArchiveInputSchema,
  carrierCreateInputSchema,
  carrierDetailSchema,
  carrierListInputSchema,
  carrierListOutputSchema,
  carrierUpdateInputSchema,
} from '@/domain/carriers/contracts'

const actorId = '14ea395b-48e6-4567-b851-7cfa6f7375a4'
const carrierId = 'ec0767ea-a5fe-4f6d-a4fe-8d2972c7d913'

describe('carrier contracts', () => {
  it('normalizes a minimum create profile and its optional Brazilian data', () => {
    expect(
      carrierCreateInputSchema.parse({
        name: '  Transportes Aurora  ',
        taxId: '41.142.260/0001-89',
        contactName: '  Ana Lima  ',
        email: '  OPERACAO@AURORA.COM.BR  ',
        phone: '+55 (11) 98273-1182',
        streetAddress: '  Rua do Porto, 12  ',
        postalCode: '02998-050',
        city: '  São Paulo  ',
        state: 'sp',
        notes: '  Entrega agendada  ',
      }),
    ).toEqual({
      name: 'Transportes Aurora',
      taxId: '41142260000189',
      contactName: 'Ana Lima',
      email: 'operacao@aurora.com.br',
      phone: '11982731182',
      streetAddress: 'Rua do Porto, 12',
      postalCode: '02998050',
      city: 'São Paulo',
      state: 'SP',
      notes: 'Entrega agendada',
    })
  })

  it('represents stable identity, audit timestamps, and archive state', () => {
    expect(
      carrierDetailSchema.parse({
        id: carrierId,
        name: 'Transportes Aurora',
        taxId: null,
        contactName: null,
        email: null,
        phone: null,
        streetAddress: null,
        postalCode: null,
        city: null,
        state: null,
        notes: null,
        createdAt: '2026-08-17T12:00:00.000Z',
        createdByUserId: actorId,
        updatedAt: '2026-08-17T12:00:00.000Z',
        updatedByUserId: actorId,
        archivedAt: null,
        archivedByUserId: null,
      }),
    ).toMatchObject({ id: carrierId, archivedAt: null })
  })

  it('rejects invalid CNPJ and contact values with pt-BR messages', () => {
    const result = carrierCreateInputSchema.safeParse({
      name: 'Transportes Aurora',
      taxId: '41.142.260/0001-80',
      email: 'sem-arroba',
      phone: '(23) 3972-3768',
    })

    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.message)).toEqual([
        'Informe um CNPJ válido',
        'Informe um e-mail válido',
        'Informe um telefone válido',
      ])
    }
  })

  it('rejects unsupported fleet, logistics, and unknown fields', () => {
    expect(
      carrierCreateInputSchema.safeParse({
        name: 'Transportes Aurora',
        fleetSize: 12,
      }).success,
    ).toBe(false)
    expect(
      carrierCreateInputSchema.safeParse({
        name: 'Transportes Aurora',
        deliveryRegions: ['Nordeste'],
      }).success,
    ).toBe(false)
  })

  it('requires archive timestamp and actor to be set or cleared together', () => {
    const base = {
      id: carrierId,
      name: 'Transportes Aurora',
      taxId: null,
      contactName: null,
      email: null,
      phone: null,
      streetAddress: null,
      postalCode: null,
      city: null,
      state: null,
      notes: null,
      createdAt: '2026-08-17T12:00:00.000Z',
      createdByUserId: actorId,
      updatedAt: '2026-08-17T12:00:00.000Z',
      updatedByUserId: actorId,
    }

    expect(
      carrierDetailSchema.safeParse({
        ...base,
        archivedAt: '2026-08-17T13:00:00.000Z',
        archivedByUserId: null,
      }).success,
    ).toBe(false)
  })

  it('treats omitted update fields as unchanged and null as an explicit clear', () => {
    expect(
      carrierUpdateInputSchema.parse({
        id: carrierId,
        email: null,
        state: 'pe',
      }),
    ).toEqual({ id: carrierId, email: null, state: 'PE' })
  })

  it('requires at least one supported update and never allows name to be cleared', () => {
    expect(carrierUpdateInputSchema.safeParse({ id: carrierId }).success).toBe(
      false,
    )
    expect(
      carrierUpdateInputSchema.safeParse({ id: carrierId, name: null }).success,
    ).toBe(false)
    expect(
      carrierUpdateInputSchema.safeParse({ id: carrierId, vehicleTypes: [] })
        .success,
    ).toBe(false)
  })

  it('applies active-only search and bounded cursor pagination defaults', () => {
    expect(carrierListInputSchema.parse({})).toEqual({
      limit: 25,
      filters: { archiveState: 'active' },
      sortBy: 'name',
      sortDirection: 'asc',
    })
    expect(
      carrierListInputSchema.parse({
        cursor: 'next-page',
        limit: '100',
        filters: { search: '  aurora  ', archiveState: 'all' },
        sortBy: 'updatedAt',
        sortDirection: 'desc',
      }),
    ).toEqual({
      cursor: 'next-page',
      limit: 100,
      filters: { search: 'aurora', archiveState: 'all' },
      sortBy: 'updatedAt',
      sortDirection: 'desc',
    })
  })

  it('rejects pagination boundaries and non-allowlisted query filters', () => {
    expect(carrierListInputSchema.safeParse({ limit: 0 }).success).toBe(false)
    expect(carrierListInputSchema.safeParse({ limit: 101 }).success).toBe(false)
    expect(
      carrierListInputSchema.safeParse({ filters: { archiveState: 'deleted' } })
        .success,
    ).toBe(false)
    expect(
      carrierListInputSchema.safeParse({ filters: { fleetSize: 4 } }).success,
    ).toBe(false)
  })

  it('validates list and archive boundary outputs without duplicating entities', () => {
    const item = {
      id: carrierId,
      name: 'Transportes Aurora',
      taxId: '41142260000189',
      email: 'operacao@aurora.com.br',
      phone: '11982731182',
      city: 'São Paulo',
      state: 'SP',
      updatedAt: '2026-08-17T12:00:00.000Z',
      archivedAt: null,
    }

    expect(
      carrierListOutputSchema.parse({ items: [item], nextCursor: null }),
    ).toEqual({ items: [item], nextCursor: null })
    expect(carrierArchiveInputSchema.parse({ id: carrierId })).toEqual({
      id: carrierId,
    })
    expect(
      carrierArchiveInputSchema.safeParse({ id: carrierId, hardDelete: true })
        .success,
    ).toBe(false)
  })
})
