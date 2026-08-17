import { z } from 'zod'
import { cepSchema, cnpjSchema, phoneSchema } from '@/domain/primitives/brazilian'
import { uuidSchema } from '@/domain/primitives/uuid'
import {
  createListRequestSchema,
  cursorSchema,
} from '@/lib/server/request.schema'

const requiredNameSchema = z
  .string()
  .trim()
  .min(1, 'Informe o nome da transportadora')
  .max(160, 'O nome da transportadora deve ter no máximo 160 caracteres')

const optionalTextSchema = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} não pode ficar vazio`)
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres`)

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Informe um e-mail válido'))

const stateSchema = z
  .string()
  .trim()
  .length(2, 'Informe a UF com duas letras')
  .regex(/^[A-Za-z]{2}$/, 'Informe uma UF válida')
  .transform((value) => value.toUpperCase())

const carrierProfileInputShape = {
  name: requiredNameSchema,
  taxId: cnpjSchema.optional(),
  contactName: optionalTextSchema('O nome do contato', 120).optional(),
  email: emailSchema.optional(),
  phone: phoneSchema.optional(),
  streetAddress: optionalTextSchema('O endereço', 240).optional(),
  postalCode: cepSchema.optional(),
  city: optionalTextSchema('A cidade', 120).optional(),
  state: stateSchema.optional(),
  notes: optionalTextSchema('As observações', 2_000).optional(),
} satisfies z.ZodRawShape

const nullableCarrierProfileShape = {
  name: requiredNameSchema,
  taxId: cnpjSchema.nullable(),
  contactName: optionalTextSchema('O nome do contato', 120).nullable(),
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  streetAddress: optionalTextSchema('O endereço', 240).nullable(),
  postalCode: cepSchema.nullable(),
  city: optionalTextSchema('A cidade', 120).nullable(),
  state: stateSchema.nullable(),
  notes: optionalTextSchema('As observações', 2_000).nullable(),
} satisfies z.ZodRawShape

export const carrierCreateInputSchema = z.strictObject(carrierProfileInputShape)

/** Omitted update fields are unchanged; null explicitly clears optional data. */
export const carrierUpdateInputSchema = z
  .strictObject({
    id: uuidSchema,
    name: requiredNameSchema.optional(),
    taxId: cnpjSchema.nullable().optional(),
    contactName: optionalTextSchema('O nome do contato', 120).nullable().optional(),
    email: emailSchema.nullable().optional(),
    phone: phoneSchema.nullable().optional(),
    streetAddress: optionalTextSchema('O endereço', 240).nullable().optional(),
    postalCode: cepSchema.nullable().optional(),
    city: optionalTextSchema('A cidade', 120).nullable().optional(),
    state: stateSchema.nullable().optional(),
    notes: optionalTextSchema('As observações', 2_000).nullable().optional(),
  })
  .superRefine((update, context) => {
    if (Object.keys(update).every((field) => field === 'id')) {
      context.addIssue({
        code: 'custom',
        message: 'Informe ao menos um campo para atualizar',
      })
    }
  })

export const carrierDetailSchema = z
  .strictObject({
    id: uuidSchema,
    ...nullableCarrierProfileShape,
    createdAt: z.iso.datetime(),
    createdByUserId: uuidSchema,
    updatedAt: z.iso.datetime(),
    updatedByUserId: uuidSchema,
    archivedAt: z.iso.datetime().nullable(),
    archivedByUserId: uuidSchema.nullable(),
  })
  .superRefine((carrier, context) => {
    if ((carrier.archivedAt === null) !== (carrier.archivedByUserId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['archivedAt'],
        message: 'Data e responsável pelo arquivamento devem ser informados juntos',
      })
    }
  })

export const carrierDetailInputSchema = z.strictObject({ id: uuidSchema })
export const carrierArchiveInputSchema = carrierDetailInputSchema

export const carrierArchiveStateSchema = z.enum(['active', 'archived', 'all'])

const carrierListRequestBaseSchema = createListRequestSchema({
  filters: {
    search: z
      .string()
      .trim()
      .min(1, 'Informe um termo de busca')
      .max(120, 'A busca deve ter no máximo 120 caracteres'),
    archiveState: carrierArchiveStateSchema,
  },
  sortFields: ['name', 'createdAt', 'updatedAt'] as const,
  defaultSort: 'name',
})

export const carrierListInputSchema = carrierListRequestBaseSchema.transform(
  (request) => ({
    ...request,
    // Active-only is the safe selector default; historical reads opt in.
    filters: { archiveState: 'active' as const, ...request.filters },
  }),
)

export const carrierListItemSchema = z.strictObject({
  id: uuidSchema,
  name: requiredNameSchema,
  taxId: cnpjSchema.nullable(),
  email: emailSchema.nullable(),
  phone: phoneSchema.nullable(),
  city: optionalTextSchema('A cidade', 120).nullable(),
  state: stateSchema.nullable(),
  updatedAt: z.iso.datetime(),
  archivedAt: z.iso.datetime().nullable(),
})

export const carrierListOutputSchema = z.strictObject({
  items: z.array(carrierListItemSchema),
  nextCursor: cursorSchema.nullable(),
})

export const carrierCreateOutputSchema = carrierDetailSchema
export const carrierUpdateOutputSchema = carrierDetailSchema
export const carrierDetailOutputSchema = carrierDetailSchema
export const carrierArchiveOutputSchema = carrierDetailSchema

export type CarrierCreateInput = z.input<typeof carrierCreateInputSchema>
export type CarrierCreate = z.output<typeof carrierCreateInputSchema>
export type CarrierCreateOutput = z.output<typeof carrierCreateOutputSchema>
export type CarrierUpdateInput = z.input<typeof carrierUpdateInputSchema>
export type CarrierUpdate = z.output<typeof carrierUpdateInputSchema>
export type CarrierUpdateOutput = z.output<typeof carrierUpdateOutputSchema>
export type CarrierDetail = z.output<typeof carrierDetailSchema>
export type CarrierDetailInput = z.input<typeof carrierDetailInputSchema>
export type CarrierDetailOutput = z.output<typeof carrierDetailOutputSchema>
export type CarrierArchiveState = z.output<typeof carrierArchiveStateSchema>
export type CarrierListInput = z.input<typeof carrierListInputSchema>
export type CarrierListQuery = Omit<
  z.output<typeof carrierListInputSchema>,
  'filters'
> &
  Readonly<{
    filters: Readonly<{
      archiveState: CarrierArchiveState
      search?: string
    }>
  }>
export type CarrierListItem = z.output<typeof carrierListItemSchema>
export type CarrierListOutput = z.output<typeof carrierListOutputSchema>
export type CarrierArchiveInput = z.input<typeof carrierArchiveInputSchema>
export type CarrierArchiveOutput = z.output<typeof carrierArchiveOutputSchema>
