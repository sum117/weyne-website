import { z } from 'zod'
import { cepSchema, cnpjSchema, phoneSchema } from '@/domain/primitives/brazilian'
import { uuidSchema } from '@/domain/primitives/uuid'

const trimmedText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} é obrigatório`)
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres`)

const optionalTrimmedText = (label: string, maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum, `${label} deve ter no máximo ${maximum} caracteres`)
    .transform((value) => value || null)
    .nullable()

const nullableEmptyString = <Schema extends z.ZodType>(schema: Schema) =>
  z.preprocess(
    (value) =>
      typeof value === 'string' && value.trim() === '' ? null : value,
    schema.nullable(),
  )

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254, 'O e-mail deve ter no máximo 254 caracteres')
  .email('Informe um e-mail válido')

const stateSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{2}$/, 'Informe uma UF válida'))

export const businessAddressSchema = z.strictObject({
  street: trimmedText('O logradouro', 160),
  number: trimmedText('O número', 30),
  complement: optionalTrimmedText('O complemento', 80),
  district: trimmedText('O bairro', 80),
  city: trimmedText('A cidade', 120),
  state: stateSchema,
  postalCode: cepSchema,
  countryCode: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('BR')),
})

export const numberingDisplayPolicySchema = z.strictObject({
  quotePrefix: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('ORC')),
  orderPrefix: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .pipe(z.literal('PED')),
  separator: z.literal('-'),
  yearDigits: z.literal(4),
  sequenceDigits: z.literal(6),
})

export const DEFAULT_NUMBERING_DISPLAY_POLICY = {
  quotePrefix: 'ORC',
  orderPrefix: 'PED',
  separator: '-',
  yearDigits: 4,
  sequenceDigits: 6,
} as const

export const DEFAULT_PRICE_LIST_LABELS = [
  'Preço 1',
  'Preço 2',
  'Preço 3',
  'Preço 4',
] as const

const businessProfileSchema = z
  .strictObject({
    displayName: trimmedText('O nome de exibição', 120),
    legalName: trimmedText('A razão social', 160),
    taxId: nullableEmptyString(cnpjSchema),
    email: nullableEmptyString(emailSchema),
    phone: nullableEmptyString(phoneSchema),
    address: businessAddressSchema.nullable(),
  })
  .superRefine((business, context) => {
    if (business.email === null && business.phone === null) {
      context.addIssue({
        code: 'custom',
        message: 'Informe ao menos um e-mail ou telefone',
        path: ['email'],
      })
    }
  })

const priceListLabelsSchema = z
  .tuple([
    trimmedText('O rótulo da lista PRICE_1', 60),
    trimmedText('O rótulo da lista PRICE_2', 60),
    trimmedText('O rótulo da lista PRICE_3', 60),
    trimmedText('O rótulo da lista PRICE_4', 60),
  ])
  .superRefine((labels, context) => {
    const normalized = labels.map((label) => label.toLocaleLowerCase('pt-BR'))
    if (new Set(normalized).size !== labels.length) {
      context.addIssue({
        code: 'custom',
        message: 'Os quatro rótulos de tabela de preço devem ser únicos',
      })
    }
  })

export const businessSettingsSchema = z.strictObject({
  business: businessProfileSchema,
  documents: z.strictObject({
    logoAssetId: uuidSchema.nullable().default(null),
    defaultQuoteValidityDays: z
      .number()
      .int('A validade deve ser um número inteiro de dias')
      .min(1, 'A validade deve ser de pelo menos 1 dia')
      .max(365, 'A validade deve ser de no máximo 365 dias')
      .default(15),
    defaultPaymentTerms: optionalTrimmedText(
      'As condições de pagamento',
      1_000,
    ).default(null),
    defaultFreightTerms: optionalTrimmedText(
      'As condições de frete',
      1_000,
    ).default(null),
    numberingDisplay: numberingDisplayPolicySchema.default(
      DEFAULT_NUMBERING_DISPLAY_POLICY,
    ),
    priceListLabels: priceListLabelsSchema.default([...DEFAULT_PRICE_LIST_LABELS]),
    pdfFooterText: optionalTrimmedText('O rodapé do PDF', 500).default(null),
    pdfSignatureText: optionalTrimmedText(
      'A assinatura visual do PDF',
      300,
    ).default(null),
  }),
})

const positiveVersionSchema = z
  .number()
  .int('A versão deve ser um número inteiro')
  .positive('A versão deve ser positiva')

export const settingsRecordSchema = z.strictObject({
  settings: businessSettingsSchema,
  version: positiveVersionSchema,
  updatedAt: z.iso.datetime(),
  updatedByUserId: uuidSchema,
})

export const settingsUpdateInputSchema = z.strictObject({
  expectedVersion: positiveVersionSchema,
  settings: businessSettingsSchema,
})

export const issuedDocumentSettingsSnapshotSchema = z.strictObject({
  business: businessProfileSchema,
  logoAssetId: uuidSchema.nullable(),
  paymentTerms: optionalTrimmedText('As condições de pagamento', 1_000),
  freightTerms: optionalTrimmedText('As condições de frete', 1_000),
  priceList: z.strictObject({
    key: z.enum(['PRICE_1', 'PRICE_2', 'PRICE_3', 'PRICE_4']),
    label: trimmedText('O rótulo da tabela de preço', 60),
  }),
  pdfFooterText: optionalTrimmedText('O rodapé do PDF', 500),
  pdfSignatureText: optionalTrimmedText('A assinatura visual do PDF', 300),
})

export const ISSUED_DOCUMENT_SETTINGS_SNAPSHOT_FIELDS = [
  'business',
  'logoAssetId',
  'paymentTerms',
  'freightTerms',
  'priceList',
  'pdfFooterText',
  'pdfSignatureText',
] as const

export type BusinessSettingsInput = z.input<typeof businessSettingsSchema>
export type BusinessSettings = z.output<typeof businessSettingsSchema>
export type SettingsRecord = z.output<typeof settingsRecordSchema>
export type SettingsUpdateInput = z.input<typeof settingsUpdateInputSchema>
export type IssuedDocumentSettingsSnapshot = z.output<
  typeof issuedDocumentSettingsSnapshotSchema
>
