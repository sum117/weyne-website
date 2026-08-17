import type { z } from 'zod'
import { cepSchema, cnpjSchema, phoneSchema } from '@/domain/primitives/brazilian'
import { sortDirectionSchema } from '@/domain/primitives/collection'
import { dateSchema } from '@/domain/primitives/date'
import {
  decimalStringSchema,
  moneySchema,
  percentageSchema,
  quantitySchema,
  unitPriceSchema,
} from '@/domain/primitives/decimal'
import {
  ORDER_STATUSES,
  QUOTE_STATUSES,
  orderStatusSchema,
  quoteStatusSchema,
} from '@/domain/primitives/status'
import { uuidSchema } from '@/domain/primitives/uuid'

export type DomainFactorySeed = string | number

export type SyntheticDomainFactory = Readonly<{
  uuid: (override?: unknown) => z.output<typeof uuidSchema>
  date: (override?: unknown) => z.output<typeof dateSchema>
  cnpj: (override?: unknown) => z.output<typeof cnpjSchema>
  cep: (override?: unknown) => z.output<typeof cepSchema>
  phone: (override?: unknown) => z.output<typeof phoneSchema>
  decimal: (override?: unknown) => z.output<typeof decimalStringSchema>
  quantity: (override?: unknown) => z.output<typeof quantitySchema>
  unitPrice: (override?: unknown) => z.output<typeof unitPriceSchema>
  money: (override?: unknown) => z.output<typeof moneySchema>
  percentage: (override?: unknown) => z.output<typeof percentageSchema>
  quoteStatus: (override?: unknown) => z.output<typeof quoteStatusSchema>
  orderStatus: (override?: unknown) => z.output<typeof orderStatusSchema>
  sortDirection: (override?: unknown) => z.output<typeof sortDirectionSchema>
  collectionInput: <TSchema extends z.ZodType>(
    schema: TSchema,
    overrides?: unknown,
  ) => z.output<TSchema>
}>

type RandomSource = Readonly<{
  integer: (maximumExclusive: number) => number
  digits: (length: number) => string
}>

function hashSeed(seed: DomainFactorySeed): number {
  let hash = 2_166_136_261
  for (const character of String(seed)) {
    hash ^= character.charCodeAt(0)
    hash = Math.imul(hash, 16_777_619)
  }
  return hash >>> 0
}

function createRandomSource(seed: DomainFactorySeed): RandomSource {
  let state = hashSeed(seed)
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296
  }

  const integer = (maximumExclusive: number) => Math.floor(next() * maximumExclusive)

  return {
    integer,
    digits: (length) =>
      Array.from({ length }, () => String(integer(10))).join(''),
  }
}

function generatedUuid(random: RandomSource): string {
  const hex = Array.from({ length: 32 }, () => random.integer(16).toString(16))
  hex[12] = '4'
  hex[16] = ['8', '9', 'a', 'b'][random.integer(4)]!
  return `${hex.slice(0, 8).join('')}-${hex.slice(8, 12).join('')}-${hex.slice(12, 16).join('')}-${hex.slice(16, 20).join('')}-${hex.slice(20).join('')}`
}

function generatedDate(random: RandomSource): string {
  const start = Date.UTC(2020, 0, 1)
  const days = random.integer(3_653)
  return new Date(start + days * 86_400_000).toISOString().slice(0, 10)
}

function generatedCnpj(random: RandomSource): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  const suffix = Array.from(
    { length: 8 },
    () => alphabet[random.integer(alphabet.length)]!,
  ).join('')
  const base = `TEST${suffix}`

  for (let checkDigits = 0; checkDigits < 100; checkDigits += 1) {
    const candidate = `${base}${String(checkDigits).padStart(2, '0')}`
    const parsed = cnpjSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }

  throw new Error('Não foi possível gerar um CNPJ sintético válido')
}

function generatedCep(random: RandomSource): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = `${random.integer(9) + 1}${random.digits(7)}`
    const parsed = cepSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }

  throw new Error('Não foi possível gerar um CEP sintético válido')
}

function generatedPhone(random: RandomSource): string {
  const validAreaCodes = ['11', '21', '31', '41', '51', '61', '71', '81', '85'] as const

  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    const areaCode = validAreaCodes[random.integer(validAreaCodes.length)]!
    const candidate = `${areaCode}9${random.digits(8)}`
    const parsed = phoneSchema.safeParse(candidate)
    if (parsed.success) return parsed.data
  }

  throw new Error('Não foi possível gerar um telefone sintético válido')
}

function parseOverrideOrGenerate<TSchema extends z.ZodType>(
  schema: TSchema,
  override: unknown,
  generate: () => unknown,
): z.output<TSchema> {
  return schema.parse(override === undefined ? generate() : override)
}

/**
 * Creates reproducible, schema-backed synthetic values for domain tests.
 * Overrides always cross the same canonical schemas as generated defaults.
 */
export function createDomainFactory(
  seed: DomainFactorySeed = 'default',
): SyntheticDomainFactory {
  const random = createRandomSource(seed)

  return Object.freeze({
    uuid: (override?: unknown) =>
      parseOverrideOrGenerate(uuidSchema, override, () => generatedUuid(random)),
    date: (override?: unknown) =>
      parseOverrideOrGenerate(dateSchema, override, () => generatedDate(random)),
    cnpj: (override?: unknown) =>
      parseOverrideOrGenerate(cnpjSchema, override, () => generatedCnpj(random)),
    cep: (override?: unknown) =>
      parseOverrideOrGenerate(cepSchema, override, () => generatedCep(random)),
    phone: (override?: unknown) =>
      parseOverrideOrGenerate(phoneSchema, override, () => generatedPhone(random)),
    decimal: (override?: unknown) =>
      parseOverrideOrGenerate(
        decimalStringSchema,
        override,
        () => `${random.integer(10_000)}.${random.digits(6)}`,
      ),
    quantity: (override?: unknown) =>
      parseOverrideOrGenerate(
        quantitySchema,
        override,
        () => `${random.integer(999_999) + 1}.${random.digits(6)}`,
      ),
    unitPrice: (override?: unknown) =>
      parseOverrideOrGenerate(
        unitPriceSchema,
        override,
        () => `${random.integer(1_000_000)}.${random.digits(6)}`,
      ),
    money: (override?: unknown) =>
      parseOverrideOrGenerate(
        moneySchema,
        override,
        () => `${random.integer(1_000_000)}.${random.digits(2)}`,
      ),
    percentage: (override?: unknown) =>
      parseOverrideOrGenerate(
        percentageSchema,
        override,
        () => `${random.integer(100)}.${random.digits(6)}`,
      ),
    quoteStatus: (override?: unknown) =>
      parseOverrideOrGenerate(
        quoteStatusSchema,
        override,
        () => QUOTE_STATUSES[random.integer(QUOTE_STATUSES.length)]!,
      ),
    orderStatus: (override?: unknown) =>
      parseOverrideOrGenerate(
        orderStatusSchema,
        override,
        () => ORDER_STATUSES[random.integer(ORDER_STATUSES.length)]!,
      ),
    sortDirection: (override?: unknown) =>
      parseOverrideOrGenerate(sortDirectionSchema, override, () =>
        random.integer(2) === 0 ? 'asc' : 'desc',
      ),
    collectionInput: <TSchema extends z.ZodType>(
      schema: TSchema,
      overrides?: unknown,
    ) => schema.parse(overrides ?? {}),
  })
}

const boundaryFactory = createDomainFactory('weyne-domain-boundaries')

/** Valid edge values kept opt-in so ordinary tests remain representative. */
export const domainBoundaryFixtures = Object.freeze({
  date: { leapDay: '2024-02-29' },
  cnpj: { valid: boundaryFactory.cnpj() },
  cep: { valid: boundaryFactory.cep() },
  phone: { valid: boundaryFactory.phone() },
  quantity: { minimum: '0.000001', maximum: '999999999999.999999' },
  unitPrice: { minimum: '0', maximum: '9999999999999.999999' },
  money: { minimum: '0.00', maximum: '99999999999999999.99' },
  percentage: { minimum: '0', maximum: '100.000000' },
  quoteStatus: { first: QUOTE_STATUSES[0], last: QUOTE_STATUSES.at(-1)! },
  orderStatus: { first: ORDER_STATUSES[0], last: ORDER_STATUSES.at(-1)! },
  collection: {
    minimumLimit: { limit: 1 },
    maximumLimit: { limit: 100 },
    maximumCursor: { cursor: 'x'.repeat(512) },
  },
} as const)

/** Deliberately invalid raw values; callers choose which production schema rejects them. */
export const invalidDomainFixtures = Object.freeze({
  uuid: 'not-a-uuid',
  date: '2023-02-29',
  cnpj: 'TESTINVALID000',
  cep: '0000-000',
  phone: '00000000000',
  decimal: '1,00',
  quantity: '0',
  unitPrice: '0.0000001',
  money: '10.5',
  percentage: '100.000001',
  quoteStatus: 'pending',
  orderStatus: 'processing',
  sortDirection: 'descending',
  collection: {
    belowMinimumLimit: { limit: 0 },
    aboveMaximumLimit: { limit: 101 },
    cursorTooLong: { cursor: 'x'.repeat(513) },
  },
} as const)
