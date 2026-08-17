import type { QuotePdfDate, QuotePdfDecimal } from './types'

const DECIMAL_PATTERN = /^(0|[1-9]\d*)(?:\.(\d+))?$/
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

export interface PtBrDecimalFormatOptions {
  readonly minimumFractionDigits?: number
  readonly maximumFractionDigits?: number
}

const groupInteger = (value: string) =>
  value.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export function formatPtBrDecimal(
  value: QuotePdfDecimal,
  options: PtBrDecimalFormatOptions = {},
): string {
  const match = DECIMAL_PATTERN.exec(value)
  if (!match) {
    throw new TypeError(`Invalid canonical decimal: ${value}`)
  }

  const minimumFractionDigits = options.minimumFractionDigits ?? 0
  const maximumFractionDigits = options.maximumFractionDigits ?? 6
  if (
    minimumFractionDigits < 0 ||
    maximumFractionDigits < minimumFractionDigits ||
    maximumFractionDigits > 12
  ) {
    throw new RangeError('Invalid fraction digit range')
  }

  const integer = match[1]!
  const suppliedFraction = match[2] ?? ''
  if (suppliedFraction.length > maximumFractionDigits) {
    throw new RangeError(
      `Canonical decimal exceeds ${maximumFractionDigits} fraction digits: ${value}`,
    )
  }
  const visibleFraction = suppliedFraction
    .replace(/0+$/, '')
    .padEnd(minimumFractionDigits, '0')

  return `${groupInteger(integer)}${visibleFraction ? `,${visibleFraction}` : ''}`
}

export function formatPtBrCurrency(value: QuotePdfDecimal): string {
  return `R$ ${formatPtBrDecimal(value, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 6,
  })}`
}

export function formatPtBrDate(value: QuotePdfDate): string {
  const match = DATE_PATTERN.exec(value)
  if (!match) {
    throw new TypeError(`Invalid ISO calendar date: ${value}`)
  }

  const [, year, month, day] = match
  const date = new Date(`${year}-${month}-${day}T00:00:00.000Z`)
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day)
  ) {
    throw new TypeError(`Invalid ISO calendar date: ${value}`)
  }

  return `${day}/${month}/${year}`
}
