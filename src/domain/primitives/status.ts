import { z } from 'zod'

export const QUOTE_STATUSES = [
  'draft',
  'sent',
  'approved',
  'rejected',
  'expired',
  'converted',
  'cancelled',
] as const

export const ORDER_STATUSES = [
  'open',
  'confirmed',
  'invoiced',
  'completed',
  'cancelled',
] as const

export const quoteStatusSchema = z.enum(QUOTE_STATUSES, {
  error: 'Informe um status de orçamento válido',
})

export const orderStatusSchema = z.enum(ORDER_STATUSES, {
  error: 'Informe um status de pedido válido',
})

export type QuoteStatus = z.output<typeof quoteStatusSchema>
export type OrderStatus = z.output<typeof orderStatusSchema>
