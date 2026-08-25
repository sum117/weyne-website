import Decimal from 'decimal.js'
import { z } from 'zod'

const CANONICAL_DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/
const PT_BR_INTEGER_PATTERN = /^(?:0|[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)$/

/** Isolated arbitrary-precision context for domain calculations. */
export const DomainDecimal = Decimal.clone({
  precision: 40,
  rounding: Decimal.ROUND_HALF_UP,
})

function decimalParts(value: string): readonly [integer: string, fraction: string] {
  const [integer, fraction = ''] = value.split('.')
  return [integer!, fraction]
}

function fitsDecimal(value: string, precision: number, scale: number): boolean {
  const [integer, fraction] = decimalParts(value)
  return integer.length <= precision - scale && fraction.length <= scale
}

function decimalSchema(
  precision: number,
  scale: number,
  message: string,
  options: Readonly<{ positive?: boolean; exactScale?: boolean; maximum?: string }> = {},
) {
  return decimalStringSchema.refine((value) => {
    if (!fitsDecimal(value, precision, scale)) return false
    if (options.exactScale && decimalParts(value)[1].length !== scale) return false

    const decimal = new DomainDecimal(value)
    if (options.positive && !decimal.greaterThan(0)) return false
    if (options.maximum && decimal.greaterThan(options.maximum)) return false
    return true
  }, message)
}

/**
 * Locale-neutral, finite, non-negative base-10 string.
 *
 * The schema rejects signs, leading zeroes, separators, whitespace, and
 * exponent notation. It preserves accepted input verbatim; normalization is
 * explicit at publication and locale boundaries.
 */
export const decimalStringSchema = z
  .string()
  .regex(
    CANONICAL_DECIMAL_PATTERN,
    'Informe um decimal canônico não negativo usando ponto como separador',
  )

export type DecimalString = z.infer<typeof decimalStringSchema>

/** Positive DECIMAL(18,6), preserving between zero and six fractional digits. */
export const quantitySchema = decimalSchema(
  18,
  6,
  'Informe uma quantidade positiva com até 12 inteiros e 6 casas decimais',
  { positive: true },
)

export type QuantityString = z.infer<typeof quantitySchema>

/** Non-negative DECIMAL(19,6) unit price. */
export const unitPriceSchema = decimalSchema(
  19,
  6,
  'Informe um preço não negativo com até 13 inteiros e 6 casas decimais',
)

export type UnitPriceString = z.infer<typeof unitPriceSchema>

/** Published non-negative DECIMAL(19,2), always normalized to two places. */
export const moneySchema = decimalSchema(
  19,
  2,
  'Informe um valor monetário não negativo com exatamente 2 casas decimais',
  { exactScale: true },
)

export type MoneyString = z.infer<typeof moneySchema>

/** Inclusive percentage rate stored as DECIMAL(9,6). */
export const percentageSchema = decimalSchema(
  9,
  6,
  'Informe uma porcentagem entre 0 e 100 com até 6 casas decimais',
  { maximum: '100' },
)

export type PercentageString = z.infer<typeof percentageSchema>

function parsePtBr(
  value: string,
  fractionPattern: RegExp,
  schema: z.ZodType<string>,
  message: string,
): string {
  const commaIndex = value.indexOf(',')
  const integer = commaIndex === -1 ? value : value.slice(0, commaIndex)
  const fraction = commaIndex === -1 ? '' : value.slice(commaIndex + 1)

  if (
    !PT_BR_INTEGER_PATTERN.test(integer) ||
    !fractionPattern.test(fraction) ||
    value.indexOf(',', commaIndex + 1) !== -1
  ) {
    throw new Error(message)
  }

  const canonical = `${integer.replaceAll('.', '')}${fraction ? `.${fraction}` : ''}`
  const result = schema.safeParse(canonical)
  if (!result.success) throw new Error(message)
  return result.data
}

/** Strict pt-BR money input: optional valid grouping and exactly two cents. */
export function parseMoneyPtBr(value: string): MoneyString {
  return parsePtBr(
    value,
    /^\d{2}$/,
    moneySchema,
    'Informe um valor monetário válido, como 1.234,56',
  )
}

/** Strict pt-BR quantity input with zero to six fractional digits. */
export function parseQuantityPtBr(value: string): QuantityString {
  return parsePtBr(
    value,
    /^(?:|\d{1,6})$/,
    quantitySchema,
    'Informe uma quantidade válida, como 1.234,5',
  )
}

/** Strict pt-BR unit-price input with zero to six fractional digits. */
export function parseUnitPricePtBr(value: string): UnitPriceString {
  return parsePtBr(
    value,
    /^(?:|\d{1,6})$/,
    unitPriceSchema,
    'Informe um preço válido, como 1.234,5678',
  )
}

/** Strict pt-BR percentage input with zero to six fractional digits. */
export function parsePercentagePtBr(value: string): PercentageString {
  return parsePtBr(
    value,
    /^(?:|\d{1,6})$/,
    percentageSchema,
    'Informe uma porcentagem válida entre 0 e 100',
  )
}

function groupInteger(integer: string): string {
  return integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

function formatPtBr(value: string): string {
  const [integer, fraction] = decimalParts(value)
  return `${groupInteger(integer)}${fraction ? `,${fraction}` : ''}`
}

export function formatMoneyPtBr(value: MoneyString): string {
  return formatPtBr(moneySchema.parse(value))
}

export function formatQuantityPtBr(value: QuantityString): string {
  return formatPtBr(quantitySchema.parse(value))
}

export function formatUnitPricePtBr(value: UnitPriceString): string {
  return formatPtBr(unitPriceSchema.parse(value))
}

export function formatPercentagePtBr(value: PercentageString): string {
  return formatPtBr(percentageSchema.parse(value))
}

/** Rounds only at a money publication boundary using ROUND_HALF_UP. */
export function roundMoney(value: DecimalString): MoneyString {
  const canonical = decimalStringSchema.parse(value)
  const rounded = new DomainDecimal(canonical).toFixed(2, Decimal.ROUND_HALF_UP)
  const result = moneySchema.safeParse(rounded)
  if (!result.success) {
    throw new Error('O valor monetário arredondado está fora do intervalo permitido')
  }
  return result.data
}

/** Arbitrary-precision comparison; never coerces through JavaScript number. */
export function compareDecimalStrings(
  left: DecimalString,
  right: DecimalString,
): -1 | 0 | 1 {
  const comparison = new DomainDecimal(decimalStringSchema.parse(left)).comparedTo(
    decimalStringSchema.parse(right),
  )
  return comparison < 0 ? -1 : comparison > 0 ? 1 : 0
}