import { and, eq, sql } from 'drizzle-orm'
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import type * as schema from '@/lib/db/schema'
import {
  orderLines,
  orderLineTaxes,
  orders,
  orderStateAudit,
  type OrderStatus,
} from '@/lib/db/schema'

export type DecimalString = string

export interface OrderClientSnapshot {
  readonly id: string
  readonly legalName: string
  readonly tradeName: string | null
  readonly taxIdentifier: string
  readonly stateRegistration: string | null
  readonly email: string | null
  readonly phone: string | null
  readonly address: Readonly<{
    street: string
    number: string
    complement: string | null
    district: string
    city: string
    state: string
    postalCode: string
    countryCode: string
  }>
}

export interface OrderProductSnapshot {
  readonly id: string
  readonly industryId: string
  readonly industryName: string
  readonly internalCode: string
  readonly manufacturerCode: string | null
  readonly description: string
  readonly brand: string | null
  readonly category: string | null
  readonly ncm: string | null
  readonly cest: string | null
  readonly ean: string | null
  readonly dun: string | null
  readonly packaging: string | null
  readonly unit: string
}

export interface OrderConfiguredTaxSnapshot {
  readonly code: string
  readonly rate: DecimalString
  readonly basisAmount: DecimalString
  readonly amount: DecimalString
}

export interface NewOrderLineSnapshot {
  readonly sourceQuoteLineId: string
  readonly lineNumber: number
  readonly product: Readonly<OrderProductSnapshot>
  readonly quantity: DecimalString
  readonly unitPrice: Readonly<{
    priceListId: string
    productPriceVersionId: string
    source: 'price_list' | 'manual_override'
    amount: DecimalString
  }>
  readonly grossAmount: DecimalString
  readonly perItemDiscountRate: DecimalString
  readonly perItemDiscountAmount: DecimalString
  readonly netBeforeGeneralDiscountAmount: DecimalString
  readonly allocatedGeneralDiscountAmount: DecimalString
  readonly netAfterDiscountsAmount: DecimalString
  readonly ipiRate: DecimalString
  readonly ipiBasisAmount: DecimalString
  readonly ipiAmount: DecimalString
  readonly configuredTaxAmount: DecimalString
  readonly freightAmount: DecimalString
  readonly lineTotalAmount: DecimalString
  readonly commissionSource: 'product_override' | 'industry_default' | 'none'
  readonly commissionRate: DecimalString | null
  readonly commissionBasisAmount: DecimalString
  readonly commissionAmount: DecimalString
  readonly configuredTaxes: readonly Readonly<OrderConfiguredTaxSnapshot>[]
}

export interface NewOrderSnapshot {
  readonly sourceQuoteId: string
  readonly sourceQuoteRevision: number
  readonly client: Readonly<OrderClientSnapshot>
  readonly currencyCode: string
  readonly totals: Readonly<{
    grossItemsAmount: DecimalString
    perItemDiscountAmount: DecimalString
    netItemsAmount: DecimalString
    generalDiscountRate: DecimalString
    generalDiscountAmount: DecimalString
    netAfterDiscountsAmount: DecimalString
    ipiAmount: DecimalString
    configuredTaxAmount: DecimalString
    freightAmount: DecimalString
    grandTotalAmount: DecimalString
    commissionBasisAmount: DecimalString
    commissionAmount: DecimalString
  }>
  readonly lines: readonly Readonly<NewOrderLineSnapshot>[]
}

export interface OrderAuditMetadata {
  readonly actor: string
  readonly reason: string
  readonly occurredAt?: Date
}

export type PersistedOrder = Readonly<{
  id: string
  sourceQuoteId: string
  number: string
  status: OrderStatus
  version: bigint
  createdAt: Date
}>

export type TransitionOrderStateInput = Readonly<{
  orderId: string
  expectedVersion: bigint
  toStatus: OrderStatus
  actor: string
  reason: string
  occurredAt?: Date
}>

export class OrderPersistenceError extends Error {
  readonly code: 'ORDER_NOT_FOUND' | 'CONCURRENT_MODIFICATION' | 'NUMBER_EXHAUSTED'

  constructor(code: OrderPersistenceError['code'], message = code) {
    super(message)
    this.name = 'OrderPersistenceError'
    this.code = code
  }
}

type Database = PostgresJsDatabase<typeof schema>
type Transaction = Parameters<Parameters<Database['transaction']>[0]>[0]

export interface OrderTransaction {
  createOrder(snapshot: NewOrderSnapshot, audit: OrderAuditMetadata): Promise<PersistedOrder>
  findBySourceQuote(sourceQuoteId: string): Promise<PersistedOrder | null>
  transitionState(input: TransitionOrderStateInput): Promise<PersistedOrder>
}

export interface PostgresOrderRepository {
  transaction<T>(work: (transaction: OrderTransaction) => Promise<T>): Promise<T>
}

export function createPostgresOrderRepository(database: Database): PostgresOrderRepository {
  return Object.freeze({
    transaction<T>(work: (transaction: OrderTransaction) => Promise<T>) {
      return database.transaction((transaction) => work(createOrderTransaction(transaction)))
    },
  })
}

function createOrderTransaction(transaction: Transaction): OrderTransaction {
  return Object.freeze({
    async createOrder(snapshot: NewOrderSnapshot, audit: OrderAuditMetadata) {
      const occurredAt = audit.occurredAt ?? new Date()
      const year = occurredAt.getUTCFullYear()
      const sequence = await allocateOrderSequence(transaction, year)
      const number = `PED-${year}-${String(sequence).padStart(6, '0')}`
      const [created] = await transaction
        .insert(orders)
        .values({
          sourceQuoteId: snapshot.sourceQuoteId,
          sourceQuoteRevision: snapshot.sourceQuoteRevision,
          number,
          numberYear: year,
          numberSequence: sequence,
          status: 'open',
          version: 1n,
          clientId: snapshot.client.id,
          clientLegalName: snapshot.client.legalName,
          clientTradeName: snapshot.client.tradeName,
          clientTaxIdentifier: snapshot.client.taxIdentifier,
          clientStateRegistration: snapshot.client.stateRegistration,
          clientEmail: snapshot.client.email,
          clientPhone: snapshot.client.phone,
          clientAddressStreet: snapshot.client.address.street,
          clientAddressNumber: snapshot.client.address.number,
          clientAddressComplement: snapshot.client.address.complement,
          clientAddressDistrict: snapshot.client.address.district,
          clientAddressCity: snapshot.client.address.city,
          clientAddressState: snapshot.client.address.state,
          clientAddressPostalCode: snapshot.client.address.postalCode,
          clientAddressCountryCode: snapshot.client.address.countryCode,
          currencyCode: snapshot.currencyCode,
          ...snapshot.totals,
          createdAt: occurredAt,
          createdBy: audit.actor,
          creationReason: audit.reason,
          updatedAt: occurredAt,
          updatedBy: audit.actor,
          statusChangedAt: occurredAt,
          statusChangedBy: audit.actor,
          statusChangeReason: audit.reason,
        })
        .returning()

      if (!created) throw new Error('Order insert did not return a row')

      for (const line of snapshot.lines) {
        const [createdLine] = await transaction
          .insert(orderLines)
          .values({
            orderId: created.id,
            sourceQuoteLineId: line.sourceQuoteLineId,
            lineNumber: line.lineNumber,
            productId: line.product.id,
            productIndustryId: line.product.industryId,
            productIndustryName: line.product.industryName,
            productInternalCode: line.product.internalCode,
            productManufacturerCode: line.product.manufacturerCode,
            productDescription: line.product.description,
            productBrand: line.product.brand,
            productCategory: line.product.category,
            productNcm: line.product.ncm,
            productCest: line.product.cest,
            productEan: line.product.ean,
            productDun: line.product.dun,
            productPackaging: line.product.packaging,
            productUnit: line.product.unit,
            quantity: line.quantity,
            priceListId: line.unitPrice.priceListId,
            productPriceVersionId: line.unitPrice.productPriceVersionId,
            unitPriceSource: line.unitPrice.source,
            unitPriceAmount: line.unitPrice.amount,
            grossAmount: line.grossAmount,
            perItemDiscountRate: line.perItemDiscountRate,
            perItemDiscountAmount: line.perItemDiscountAmount,
            netBeforeGeneralDiscountAmount: line.netBeforeGeneralDiscountAmount,
            allocatedGeneralDiscountAmount: line.allocatedGeneralDiscountAmount,
            netAfterDiscountsAmount: line.netAfterDiscountsAmount,
            ipiRate: line.ipiRate,
            ipiBasisAmount: line.ipiBasisAmount,
            ipiAmount: line.ipiAmount,
            configuredTaxAmount: line.configuredTaxAmount,
            freightAmount: line.freightAmount,
            lineTotalAmount: line.lineTotalAmount,
            commissionSource: line.commissionSource,
            commissionRate: line.commissionRate,
            commissionBasisAmount: line.commissionBasisAmount,
            commissionAmount: line.commissionAmount,
            createdAt: occurredAt,
          })
          .returning({ id: orderLines.id })

        if (!createdLine) throw new Error('Order line insert did not return a row')
        if (line.configuredTaxes.length > 0) {
          await transaction.insert(orderLineTaxes).values(
            line.configuredTaxes.map((tax: Readonly<OrderConfiguredTaxSnapshot>) => ({
              orderLineId: createdLine.id,
              code: tax.code,
              rate: tax.rate,
              basisAmount: tax.basisAmount,
              amount: tax.amount,
              createdAt: occurredAt,
            })),
          )
        }
      }

      await transaction.insert(orderStateAudit).values({
        orderId: created.id,
        fromStatus: null,
        toStatus: 'open',
        actor: audit.actor,
        reason: audit.reason,
        occurredAt,
        version: 1n,
      })

      return mapOrder(created)
    },

    async findBySourceQuote(sourceQuoteId: string) {
      const [order] = await transaction
        .select()
        .from(orders)
        .where(eq(orders.sourceQuoteId, sourceQuoteId))
        .limit(1)
      return order ? mapOrder(order) : null
    },

    async transitionState(input: TransitionOrderStateInput) {
      const occurredAt = input.occurredAt ?? new Date()
      const [current] = await transaction
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1)
        .for('update')
      if (!current) throw new OrderPersistenceError('ORDER_NOT_FOUND')
      if (current.version !== input.expectedVersion) {
        throw new OrderPersistenceError('CONCURRENT_MODIFICATION')
      }

      const nextVersion = input.expectedVersion + 1n
      const [updated] = await transaction
        .update(orders)
        .set({
          status: input.toStatus,
          version: nextVersion,
          updatedAt: occurredAt,
          updatedBy: input.actor,
          statusChangedAt: occurredAt,
          statusChangedBy: input.actor,
          statusChangeReason: input.reason,
        })
        .where(and(eq(orders.id, input.orderId), eq(orders.version, input.expectedVersion)))
        .returning()
      if (!updated) throw new OrderPersistenceError('CONCURRENT_MODIFICATION')

      await transaction.insert(orderStateAudit).values({
        orderId: input.orderId,
        fromStatus: current.status,
        toStatus: input.toStatus,
        actor: input.actor,
        reason: input.reason,
        occurredAt,
        version: nextVersion,
      })
      return mapOrder(updated)
    },
  })
}

async function allocateOrderSequence(transaction: Transaction, year: number): Promise<number> {
  const rows = (await transaction.execute(sql`
    INSERT INTO document_sequences (document_type, year, next_value)
    VALUES ('order', ${year}, 2)
    ON CONFLICT (document_type, year)
    DO UPDATE SET next_value = document_sequences.next_value + 1
    RETURNING (next_value - 1)::text AS allocated
  `)) as unknown as Array<{ allocated: string }>
  const allocated = Number(rows[0]?.allocated)
  if (!Number.isSafeInteger(allocated) || allocated < 1 || allocated > 999999) {
    throw new OrderPersistenceError('NUMBER_EXHAUSTED')
  }
  return allocated
}

function mapOrder(row: typeof orders.$inferSelect): PersistedOrder {
  return Object.freeze({
    id: row.id,
    sourceQuoteId: row.sourceQuoteId,
    number: row.number,
    status: row.status as OrderStatus,
    version: row.version,
    createdAt: row.createdAt,
  })
}
