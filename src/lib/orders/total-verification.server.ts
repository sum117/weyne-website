import type { DecimalString, NewOrderSnapshot } from '@/lib/orders/repository.server'

/**
 * Server-side total verification for quote-to-order conversion.
 *
 * Recalculates every aggregate from the quote's stored snapshot lines and
 * compares against the stored snapshot totals. This never consults the
 * catalog or client master: quoted values are only verified for internal
 * consistency, never replaced.
 *
 * All arithmetic is exact decimal string arithmetic on the 6-decimal
 * snapshot representation, so verification cannot introduce rounding drift
 * relative to the values that were approved on the quote.
 */
export function verifyOrderTotals(snapshot: Readonly<NewOrderSnapshot>): readonly string[] {
  const problems: string[] = []
  const totals = snapshot.totals

  if (snapshot.lines.length === 0) {
    return ['lines must not be empty']
  }

  const grossItems = sumOf(snapshot.lines, (line) => line.grossAmount)
  const perItemDiscount = sumOf(snapshot.lines, (line) => line.perItemDiscountAmount)
  const netItems = sumOf(snapshot.lines, (line) => line.netBeforeGeneralDiscountAmount)
  const netAfterDiscounts = sumOf(snapshot.lines, (line) => line.netAfterDiscountsAmount)
  const ipi = sumOf(snapshot.lines, (line) => line.ipiAmount)
  const configuredTax = sumOf(snapshot.lines, (line) => line.configuredTaxAmount)
  const commissionBasis = sumOf(snapshot.lines, (line) => line.commissionBasisAmount)
  const commission = sumOf(snapshot.lines, (line) => line.commissionAmount)
  const generalDiscountAllocated = sumOf(
    snapshot.lines,
    (line) => line.allocatedGeneralDiscountAmount,
  )
  const freightLines = sumOf(snapshot.lines, (line) => line.freightAmount)

  expect(totals.grossItemsAmount, grossItems, 'grossItemsAmount', problems)
  expect(totals.perItemDiscountAmount, perItemDiscount, 'perItemDiscountAmount', problems)
  expect(totals.netItemsAmount, netItems, 'netItemsAmount', problems)
  expect(totals.netAfterDiscountsAmount, netAfterDiscounts, 'netAfterDiscountsAmount', problems)
  expect(totals.ipiAmount, ipi, 'ipiAmount', problems)
  expect(totals.configuredTaxAmount, configuredTax, 'configuredTaxAmount', problems)
  expect(totals.commissionBasisAmount, commissionBasis, 'commissionBasisAmount', problems)
  expect(totals.commissionAmount, commission, 'commissionAmount', problems)

  // General discount: stored amount must equal the sum of per-line
  // allocations (the authoritative distribution), and the identity
  // netItems - generalDiscount = netAfterDiscounts must hold.
  expect(
    totals.generalDiscountAmount,
    generalDiscountAllocated,
    'generalDiscountAmount',
    problems,
  )
  expect(
    totals.netAfterDiscountsAmount,
    subtract(netItems, totals.generalDiscountAmount),
    'netAfterDiscountsAmount (netItems - generalDiscount)',
    problems,
  )

  // Freight: header freight is authoritative; per-line freight (when
  // distributed to lines) must not exceed the header amount.
  if (greaterThan(freightLines, totals.freightAmount)) {
    problems.push('freightAmount: sum of line freight exceeds the header freight amount')
  }

  expect(
    totals.grandTotalAmount,
    add(netAfterDiscounts, totals.ipiAmount, totals.configuredTaxAmount, totals.freightAmount),
    'grandTotalAmount (netAfterDiscounts + ipi + configuredTax + freight)',
    problems,
  )

  verifyLineInvariants(snapshot.lines, problems)
  return problems
}

function verifyLineInvariants(
  lines: readonly Readonly<NewOrderSnapshot['lines'][number]>[],
  problems: string[],
): void {
  lines.forEach((line, index) => {
    const label = `lines[${index}]`
    const gross = line.grossAmount
    expect(
      line.perItemDiscountAmount,
      multiply(gross, line.perItemDiscountRate),
      `${label}.perItemDiscountAmount (gross x rate/100)`,
      problems,
    )
    expect(
      line.netBeforeGeneralDiscountAmount,
      subtract(gross, line.perItemDiscountAmount),
      `${label}.netBeforeGeneralDiscountAmount`,
      problems,
    )
    expect(
      line.netAfterDiscountsAmount,
      subtract(line.netBeforeGeneralDiscountAmount, line.allocatedGeneralDiscountAmount),
      `${label}.netAfterDiscountsAmount`,
      problems,
    )
    expect(
      line.ipiAmount,
      multiply(line.netAfterDiscountsAmount, line.ipiRate),
      `${label}.ipiAmount`,
      problems,
    )
    expect(
      line.configuredTaxAmount,
      sum(line.configuredTaxes.map((tax) => tax.amount)),
      `${label}.configuredTaxAmount`,
      problems,
    )
    line.configuredTaxes.forEach((tax, taxIndex) => {
      expect(
        tax.amount,
        multiply(tax.basisAmount, tax.rate),
        `${label}.configuredTaxes[${taxIndex}].amount`,
        problems,
      )
      expect(tax.basisAmount, line.netAfterDiscountsAmount, `${label}.configuredTaxes[${taxIndex}].basisAmount`, problems)
    })
    expect(
      line.commissionBasisAmount,
      line.netAfterDiscountsAmount,
      `${label}.commissionBasisAmount`,
      problems,
    )
    if (line.commissionRate === null) {
      if (line.commissionSource !== 'none') {
        problems.push(`${label}.commissionSource must be 'none' when commissionRate is null`)
      }
      expect(line.commissionAmount, '0.000000', `${label}.commissionAmount`, problems)
    } else {
      if (line.commissionSource === 'none') {
        problems.push(`${label}.commissionSource must not be 'none' when commissionRate is set`)
      }
      expect(
        line.commissionAmount,
        multiply(line.commissionBasisAmount, line.commissionRate),
        `${label}.commissionAmount`,
        problems,
      )
    }
    expect(
      line.lineTotalAmount,
      add(line.netAfterDiscountsAmount, line.ipiAmount, line.configuredTaxAmount, line.freightAmount),
      `${label}.lineTotalAmount`,
      problems,
    )
  })
}

function expect(
  stored: DecimalString,
  recalculated: string,
  field: string,
  problems: string[],
): void {
  if (stored !== recalculated) {
    problems.push(`${field}: stored ${stored} != recalculated ${recalculated}`)
  }
}

function sumOf<T>(
  values: readonly T[],
  pick: (value: T) => DecimalString,
): string {
  return sum(values.map(pick))
}

/** Exact fixed-point addition on 6-decimal strings. */
function add(...values: readonly string[]): string {
  return sum(values)
}

function subtract(left: string, right: string): string {
  return format(toMicro(left) - toMicro(right))
}

function multiply(amount: string, rate: string): string {
  // amount(micro, 1e6) * rate(micro, 1e6) / 1e8 => result in micro units,
  // rounded half-up at 6-decimal precision. Both factors stay exact in
  // double precision for every magnitude the schema permits.
  return format(Math.round((toMicro(amount) * toMicro(rate)) / 1e8))
}

function sum(values: readonly string[]): string {
  return format(values.reduce((total, value) => total + toMicro(value), 0))
}

function toMicro(value: string): number {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) {
    throw new Error(`Invalid decimal string: ${value}`)
  }
  const [integer = '0', fraction = ''] = value.split('.')
  const padded = (fraction + '000000').slice(0, 6)
  return Number(integer) * 1_000_000 + Number(padded) * (integer.startsWith('-') ? -1 : 1)
}

function format(micro: number): string {
  const negative = micro < 0
  const absolute = Math.abs(micro)
  const integer = Math.floor(absolute / 1_000_000)
  const fraction = String(absolute % 1_000_000).padStart(6, '0')
  return `${negative ? '-' : ''}${integer}.${fraction}`
}

function greaterThan(left: string, right: string): boolean {
  return toMicro(left) > toMicro(right)
}
