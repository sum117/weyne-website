import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { ErrorSummary, FormTextField, getValidationMessages, type FormErrorSummaryItem } from '@/components/forms/form-field'
import { ComboboxInput } from '@/components/forms/form-inputs'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field'
import type { ProductFields } from './catalog.service.server'

export type ProductFormMode = 'create' | 'edit'

export type ProductFormValues = {
  [Key in keyof ProductFields]: string
}

export type ProductSelectorOption = Readonly<{
  value: string
  label: string
  archived?: boolean
}>

export interface ProductFormProps {
  mode: ProductFormMode
  /**
   * Capability-driven visibility (card `t_d3e33344`): the caller derives this
   * from the centralized matrix (`product.update_operational`), never from a
   * raw role comparison. UX only — the server re-checks every mutation.
   */
  canMutate: boolean
  archived?: boolean
  industryOptions: readonly ProductSelectorOption[]
  categoryOptions: readonly string[]
  brandOptions: readonly string[]
  initialValues?: Partial<{ [Key in keyof ProductFields]: string | null }>
  onSubmit: (values: ProductFields) => void | Promise<void>
  serverError?: string | null
}

const decimalPattern = /^\d{1,12}(?:\.\d{1,6})?$/
const percentagePattern = /^\d{1,3}(?:\.\d{1,6})?$/

function optionalString(maximum: number) {
  return z.string().trim().max(maximum, `Use no máximo ${maximum} caracteres`)
}

function exactDecimal(label: string) {
  return z.string().superRefine((value, context) => {
    if (value === '' || decimalPattern.test(value)) return
    context.addIssue({
      code: 'custom',
      message: /^\d{1,12}\.\d{7,}$/.test(value)
        ? 'Use até 6 casas decimais'
        : `${label}: use um decimal não negativo com ponto como separador`,
    })
  })
}

function isPercentageAtMostOneHundred(value: string) {
  const [rawInteger, fraction = ''] = value.split('.')
  const integer = rawInteger!.replace(/^0+(?=\d)/, '')
  return integer.length < 3 || (integer === '100' && !/[1-9]/.test(fraction))
}

function exactPercentage() {
  return z.string()
    .refine((value) => value === '' || percentagePattern.test(value), 'Use um percentual decimal com até 6 casas')
    .refine((value) => value === '' || isPercentageAtMostOneHundred(value), 'Use um percentual entre 0 e 100')
}

export const productFormSchema = z.object({
  industryId: z.string().uuid('Selecione uma indústria'),
  internalCode: z.string().trim().min(1, 'Informe o código interno').max(100, 'Use no máximo 100 caracteres'),
  manufacturerCode: optionalString(100),
  description: z.string().trim().min(1, 'Informe a descrição').max(500, 'Use no máximo 500 caracteres'),
  brand: optionalString(500),
  category: optionalString(500),
  ncm: optionalString(100),
  cest: optionalString(100),
  ean: optionalString(100),
  dun: optionalString(100),
  packaging: optionalString(500),
  unit: z.string().trim().min(1, 'Informe a unidade').max(30, 'Use no máximo 30 caracteres'),
  netWeight: exactDecimal('Peso líquido'),
  grossWeight: exactDecimal('Peso bruto'),
  width: exactDecimal('Largura'),
  height: exactDecimal('Altura'),
  depth: exactDecimal('Profundidade'),
  dimensionUnit: optionalString(500),
  ipiRate: exactPercentage(),
  icmsRate: exactPercentage(),
  pisRate: exactPercentage(),
  cofinsRate: exactPercentage(),
  commissionOverride: exactPercentage(),
}).superRefine((value, context) => {
  if ((value.width || value.height || value.depth) && !value.dimensionUnit.trim()) {
    context.addIssue({ code: 'custom', path: ['dimensionUnit'], message: 'Informe a unidade das dimensões' })
  }
})

const emptyValues: ProductFormValues = {
  industryId: '',
  internalCode: '',
  manufacturerCode: '',
  description: '',
  brand: '',
  category: '',
  ncm: '',
  cest: '',
  ean: '',
  dun: '',
  packaging: '',
  unit: '',
  netWeight: '',
  grossWeight: '',
  width: '',
  height: '',
  depth: '',
  dimensionUnit: '',
  ipiRate: '',
  icmsRate: '',
  pisRate: '',
  cofinsRate: '',
  commissionOverride: '',
}

const fieldLabels: Record<keyof ProductFormValues, string> = {
  industryId: 'Indústria',
  internalCode: 'Código interno',
  manufacturerCode: 'Código do fabricante',
  description: 'Descrição',
  brand: 'Marca',
  category: 'Categoria',
  ncm: 'NCM',
  cest: 'CEST',
  ean: 'EAN',
  dun: 'DUN',
  packaging: 'Embalagem',
  unit: 'Unidade',
  netWeight: 'Peso líquido',
  grossWeight: 'Peso bruto',
  width: 'Largura',
  height: 'Altura',
  depth: 'Profundidade',
  dimensionUnit: 'Unidade das dimensões',
  ipiRate: 'IPI',
  icmsRate: 'ICMS',
  pisRate: 'PIS',
  cofinsRate: 'COFINS',
  commissionOverride: 'Comissão própria',
}

function formDefaults(initialValues: ProductFormProps['initialValues']): ProductFormValues {
  return Object.fromEntries(
    Object.entries(emptyValues).map(([key, fallback]) => [key, initialValues?.[key as keyof ProductFields] ?? fallback]),
  ) as ProductFormValues
}

function nullable(value: string) {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function toProductFields(values: ProductFormValues): ProductFields {
  return {
    industryId: values.industryId,
    internalCode: values.internalCode.trim(),
    manufacturerCode: nullable(values.manufacturerCode),
    description: values.description.trim(),
    brand: nullable(values.brand),
    category: nullable(values.category),
    ncm: nullable(values.ncm),
    cest: nullable(values.cest),
    ean: nullable(values.ean),
    dun: nullable(values.dun),
    packaging: nullable(values.packaging),
    unit: values.unit.trim(),
    netWeight: nullable(values.netWeight),
    grossWeight: nullable(values.grossWeight),
    width: nullable(values.width),
    height: nullable(values.height),
    depth: nullable(values.depth),
    dimensionUnit: nullable(values.dimensionUnit),
    ipiRate: nullable(values.ipiRate),
    icmsRate: nullable(values.icmsRate),
    pisRate: nullable(values.pisRate),
    cofinsRate: nullable(values.cofinsRate),
    commissionOverride: nullable(values.commissionOverride),
  }
}

function buildSummary(fieldMeta: Record<string, { errors?: unknown[] } | undefined>, prefix: string) {
  return Object.entries(fieldLabels).flatMap(([field, label]) => {
    const message = getValidationMessages(fieldMeta[field]?.errors ?? [])[0]
    return message ? [{ fieldId: `${prefix}-${field}`, label, message }] : []
  }) satisfies FormErrorSummaryItem[]
}

type ProductFieldProps = {
  id: string
  label: string
  description?: string
  errors: unknown[]
  children: (relationships: { describedBy: string | undefined; hasError: boolean }) => React.ReactNode
}

function ProductField({ id, label, description, errors, children }: ProductFieldProps) {
  const messages = getValidationMessages(errors)
  const descriptionId = description ? `${id}-description` : undefined
  const errorId = messages.length ? `${id}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-ink">{label}</FieldLabel>
      {description ? <FieldDescription id={descriptionId}>{description}</FieldDescription> : null}
      {children({ describedBy, hasError: messages.length > 0 })}
      <FieldError id={errorId}>{messages.join(' ')}</FieldError>
    </Field>
  )
}

export function ProductForm({
  mode,
  canMutate: mayManage,
  archived = false,
  industryOptions,
  categoryOptions,
  brandOptions,
  initialValues,
  onSubmit,
  serverError = null,
}: ProductFormProps) {
  const idPrefix = `product-${React.useId()}`
  const canMutate = mayManage && !archived
  const form = useForm({
    defaultValues: formDefaults(initialValues),
    validators: { onBlur: productFormSchema, onSubmit: productFormSchema },
    onSubmit: async ({ value }) => {
      if (!canMutate) return
      await onSubmit(toProductFields(value))
    },
  })

  if (!mayManage) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertTitle>Acesso somente para leitura</AlertTitle>
        <AlertDescription>Você não tem permissão para editar produtos.</AlertDescription>
      </Alert>
    )
  }

  if (archived) {
    return (
      <Alert role="alert">
        <AlertTitle>Produto arquivado</AlertTitle>
        <AlertDescription>Restaure o produto antes de alterar seus dados.</AlertDescription>
      </Alert>
    )
  }

  const visibleIndustries = industryOptions.filter((option) =>
    !option.archived || (mode === 'edit' && option.value === initialValues?.industryId),
  )
  const formName = mode === 'create' ? 'Criar produto' : 'Editar produto'
  const submitLabel = mode === 'create' ? 'Criar produto' : 'Salvar alterações'

  return (
    <form
      aria-label={formName}
      className="grid max-w-[60rem] gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (canMutate) void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.fieldMeta}>
        {(fieldMeta) => <ErrorSummary errors={buildSummary(fieldMeta, idPrefix)} />}
      </form.Subscribe>

      {serverError ? (
        <Alert variant="destructive" role="alert">
          <AlertTitle>Não foi possível salvar o produto</AlertTitle>
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Identificação</CardTitle>
          <CardDescription>Dados mínimos para localizar e reconhecer o produto.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2">
          <form.Field name="industryId">
            {(field) => {
              const id = `${idPrefix}-${field.name}`
              return (
                <ProductField id={id} label="Indústria (obrigatório)" errors={field.state.meta.errors}>
                  {({ describedBy, hasError }) => (
                    <select
                      id={id}
                      name={field.name}
                      className="h-11 w-full rounded-md border border-border bg-white px-3 text-sm text-ink focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:outline-none"
                      value={field.state.value}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      onBlur={field.handleBlur}
                      aria-invalid={hasError}
                      aria-describedby={describedBy}
                    >
                      <option value="">Selecione uma indústria</option>
                      {visibleIndustries.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}{option.archived ? ' (arquivada)' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </ProductField>
              )
            }}
          </form.Field>
          <form.Field name="internalCode">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Código interno (obrigatório)" />}
          </form.Field>
          <form.Field name="manufacturerCode">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Código do fabricante (opcional)" />}
          </form.Field>
          <form.Field name="unit">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Unidade (obrigatório)" placeholder="Ex.: UN, CX, KG" />}
          </form.Field>
          <form.Field name="description">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Descrição (obrigatório)" className="sm:col-span-2" />}
          </form.Field>
          <form.Field name="category">
            {(field) => {
              const id = `${idPrefix}-${field.name}`
              return (
                <ProductField id={id} label="Categoria (opcional)" description="Digite ou escolha uma categoria existente." errors={field.state.meta.errors}>
                  {({ describedBy, hasError }) => (
                    <ComboboxInput id={id} name={field.name} value={field.state.value} onValueChange={field.handleChange} onBlur={field.handleBlur} options={categoryOptions.map((label) => ({ value: label, label }))} aria-invalid={hasError} aria-describedby={describedBy} />
                  )}
                </ProductField>
              )
            }}
          </form.Field>
          <form.Field name="brand">
            {(field) => {
              const id = `${idPrefix}-${field.name}`
              return (
                <ProductField id={id} label="Marca (opcional)" description="Digite ou escolha uma marca existente." errors={field.state.meta.errors}>
                  {({ describedBy, hasError }) => (
                    <ComboboxInput id={id} name={field.name} value={field.state.value} onValueChange={field.handleChange} onBlur={field.handleBlur} options={brandOptions.map((label) => ({ value: label, label }))} aria-invalid={hasError} aria-describedby={describedBy} />
                  )}
                </ProductField>
              )
            }}
          </form.Field>
          <form.Field name="packaging">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Embalagem (opcional)" />}
          </form.Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Identificadores fiscais e logísticos</CardTitle></CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          {(['ncm', 'cest', 'ean', 'dun'] as const).map((name) => (
            <form.Field key={name} name={name}>
              {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label={`${fieldLabels[name]} (opcional)`} inputMode="numeric" />}
            </form.Field>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pesos e dimensões</CardTitle>
          <CardDescription>Decimais exatos com ponto e até 6 casas; valores vazios permanecem nulos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {(['netWeight', 'grossWeight', 'width', 'height', 'depth'] as const).map((name) => (
            <form.Field key={name} name={name}>
              {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label={`${fieldLabels[name]} (opcional)`} inputMode="decimal" className="font-mono tabular-nums" />}
            </form.Field>
          ))}
          <form.Field name="dimensionUnit">
            {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label="Unidade das dimensões (obrigatória quando houver dimensões)" placeholder="Ex.: cm" />}
          </form.Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tributos e comissão</CardTitle>
          <CardDescription>Percentuais exatos de 0 a 100. Comissão vazia usa o padrão da indústria.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 sm:grid-cols-2 lg:grid-cols-5">
          {(['ipiRate', 'icmsRate', 'pisRate', 'cofinsRate', 'commissionOverride'] as const).map((name) => (
            <form.Field key={name} name={name}>
              {(field) => <FormTextField field={field} id={`${idPrefix}-${field.name}`} label={`${fieldLabels[name]} (opcional)`} inputMode="decimal" className="font-mono tabular-nums" />}
            </form.Field>
          ))}
        </CardContent>
      </Card>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild type="button" variant="secondary" className="w-full sm:w-auto">
          <a href="/app/produtos">Cancelar</a>
        </Button>
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(isSubmitting) => (
            <Button type="submit" className="w-full sm:w-auto" disabled={isSubmitting} aria-busy={isSubmitting}>
              {isSubmitting ? 'Salvando…' : submitLabel}
            </Button>
          )}
        </form.Subscribe>
      </div>
    </form>
  )
}
