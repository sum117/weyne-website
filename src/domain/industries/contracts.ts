import { z } from 'zod'
import { cnpjSchema } from '@/domain/primitives/brazilian'
import { percentageSchema } from '@/domain/primitives/decimal'
import { uuidSchema } from '@/domain/primitives/uuid'
import { businessAddressSchema } from '@/domain/settings/business-settings'
import { createListRequestSchema } from '@/lib/server/request.schema'

const requiredText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} é obrigatório`)
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres`)

const optionalText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} não pode ficar vazio`)
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres`)

export const industryAddressSchema = businessAddressSchema

const industryProfileShape = {
  legalName: requiredText('A razão social', 160),
  tradeName: requiredText('O nome fantasia', 160),
  cnpj: cnpjSchema,
  address: industryAddressSchema,
  defaultCommissionPercentage: percentageSchema,
  notes: optionalText('As observações', 2_000).optional(),
} satisfies z.ZodRawShape

export const industryCreateInputSchema = z.strictObject(industryProfileShape)

export const industryUpdateInputSchema = z
  .strictObject({
    id: uuidSchema,
    legalName: industryProfileShape.legalName.optional(),
    tradeName: industryProfileShape.tradeName.optional(),
    cnpj: industryProfileShape.cnpj.optional(),
    address: industryProfileShape.address.optional(),
    defaultCommissionPercentage:
      industryProfileShape.defaultCommissionPercentage.optional(),
    notes: optionalText('As observações', 2_000).nullable().optional(),
  })
  .superRefine((update, context) => {
    if (Object.keys(update).every((field) => field === 'id')) {
      context.addIssue({
        code: 'custom',
        message: 'Informe ao menos um campo para atualizar',
      })
    }
  })

export const industryDetailSchema = z
  .strictObject({
    id: uuidSchema,
    legalName: industryProfileShape.legalName,
    tradeName: industryProfileShape.tradeName,
    cnpj: industryProfileShape.cnpj,
    address: industryAddressSchema,
    defaultCommissionPercentage: percentageSchema,
    notes: optionalText('As observações', 2_000).nullable(),
    createdAt: z.iso.datetime(),
    createdByUserId: uuidSchema,
    updatedAt: z.iso.datetime(),
    updatedByUserId: uuidSchema,
    archivedAt: z.iso.datetime().nullable(),
    archivedByUserId: uuidSchema.nullable(),
  })
  .superRefine((industry, context) => {
    if ((industry.archivedAt === null) !== (industry.archivedByUserId === null)) {
      context.addIssue({
        code: 'custom',
        path: ['archivedAt'],
        message: 'Data e responsável pelo arquivamento devem ser informados juntos',
      })
    }
  })

export const industryDetailInputSchema = z.strictObject({ id: uuidSchema })
export const industryArchiveInputSchema = industryDetailInputSchema

export const industryArchiveStateSchema = z.enum(['active', 'archived', 'all'])

const industryListRequestBaseSchema = createListRequestSchema({
  filters: {
    search: z
      .string()
      .trim()
      .min(1, 'Informe um termo de busca')
      .max(160, 'A busca deve ter no máximo 160 caracteres'),
    archiveState: industryArchiveStateSchema,
  },
  sortFields: ['legalName', 'tradeName', 'cnpj', 'createdAt', 'updatedAt'] as const,
  defaultSort: 'legalName',
})

export const industryListInputSchema = industryListRequestBaseSchema.transform(
  (request) => ({
    ...request,
    filters: { archiveState: 'active' as const, ...request.filters },
  }),
)

export type IndustryAddress = z.output<typeof industryAddressSchema>
export type IndustryCreateInput = z.input<typeof industryCreateInputSchema>
export type IndustryCreate = z.output<typeof industryCreateInputSchema>
export type IndustryUpdateInput = z.input<typeof industryUpdateInputSchema>
export type IndustryUpdate = z.output<typeof industryUpdateInputSchema>
export type IndustryDetail = z.output<typeof industryDetailSchema>
export type IndustryDetailInput = z.input<typeof industryDetailInputSchema>
export type IndustryArchiveInput = z.input<typeof industryArchiveInputSchema>
export type IndustryArchiveState = z.output<typeof industryArchiveStateSchema>
export type IndustryListInput = z.input<typeof industryListInputSchema>
export type IndustryListQuery = Omit<
  z.output<typeof industryListInputSchema>,
  'filters'
> &
  Readonly<{
    filters: Readonly<{
      archiveState: IndustryArchiveState
      search?: string
    }>
  }>
