import { describe, expect, it } from 'vitest'
import { cnpjSchema, cepSchema, phoneSchema } from '@/domain/primitives/brazilian'
import {
  MAX_COLLECTION_LIMIT,
  createCollectionInputSchema,
  sortDirectionSchema,
} from '@/domain/primitives/collection'
import { dateSchema } from '@/domain/primitives/date'
import {
  decimalStringSchema,
  moneySchema,
  percentageSchema,
  quantitySchema,
  unitPriceSchema,
} from '@/domain/primitives/decimal'
import { orderStatusSchema, quoteStatusSchema } from '@/domain/primitives/status'
import { uuidSchema } from '@/domain/primitives/uuid'
import {
  createDomainFactory,
  domainBoundaryFixtures,
  invalidDomainFixtures,
} from '@/domain/testing/factories'

const collectionSchema = createCollectionInputSchema({
  filterFields: ['status', 'customerId', 'createdAt'] as const,
  sortFields: ['number', 'createdAt', 'status'] as const,
  defaultSortField: 'createdAt',
})

function sampleFactory(seed: string) {
  const factory = createDomainFactory(seed)
  return {
    uuid: factory.uuid(),
    date: factory.date(),
    cnpj: factory.cnpj(),
    cep: factory.cep(),
    phone: factory.phone(),
    decimal: factory.decimal(),
    quantity: factory.quantity(),
    unitPrice: factory.unitPrice(),
    money: factory.money(),
    percentage: factory.percentage(),
    quoteStatus: factory.quoteStatus(),
    orderStatus: factory.orderStatus(),
    sortDirection: factory.sortDirection(),
    collection: factory.collectionInput(collectionSchema),
  }
}

describe('synthetic domain factory', () => {
  it('returns schema-valid canonical values by default', () => {
    const sample = sampleFactory('schema-valid')

    expect(uuidSchema.parse(sample.uuid)).toBe(sample.uuid)
    expect(dateSchema.parse(sample.date)).toBe(sample.date)
    expect(cnpjSchema.parse(sample.cnpj)).toBe(sample.cnpj)
    expect(cepSchema.parse(sample.cep)).toBe(sample.cep)
    expect(phoneSchema.parse(sample.phone)).toBe(sample.phone)
    expect(decimalStringSchema.parse(sample.decimal)).toBe(sample.decimal)
    expect(quantitySchema.parse(sample.quantity)).toBe(sample.quantity)
    expect(unitPriceSchema.parse(sample.unitPrice)).toBe(sample.unitPrice)
    expect(moneySchema.parse(sample.money)).toBe(sample.money)
    expect(percentageSchema.parse(sample.percentage)).toBe(sample.percentage)
    expect(quoteStatusSchema.parse(sample.quoteStatus)).toBe(sample.quoteStatus)
    expect(orderStatusSchema.parse(sample.orderStatus)).toBe(sample.orderStatus)
    expect(sortDirectionSchema.parse(sample.sortDirection)).toBe(sample.sortDirection)
    expect(collectionSchema.parse(sample.collection)).toEqual(sample.collection)
  })

  it('replays the same generated sequence for the same seed', () => {
    expect(sampleFactory('repeatable-seed')).toEqual(sampleFactory('repeatable-seed'))
    expect(sampleFactory('repeatable-seed')).not.toEqual(sampleFactory('another-seed'))
  })

  it('honors explicit overrides and validates them through canonical schemas', () => {
    const factory = createDomainFactory('overrides')

    expect(factory.uuid('550E8400-E29B-41D4-A716-446655440000')).toBe(
      '550e8400-e29b-41d4-a716-446655440000',
    )
    expect(factory.money('10.50')).toBe('10.50')
    expect(factory.quoteStatus('approved')).toBe('approved')
    expect(
      factory.collectionInput(collectionSchema, {
        cursor: '  next-page  ',
        limit: '100',
        filters: [{ field: 'status', operator: 'eq', value: 'approved' }],
        sort: { field: 'number', direction: 'desc' },
      }),
    ).toEqual({
      cursor: 'next-page',
      limit: 100,
      filters: [{ field: 'status', operator: 'eq', value: 'approved' }],
      sort: { field: 'number', direction: 'desc' },
    })

    expect(() => factory.money('10.5')).toThrow()
    expect(() => factory.quoteStatus('pending')).toThrow()
    expect(() =>
      factory.collectionInput(collectionSchema, {
        sort: { field: 'forbidden', direction: 'asc' },
      }),
    ).toThrow()
  })
})

describe('opt-in domain boundary and invalid fixtures', () => {
  it('exercises canonical numeric, date, identifier, status, and collection edges', () => {
    expect(dateSchema.parse(domainBoundaryFixtures.date.leapDay)).toBe('2024-02-29')
    expect(quantitySchema.parse(domainBoundaryFixtures.quantity.minimum)).toBe(
      '0.000001',
    )
    expect(quantitySchema.parse(domainBoundaryFixtures.quantity.maximum)).toBe(
      '999999999999.999999',
    )
    expect(unitPriceSchema.parse(domainBoundaryFixtures.unitPrice.maximum)).toBe(
      '9999999999999.999999',
    )
    expect(moneySchema.parse(domainBoundaryFixtures.money.minimum)).toBe('0.00')
    expect(moneySchema.parse(domainBoundaryFixtures.money.maximum)).toBe(
      '99999999999999999.99',
    )
    expect(percentageSchema.parse(domainBoundaryFixtures.percentage.minimum)).toBe('0')
    expect(percentageSchema.parse(domainBoundaryFixtures.percentage.maximum)).toBe(
      '100.000000',
    )
    expect(cnpjSchema.parse(domainBoundaryFixtures.cnpj.valid)).toBe(
      domainBoundaryFixtures.cnpj.valid,
    )
    expect(cepSchema.parse(domainBoundaryFixtures.cep.valid)).toBe(
      domainBoundaryFixtures.cep.valid,
    )
    expect(phoneSchema.parse(domainBoundaryFixtures.phone.valid)).toBe(
      domainBoundaryFixtures.phone.valid,
    )
    expect(quoteStatusSchema.parse(domainBoundaryFixtures.quoteStatus.first)).toBe(
      'draft',
    )
    expect(orderStatusSchema.parse(domainBoundaryFixtures.orderStatus.last)).toBe(
      'cancelled',
    )
    expect(
      collectionSchema.parse(domainBoundaryFixtures.collection.minimumLimit).limit,
    ).toBe(1)
    expect(
      collectionSchema.parse(domainBoundaryFixtures.collection.maximumLimit).limit,
    ).toBe(MAX_COLLECTION_LIMIT)
    expect(
      collectionSchema.parse(domainBoundaryFixtures.collection.maximumCursor).cursor,
    ).toHaveLength(512)
  })

  it('keeps intentionally invalid cases outside production schemas', () => {
    expect(uuidSchema.safeParse(invalidDomainFixtures.uuid).success).toBe(false)
    expect(dateSchema.safeParse(invalidDomainFixtures.date).success).toBe(false)
    expect(cnpjSchema.safeParse(invalidDomainFixtures.cnpj).success).toBe(false)
    expect(cepSchema.safeParse(invalidDomainFixtures.cep).success).toBe(false)
    expect(phoneSchema.safeParse(invalidDomainFixtures.phone).success).toBe(false)
    expect(decimalStringSchema.safeParse(invalidDomainFixtures.decimal).success).toBe(false)
    expect(quantitySchema.safeParse(invalidDomainFixtures.quantity).success).toBe(false)
    expect(unitPriceSchema.safeParse(invalidDomainFixtures.unitPrice).success).toBe(false)
    expect(moneySchema.safeParse(invalidDomainFixtures.money).success).toBe(false)
    expect(percentageSchema.safeParse(invalidDomainFixtures.percentage).success).toBe(false)
    expect(quoteStatusSchema.safeParse(invalidDomainFixtures.quoteStatus).success).toBe(false)
    expect(orderStatusSchema.safeParse(invalidDomainFixtures.orderStatus).success).toBe(false)
    expect(sortDirectionSchema.safeParse(invalidDomainFixtures.sortDirection).success).toBe(
      false,
    )
    expect(
      collectionSchema.safeParse(invalidDomainFixtures.collection.belowMinimumLimit)
        .success,
    ).toBe(false)
    expect(
      collectionSchema.safeParse(invalidDomainFixtures.collection.aboveMaximumLimit)
        .success,
    ).toBe(false)
    expect(
      collectionSchema.safeParse(invalidDomainFixtures.collection.cursorTooLong).success,
    ).toBe(false)
  })
})
