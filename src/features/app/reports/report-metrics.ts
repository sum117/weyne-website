import Decimal from 'decimal.js'

export const REPORTABLE_ORDER_STATUSES = [
  'open',
  'confirmed',
  'invoiced',
  'completed',
] as const
export const ORDER_METRIC_STATUSES = [...REPORTABLE_ORDER_STATUSES, 'cancelled'] as const
export const MAX_METRIC_SOURCE_ORDERS = 50_000

export type MetricRole = 'admin' | 'representative' | 'read_only'
export type MetricOrderStatus = (typeof ORDER_METRIC_STATUSES)[number]

export type MetricClient = Readonly<{
  id: string
  name: string
  representativeId: string
}>

export type MetricOrderLine = Readonly<{
  productId: string
  productName: string
  industryId: string
  industryName: string
  quantity: string
  totalAmount: string
  currencyCode?: string
}>

export type MetricOrder = Readonly<{
  id: string
  clientId: string
  representativeId: string
  occurredAt: string
  status: MetricOrderStatus
  currencyCode: string
  totalAmount: string
  commissionAmount: string
  lines: readonly MetricOrderLine[]
}>

export type MetricRequest = Readonly<{
  from: string
  to: string
  asOf: string
  inactiveDays: number
  timeZone: string
  role: MetricRole
  actorRepresentativeId: string | null
  explicitlyAssignedRepresentativeIds: readonly string[]
  statuses: readonly MetricOrderStatus[]
}>

type CurrencyTotal = Readonly<{
  currencyCode: string
  totalAmount: string
  commissionAmount: string
}>

type LineCurrencyTotal = Readonly<{
  currencyCode: string
  totalAmount: string
}>

export type ReportMetricSnapshot = Readonly<{
  period: Readonly<{
    fromInclusive: string
    toExclusive: string
    timeZone: string
  }>
  byCurrency: readonly Readonly<{
    currencyCode: string
    orderCount: number
    clientCount: number
    totalAmount: string
    commissionAmount: string | null
  }>[]
  clients: readonly Readonly<{
    id: string
    name: string
    orderCount: number
    byCurrency: readonly CurrencyTotal[]
  }>[]
  products: readonly Readonly<{
    id: string
    name: string
    quantity: string
    byCurrency: readonly LineCurrencyTotal[]
  }>[]
  industries: readonly Readonly<{
    id: string
    name: string
    orderCount: number
    byCurrency: readonly LineCurrencyTotal[]
  }>[]
  commissions: readonly Readonly<{
    representativeId: string
    orderCount: number
    byCurrency: readonly Readonly<{
      currencyCode: string
      salesAmount: string
      commissionAmount: string
    }>[]
  }>[]
  inactiveClients: readonly Readonly<{
    id: string
    name: string
    representativeId: string
    lastActivityAt: string | null
    inactiveSince: string
  }>[]
}>

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CURRENCY_PATTERN = /^[A-Z]{3}$/
const SIX_DECIMALS = 6

function exactDecimal(value: string, field: string): Decimal {
  try {
    const decimal = new Decimal(value)
    if (!decimal.isFinite() || decimal.isNegative()) throw new TypeError()
    return decimal
  } catch {
    throw new TypeError(`${field} must be a non-negative exact decimal`)
  }
}

function fixed(value: Decimal): string {
  return value.toFixed(SIX_DECIMALS, Decimal.ROUND_HALF_UP)
}

export function roundMetricMoney(value: string): string {
  return exactDecimal(value, 'money').toFixed(2, Decimal.ROUND_HALF_UP)
}

function parseDate(value: string, field: string): readonly [number, number, number] {
  if (!ISO_DATE_PATTERN.test(value)) throw new TypeError(`${field} must be an ISO date`)
  const [year, month, day] = value.split('-').map(Number)
  const candidate = new Date(Date.UTC(year!, month! - 1, day!))
  if (candidate.toISOString().slice(0, 10) !== value) {
    throw new TypeError(`${field} must be a valid ISO date`)
  }
  return [year!, month!, day!]
}

function timeZoneParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return {
    year: Number(value.year),
    month: Number(value.month),
    day: Number(value.day),
    hour: Number(value.hour),
    minute: Number(value.minute),
    second: Number(value.second),
  }
}

function localMidnightUtc(value: string, timeZone: string): Date {
  const [year, month, day] = parseDate(value, 'date')
  let instant = new Date(Date.UTC(year, month - 1, day))
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const local = timeZoneParts(instant, timeZone)
      const observed = Date.UTC(
        local.year,
        local.month - 1,
        local.day,
        local.hour,
        local.minute,
        local.second,
      )
      const wanted = Date.UTC(year, month - 1, day)
      instant = new Date(instant.valueOf() + wanted - observed)
    }
  } catch {
    throw new TypeError('timeZone must be a valid IANA time zone')
  }
  return instant
}

function shiftIsoDate(value: string, days: number): string {
  const [year, month, day] = parseDate(value, 'date')
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return date.toISOString().slice(0, 10)
}

function scopedRepresentativeIds(request: MetricRequest): Set<string> | null {
  if (request.role === 'admin') return null
  if (request.role === 'representative') {
    if (!request.actorRepresentativeId) {
      throw new TypeError('actorRepresentativeId is required for representative metrics')
    }
    return new Set([request.actorRepresentativeId])
  }
  return new Set(request.explicitlyAssignedRepresentativeIds)
}

function addAmount(map: Map<string, Decimal>, key: string, amount: Decimal): void {
  map.set(key, (map.get(key) ?? new Decimal(0)).plus(amount))
}

function currencyTotals(
  totals: Map<string, Decimal>,
  commissions: Map<string, Decimal>,
): CurrencyTotal[] {
  return [...totals.keys()]
    .sort()
    .map((currencyCode) => ({
      currencyCode,
      totalAmount: fixed(totals.get(currencyCode)!),
      commissionAmount: fixed(commissions.get(currencyCode) ?? new Decimal(0)),
    }))
}

function lineCurrencyTotals(totals: Map<string, Decimal>): LineCurrencyTotal[] {
  return [...totals.keys()]
    .sort()
    .map((currencyCode) => ({
      currencyCode,
      totalAmount: fixed(totals.get(currencyCode)!),
    }))
}

function validateRequest(request: MetricRequest) {
  parseDate(request.from, 'from')
  parseDate(request.to, 'to')
  parseDate(request.asOf, 'asOf')
  if (request.from > request.to) throw new TypeError('from must not be after to')
  if (!Number.isSafeInteger(request.inactiveDays) || request.inactiveDays < 1) {
    throw new TypeError('inactiveDays must be a positive integer')
  }
  for (const status of request.statuses) {
    if (!ORDER_METRIC_STATUSES.includes(status)) throw new TypeError('statuses are invalid')
  }
}

export function buildReportMetrics(input: Readonly<{
  clients: readonly MetricClient[]
  orders: readonly MetricOrder[]
  request: MetricRequest
}>): ReportMetricSnapshot {
  validateRequest(input.request)
  if (input.orders.length > MAX_METRIC_SOURCE_ORDERS) {
    throw new RangeError(`Metric source is limited to ${MAX_METRIC_SOURCE_ORDERS.toLocaleString('en-US')} orders`)
  }

  const from = localMidnightUtc(input.request.from, input.request.timeZone)
  const to = localMidnightUtc(shiftIsoDate(input.request.to, 1), input.request.timeZone)
  const asOfExclusive = localMidnightUtc(shiftIsoDate(input.request.asOf, 1), input.request.timeZone)
  const inactiveSince = shiftIsoDate(input.request.asOf, -input.request.inactiveDays)
  const inactiveBoundary = localMidnightUtc(inactiveSince, input.request.timeZone)
  const representativeIds = scopedRepresentativeIds(input.request)
  const statusFilter = new Set(input.request.statuses)
  const clientById = new Map(input.clients.map((client) => [client.id, client]))
  const scopedClients = input.clients.filter(
    (client) => representativeIds === null || representativeIds.has(client.representativeId),
  )
  const scopedOrders = input.orders.filter(
    (order) => representativeIds === null || representativeIds.has(order.representativeId),
  )

  const selectedOrders = scopedOrders.filter((order) => {
    const occurredAt = new Date(order.occurredAt)
    if (Number.isNaN(occurredAt.valueOf())) throw new TypeError('occurredAt must be an instant')
    return (
      order.status !== 'cancelled' &&
      (statusFilter.size === 0 || statusFilter.has(order.status)) &&
      occurredAt >= from &&
      occurredAt < to
    )
  })

  const totals = new Map<string, Decimal>()
  const commissions = new Map<string, Decimal>()
  const currencyClients = new Map<string, Set<string>>()
  const clientGroups = new Map<
    string,
    { name: string; orderCount: number; totals: Map<string, Decimal>; commissions: Map<string, Decimal> }
  >()
  const productGroups = new Map<
    string,
    { name: string; quantity: Decimal; totals: Map<string, Decimal> }
  >()
  const industryGroups = new Map<
    string,
    { name: string; orderIds: Set<string>; totals: Map<string, Decimal> }
  >()
  const representativeGroups = new Map<
    string,
    { orderIds: Set<string>; totals: Map<string, Decimal>; commissions: Map<string, Decimal> }
  >()

  for (const order of selectedOrders) {
    if (!CURRENCY_PATTERN.test(order.currencyCode)) {
      throw new TypeError('currencyCode must be an ISO 4217-style code')
    }
    const total = exactDecimal(order.totalAmount, 'totalAmount')
    const commission = exactDecimal(order.commissionAmount, 'commissionAmount')
    addAmount(totals, order.currencyCode, total)
    addAmount(commissions, order.currencyCode, commission)
    const clientsForCurrency = currencyClients.get(order.currencyCode) ?? new Set<string>()
    clientsForCurrency.add(order.clientId)
    currencyClients.set(order.currencyCode, clientsForCurrency)

    const client = clientById.get(order.clientId)
    const clientGroup = clientGroups.get(order.clientId) ?? {
      name: client?.name ?? order.clientId,
      orderCount: 0,
      totals: new Map(),
      commissions: new Map(),
    }
    clientGroup.orderCount += 1
    addAmount(clientGroup.totals, order.currencyCode, total)
    addAmount(clientGroup.commissions, order.currencyCode, commission)
    clientGroups.set(order.clientId, clientGroup)

    const representativeGroup = representativeGroups.get(order.representativeId) ?? {
      orderIds: new Set<string>(),
      totals: new Map(),
      commissions: new Map(),
    }
    representativeGroup.orderIds.add(order.id)
    addAmount(representativeGroup.totals, order.currencyCode, total)
    addAmount(representativeGroup.commissions, order.currencyCode, commission)
    representativeGroups.set(order.representativeId, representativeGroup)

    for (const line of order.lines) {
      const lineCurrency = line.currencyCode ?? order.currencyCode
      if (lineCurrency !== order.currencyCode) {
        throw new TypeError('Line currency must match its order currency')
      }
      const lineTotal = exactDecimal(line.totalAmount, 'line.totalAmount')
      const quantity = exactDecimal(line.quantity, 'line.quantity')
      const productGroup = productGroups.get(line.productId) ?? {
        name: line.productName,
        quantity: new Decimal(0),
        totals: new Map(),
      }
      productGroup.quantity = productGroup.quantity.plus(quantity)
      addAmount(productGroup.totals, lineCurrency, lineTotal)
      productGroups.set(line.productId, productGroup)

      const industryGroup = industryGroups.get(line.industryId) ?? {
        name: line.industryName,
        orderIds: new Set<string>(),
        totals: new Map(),
      }
      industryGroup.orderIds.add(order.id)
      addAmount(industryGroup.totals, lineCurrency, lineTotal)
      industryGroups.set(line.industryId, industryGroup)
    }
  }

  const byNameAndId = <T extends { id: string; name: string }>(left: T, right: T) =>
    left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id)
  const commissionVisible = input.request.role !== 'read_only'

  return {
    period: {
      fromInclusive: from.toISOString(),
      toExclusive: to.toISOString(),
      timeZone: input.request.timeZone,
    },
    byCurrency: [...totals.keys()].sort().map((currencyCode) => ({
      currencyCode,
      orderCount: selectedOrders.filter((order) => order.currencyCode === currencyCode).length,
      clientCount: currencyClients.get(currencyCode)?.size ?? 0,
      totalAmount: fixed(totals.get(currencyCode)!),
      commissionAmount: commissionVisible
        ? fixed(commissions.get(currencyCode) ?? new Decimal(0))
        : null,
    })),
    clients: [...clientGroups].map(([id, group]) => ({
      id,
      name: group.name,
      orderCount: group.orderCount,
      byCurrency: currencyTotals(group.totals, group.commissions),
    })).sort(byNameAndId),
    products: [...productGroups].map(([id, group]) => ({
      id,
      name: group.name,
      quantity: fixed(group.quantity),
      byCurrency: lineCurrencyTotals(group.totals),
    })).sort(byNameAndId),
    industries: [...industryGroups].map(([id, group]) => ({
      id,
      name: group.name,
      orderCount: group.orderIds.size,
      byCurrency: lineCurrencyTotals(group.totals),
    })).sort(byNameAndId),
    commissions: commissionVisible
      ? [...representativeGroups].map(([representativeId, group]) => ({
          representativeId,
          orderCount: group.orderIds.size,
          byCurrency: [...group.totals.keys()].sort().map((currencyCode) => ({
            currencyCode,
            salesAmount: fixed(group.totals.get(currencyCode)!),
            commissionAmount: fixed(group.commissions.get(currencyCode) ?? new Decimal(0)),
          })),
        })).sort((left, right) => left.representativeId.localeCompare(right.representativeId))
      : [],
    inactiveClients: scopedClients
      .map((client) => {
        const lastActivity = scopedOrders
          .filter((order) => order.clientId === client.id && order.status !== 'cancelled')
          .map((order) => new Date(order.occurredAt))
          .filter((date) => !Number.isNaN(date.valueOf()) && date < asOfExclusive)
          .sort((left, right) => right.valueOf() - left.valueOf())[0]
        return { client, lastActivity }
      })
      .filter(({ lastActivity }) => !lastActivity || lastActivity < inactiveBoundary)
      .map(({ client, lastActivity }) => ({
        id: client.id,
        name: client.name,
        representativeId: client.representativeId,
        lastActivityAt: lastActivity?.toISOString() ?? null,
        inactiveSince,
      }))
      .sort(byNameAndId),
  }
}

export function projectDashboardMetrics(snapshot: ReportMetricSnapshot) {
  return snapshot.byCurrency
}

export function projectReportMetrics(
  snapshot: ReportMetricSnapshot,
  grouping: 'clientes' | 'produtos' | 'industrias' | 'comissoes',
) {
  if (grouping === 'clientes') return snapshot.clients
  if (grouping === 'produtos') return snapshot.products
  if (grouping === 'industrias') return snapshot.industries
  return snapshot.commissions
}
