import { describe, expect, it } from 'vitest'
import {
  industryCreateInputSchema,
  industryDetailSchema,
  industryListInputSchema,
  industryUpdateInputSchema,
} from '@/domain/industries/contracts'

const address = {
  street: 'Rua do Sol',
  number: '100',
  complement: null,
  district: 'Santo Antônio',
  city: 'Recife',
  state: 'pe',
  postalCode: '50010-000',
  countryCode: 'br',
}

describe('industry contracts', () => {
  it('normalizes shared Brazilian, address, and percentage values on create', () => {
    expect(
      industryCreateInputSchema.parse({
        legalName: '  Aurora Higiene Industrial Ltda.  ',
        tradeName: '  Aurora Higiene  ',
        cnpj: '41.142.260/0001-89',
        address,
        defaultCommissionPercentage: '7.500000',
        notes: '  Atendimento regional  ',
      }),
    ).toEqual({
      legalName: 'Aurora Higiene Industrial Ltda.',
      tradeName: 'Aurora Higiene',
      cnpj: '41142260000189',
      address: {
        ...address,
        state: 'PE',
        postalCode: '50010000',
        countryCode: 'BR',
      },
      defaultCommissionPercentage: '7.500000',
      notes: 'Atendimento regional',
    })
  })

  it('rejects invalid CNPJ and commission values outside the shared range', () => {
    const base = {
      legalName: 'Aurora Higiene Industrial Ltda.',
      tradeName: 'Aurora Higiene',
      cnpj: '41142260000189',
      address,
      defaultCommissionPercentage: '7.5',
    }

    expect(
      industryCreateInputSchema.safeParse({ ...base, cnpj: '00000000000000' }).success,
    ).toBe(false)
    expect(
      industryCreateInputSchema.safeParse({
        ...base,
        defaultCommissionPercentage: '100.000001',
      }).success,
    ).toBe(false)
  })

  it('requires at least one mutable field and supports explicitly clearing notes', () => {
    const id = '3cc5f31d-06d7-4284-aad4-8136c4b35631'
    expect(industryUpdateInputSchema.safeParse({ id }).success).toBe(false)
    expect(industryUpdateInputSchema.parse({ id, notes: null })).toEqual({ id, notes: null })
  })

  it('defaults listing to active industries and allowlisted stable ordering', () => {
    expect(industryListInputSchema.parse({})).toEqual({
      limit: 25,
      filters: { archiveState: 'active' },
      sortBy: 'legalName',
      sortDirection: 'asc',
    })
    expect(industryListInputSchema.safeParse({ sortBy: 'cnpj' }).success).toBe(true)
    expect(industryListInputSchema.safeParse({ sortBy: 'notes' }).success).toBe(false)
  })

  it('requires archive timestamps and actors to remain paired', () => {
    const base = {
      id: '3cc5f31d-06d7-4284-aad4-8136c4b35631',
      legalName: 'Aurora Higiene Industrial Ltda.',
      tradeName: 'Aurora Higiene',
      cnpj: '41142260000189',
      address: { ...address, state: 'PE', postalCode: '50010000', countryCode: 'BR' },
      defaultCommissionPercentage: '7.500000',
      notes: null,
      createdAt: '2026-08-17T12:00:00.000Z',
      createdByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
      updatedAt: '2026-08-17T12:00:00.000Z',
      updatedByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
      archivedAt: null,
      archivedByUserId: '14ea395b-48e6-4567-b851-7cfa6f7375a4',
    }

    expect(industryDetailSchema.safeParse(base).success).toBe(false)
  })
})
