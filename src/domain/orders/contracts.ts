import { z } from 'zod'
import { decimalStringSchema, percentageSchema } from '@/domain/primitives/decimal'
import { orderStatusSchema, type OrderStatus } from '@/domain/primitives/status'
import { uuidSchema } from '@/domain/primitives/uuid'
import { createListRequestSchema, cursorSchema } from '@/lib/server/request.schema'

const orderNumberSchema = z
  .string()
  .trim()
  .regex(
    /^PED-\d{4}-\d{6}$/,
    'Informe um número de pedido no formato PED-AAAA-NNNNNN',
  )

const dateRangeShape = {
  from: z.iso.date('Informe uma data inicial válida no formato AAAA-MM-DD'),
  to: z.iso.date('Informe uma data final válida no formato AAAA-MM-DD'),
}

const orderListRequestSchema = createListRequestSchema({
  filters: {
    number: orderNumberSchema,
    sourceQuoteId: uuidSchema,
    status: orderStatusSchema,
    clientId: uuidSchema,
    createdFrom: dateRangeShape.from,
    createdTo: dateRangeShape.to,
  },
  sortFields: ['number', 'createdAt', 'grandTotalAmount'] as const,
  defaultSort: 'number',
  defaultDirection: 'desc',
})

export const orderListInputSchema = orderListRequestSchema.superRefine(
  (request, context) => {
    const filters = request.filters as OrderListFilters
    const from = filters.createdFrom
    const to = filters.createdTo
    if (from && to && from > to) {
      context.addIssue({
        code: 'custom',
        path: ['filters', 'createdTo'],
        message: 'A data final deve ser igual ou posterior à data inicial',
      })
    }
  },
)

export const orderIdInputSchema = z.strictObject({ id: uuidSchema })

const decimalAmountSchema = decimalStringSchema

const configuredTaxSnapshotSchema = z.strictObject({
  code: z.string().min(1),
  rate: percentageSchema,
  basisAmount: decimalAmountSchema,
  amount: decimalAmountSchema,
})

const productSnapshotSchema = z.strictObject({
  id: uuidSchema,
  industryId: uuidSchema,
  industryName: z.string().min(1),
  internalCode: z.string().min(1),
  manufacturerCode: z.string().nullable(),
  description: z.string().min(1),
  brand: z.string().nullable(),
  category: z.string().nullable(),
  ncm: z.string().nullable(),
  cest: z.string().nullable(),
  ean: z.string().nullable(),
  dun: z.string().nullable(),
  packaging: z.string().nullable(),
  unit: z.string().min(1),
})

const lineSnapshotSchema = z.strictObject({
  sourceQuoteLineId: uuidSchema,
  lineNumber: z.number().int().positive(),
  product: productSnapshotSchema,
  quantity: decimalAmountSchema,
  unitPrice: z.strictObject({
    priceListId: uuidSchema,
    productPriceVersionId: uuidSchema,
    source: z.enum(['price_list', 'manual_override']),
    amount: decimalAmountSchema,
  }),
  grossAmount: decimalAmountSchema,
  perItemDiscountRate: percentageSchema,
  perItemDiscountAmount: decimalAmountSchema,
  netBeforeGeneralDiscountAmount: decimalAmountSchema,
  allocatedGeneralDiscountAmount: decimalAmountSchema,
  netAfterDiscountsAmount: decimalAmountSchema,
  ipiRate: percentageSchema,
  ipiBasisAmount: decimalAmountSchema,
  ipiAmount: decimalAmountSchema,
  configuredTaxAmount: decimalAmountSchema,
  freightAmount: decimalAmountSchema,
  lineTotalAmount: decimalAmountSchema,
  commissionSource: z.enum(['product_override', 'industry_default', 'none']),
  commissionRate: percentageSchema.nullable(),
  commissionBasisAmount: decimalAmountSchema,
  commissionAmount: decimalAmountSchema,
  configuredTaxes: z.array(configuredTaxSnapshotSchema),
})

const totalsSchema = z.strictObject({
  grossItemsAmount: decimalAmountSchema,
  perItemDiscountAmount: decimalAmountSchema,
  netItemsAmount: decimalAmountSchema,
  generalDiscountRate: percentageSchema,
  generalDiscountAmount: decimalAmountSchema,
  netAfterDiscountsAmount: decimalAmountSchema,
  ipiAmount: decimalAmountSchema,
  configuredTaxAmount: decimalAmountSchema,
  freightAmount: decimalAmountSchema,
  grandTotalAmount: decimalAmountSchema,
  commissionBasisAmount: decimalAmountSchema,
  commissionAmount: decimalAmountSchema,
})

const clientSnapshotSchema = z.strictObject({
  id: uuidSchema,
  legalName: z.string().min(1),
  tradeName: z.string().nullable(),
  taxIdentifier: z.string().min(1),
  stateRegistration: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address: z.strictObject({
    street: z.string().min(1),
    number: z.string().min(1),
    complement: z.string().nullable(),
    district: z.string().min(1),
    city: z.string().min(1),
    state: z.string().length(2),
    postalCode: z.string().min(1),
    countryCode: z.string().length(2),
  }),
})

/**
 * Full detail view. Snapshot fields are the values captured when the source
 * quote was converted — never live catalog/client data.
 */
export const orderDetailSchema = z.strictObject({
  id: uuidSchema,
  number: orderNumberSchema,
  status: orderStatusSchema,
  version: z.number().int().positive(),
  currencyCode: z.string().length(3),
  sourceQuoteId: uuidSchema,
  sourceQuoteRevision: z.number().int().positive(),
  client: clientSnapshotSchema,
  totals: totalsSchema,
  lines: z.array(lineSnapshotSchema).min(1),
  audit: z.strictObject({
    createdAt: z.iso.datetime(),
    createdBy: z.string().min(1),
    creationReason: z.string().min(1),
    updatedAt: z.iso.datetime(),
    updatedBy: z.string().min(1),
    statusChangedAt: z.iso.datetime(),
    statusChangedBy: z.string().min(1),
    statusChangeReason: z.string().min(1),
  }),
})

/** Detail view for read_only actors: financial and audit fields are redacted. */
export const redactedOrderDetailSchema = orderDetailSchema.omit({
  totals: true,
  lines: true,
  audit: true,
})

export const orderListItemSchema = z.strictObject({
  id: uuidSchema,
  number: orderNumberSchema,
  status: orderStatusSchema,
  clientId: uuidSchema,
  clientLegalName: z.string().min(1),
  grandTotalAmount: decimalAmountSchema,
  createdAt: z.iso.datetime(),
})

export const orderListOutputSchema = z.strictObject({
  items: z.array(orderListItemSchema),
  nextCursor: z.string().nullable(),
})

/** The only event types the unified history API may ever return. */
export const ORDER_HISTORY_EVENT_TYPES = [
  'order.created',
  'order.status_changed',
  'order.attachment.uploaded',
  'order.attachment.deleted',
] as const

export type OrderHistoryEventType = (typeof ORDER_HISTORY_EVENT_TYPES)[number]

export const orderHistoryInputSchema = z.strictObject({
  id: uuidSchema,
  direction: z.enum(['asc', 'desc']).default('desc'),
  cursor: cursorSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
})

const historyAttachmentSchema = z.strictObject({
  id: uuidSchema,
  label: z.string().min(1),
})

/** Allowlisted timeline event: no tokens, storage keys, checksums, or auth data. */
export const orderHistoryEventSchema = z.strictObject({
  // Opaque source-row identifier (also the equal-timestamp tiebreaker); not
  // necessarily a UUID across merged audit sources.
  id: z.string().min(1),
  type: z.enum(ORDER_HISTORY_EVENT_TYPES),
  occurredAt: z.iso.datetime(),
  description: z.string().min(1),
  actorId: z.string().min(1).nullable(),
  attachment: historyAttachmentSchema.nullable(),
})

export const orderHistoryOutputSchema = z.strictObject({
  events: z.array(orderHistoryEventSchema),
  nextCursor: z.string().nullable(),
})

export type OrderListInput = z.input<typeof orderListInputSchema>

/**
 * The generic filter shape inside `createListRequestSchema` does not survive
 * inference (same known gap the carrier contracts work around), so the parsed
 * query type declares its filters explicitly.
 */
export type OrderListFilters = Readonly<{
  number?: string
  sourceQuoteId?: string
  status?: OrderStatus
  clientId?: string
  createdFrom?: string
  createdTo?: string
}>

export type OrderListQuery = Omit<
  z.output<typeof orderListInputSchema>,
  'filters'
> & {
  readonly filters: OrderListFilters
}
export type OrderListItem = z.output<typeof orderListItemSchema>
export type OrderListOutput = z.output<typeof orderListOutputSchema>
export type OrderDetailInput = z.output<typeof orderIdInputSchema>
export type OrderDetail = z.output<typeof orderDetailSchema>
export type RedactedOrderDetail = z.output<typeof redactedOrderDetailSchema>
export type OrderHistoryInput = z.input<typeof orderHistoryInputSchema>
export type OrderHistoryQuery = z.output<typeof orderHistoryInputSchema>
export type OrderHistoryEvent = z.output<typeof orderHistoryEventSchema>
export type OrderHistoryOutput = z.output<typeof orderHistoryOutputSchema>
