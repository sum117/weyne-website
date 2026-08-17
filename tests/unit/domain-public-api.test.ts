import { describe, expect, expectTypeOf, it } from 'vitest'
import {
  MAX_COLLECTION_LIMIT,
  ORDER_STATUSES,
  QUOTE_STATUSES,
  cnpjSchema,
  createCollectionInputSchema,
  dateSchema,
  formatCnpj,
  formatDatePtBr,
  formatMoneyPtBr,
  moneySchema,
  orderStatusSchema,
  parseCnpj,
  parseDatePtBr,
  parseMoneyPtBr,
  quoteStatusSchema,
  quantitySchema,
  roundMoney,
  unitPriceSchema,
  type CollectionInput,
  type CollectionQuery,
  type DateString,
  type MoneyString,
  type OrderStatus,
  type QuoteStatus,
} from '@/domain'
import {
  createDomainFactory,
  domainBoundaryFixtures,
  invalidDomainFixtures,
} from '@/domain/testing'

const collectionSchema = createCollectionInputSchema({
  filterFields: ['status', 'createdAt'] as const,
  sortFields: ['number', 'createdAt'] as const,
  defaultSortField: 'createdAt',
})

type PublicCollectionInput = CollectionInput<typeof collectionSchema>
type PublicCollectionQuery = CollectionQuery<typeof collectionSchema>

describe('shared domain public API acceptance', () => {
  it('keeps canonical storage separate from strict pt-BR parse and display boundaries', () => {
    const storedMoney: MoneyString = parseMoneyPtBr('1.234,56')
    const storedDate: DateString = parseDatePtBr('29/02/2024')

    expect(storedMoney).toBe('1234.56')
    expect(formatMoneyPtBr(storedMoney)).toBe('1.234,56')
    expect(storedDate).toBe('2024-02-29')
    expect(formatDatePtBr(storedDate)).toBe('29/02/2024')
    expect(moneySchema.safeParse('1.234,56').success).toBe(false)
    expect(dateSchema.safeParse('29/02/2024').success).toBe(false)
    expect(() => parseMoneyPtBr('1234.56')).toThrow('Informe')
    expect(() => parseDatePtBr('2024-02-29')).toThrow('Informe')
  })

  it('rounds decimal strings exactly without IEEE-754 leakage', () => {
    expect(roundMoney('10.005')).toBe('10.01')
    expect(roundMoney('2.675')).toBe('2.68')
    expect(roundMoney('9007199254740993.005')).toBe('9007199254740993.01')
  })

  it('validates and formats CNPJ through the shared Brazilian boundary', () => {
    const canonical = parseCnpj('41.142.260/0001-89')

    expect(canonical).toBe('41142260000189')
    expect(formatCnpj(canonical)).toBe('41.142.260/0001-89')
    expect(cnpjSchema.safeParse('41.142.260/0001-80').success).toBe(false)
    expect(cnpjSchema.safeParse(' 41.142.260/0001-89 ').success).toBe(false)
  })

  it('exposes every canonical quote and order status with inferred types', () => {
    expect(QUOTE_STATUSES).toEqual([
      'draft',
      'sent',
      'approved',
      'rejected',
      'expired',
      'converted',
      'cancelled',
    ])
    expect(ORDER_STATUSES).toEqual([
      'open',
      'confirmed',
      'invoiced',
      'completed',
      'cancelled',
    ])

    for (const status of QUOTE_STATUSES) {
      expect(quoteStatusSchema.parse(status)).toBe(status)
    }
    for (const status of ORDER_STATUSES) {
      expect(orderStatusSchema.parse(status)).toBe(status)
    }

    expectTypeOf(quoteStatusSchema.parse('draft')).toEqualTypeOf<QuoteStatus>()
    expectTypeOf(orderStatusSchema.parse('open')).toEqualTypeOf<OrderStatus>()
  })

  it('enforces numeric, date, cursor, and pagination boundaries via public schemas', () => {
    expect(quantitySchema.parse(domainBoundaryFixtures.quantity.minimum)).toBe(
      '0.000001',
    )
    expect(unitPriceSchema.parse(domainBoundaryFixtures.unitPrice.maximum)).toBe(
      '9999999999999.999999',
    )
    expect(moneySchema.parse(domainBoundaryFixtures.money.maximum)).toBe(
      '99999999999999999.99',
    )
    expect(dateSchema.parse(domainBoundaryFixtures.date.leapDay)).toBe('2024-02-29')

    const minimum = collectionSchema.parse({ limit: 1 })
    const maximum = collectionSchema.parse({
      limit: MAX_COLLECTION_LIMIT,
      cursor: 'x'.repeat(512),
    })
    expect(minimum.limit).toBe(1)
    expect(maximum.limit).toBe(100)
    expect(maximum.cursor).toHaveLength(512)
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
    expect(dateSchema.safeParse('2023-02-29').success).toBe(false)

    const input: PublicCollectionInput = { limit: '25' }
    const output = collectionSchema.parse(input)
    expectTypeOf(output).toEqualTypeOf<PublicCollectionQuery>()
  })

  it('keeps synthetic factories schema-backed and pt-BR errors user-facing', () => {
    const factory = createDomainFactory('public-acceptance')

    expect(moneySchema.parse(factory.money('10.50'))).toBe('10.50')
    expect(() => factory.money(invalidDomainFixtures.money)).toThrow(/Informe|valor/)
    expect(() => quoteStatusSchema.parse(invalidDomainFixtures.quoteStatus)).toThrow(
      'Informe um status de orçamento válido',
    )
  })
})
