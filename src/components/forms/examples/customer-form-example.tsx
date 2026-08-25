import * as React from 'react'
import { useForm } from '@tanstack/react-form'
import { isCNPJ } from 'brazilian-values'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import {
  ErrorSummary,
  FormTextField,
  getValidationMessages,
  type FormErrorSummaryItem,
} from '../form-field'
import {
  BrazilianMaskedInput,
  ComboboxInput,
  CurrencyInput,
  DateInput,
  PercentInput,
} from '../form-inputs'

export const customerFormExampleSchema = z.object({
  legalName: z.string().trim().min(1, 'Informe a razão social'),
  taxId: z
    .string()
    .refine((value) => !value || isCNPJ(value), 'Informe um CNPJ válido'),
  city: z.string().min(1, 'Selecione a cidade'),
  validUntil: z.iso.date('Informe uma data válida'),
  creditLimit: z.number().nonnegative('Use um valor positivo').nullable(),
  commissionRate: z
    .number()
    .min(0, 'Use um percentual entre 0 e 100')
    .max(100, 'Use um percentual entre 0 e 100')
    .nullable(),
})

export type CustomerFormExampleValues = z.infer<
  typeof customerFormExampleSchema
>

const defaultValues: CustomerFormExampleValues = {
  legalName: '',
  taxId: '',
  city: '',
  validUntil: '',
  creditLimit: null,
  commissionRate: null,
}

const cityOptions = [
  { value: 'fortaleza', label: 'Fortaleza' },
  { value: 'recife', label: 'Recife' },
  { value: 'salvador', label: 'Salvador' },
] as const

interface ExampleFieldProps {
  id: string
  label: string
  description: string
  errors: unknown[]
  children: (relationships: {
    descriptionId: string
    errorId: string | undefined
    hasError: boolean
  }) => React.ReactNode
}

function ExampleField({
  id,
  label,
  description,
  errors,
  children,
}: ExampleFieldProps) {
  const messages = getValidationMessages(errors)
  const descriptionId = `${id}-description`
  const errorId = messages.length ? `${id}-error` : undefined
  return (
    <Field>
      <FieldLabel htmlFor={id} className="text-ink">
        {label}
      </FieldLabel>
      <FieldDescription id={descriptionId} className="text-muted">
        {description}
      </FieldDescription>
      {children({
        descriptionId,
        errorId,
        hasError: messages.length > 0,
      })}
      <FieldError id={errorId} className="text-destructive">
        {messages.join(' ')}
      </FieldError>
    </Field>
  )
}

const summaryLabels: Record<keyof CustomerFormExampleValues, string> = {
  legalName: 'Razão social',
  taxId: 'CNPJ',
  city: 'Cidade',
  validUntil: 'Validade',
  creditLimit: 'Limite de crédito',
  commissionRate: 'Comissão',
}

function buildSummary(
  fieldMeta: Record<string, { errors?: unknown[] } | undefined>,
  idPrefix: string,
) {
  return Object.entries(summaryLabels).flatMap(([fieldId, label]) => {
    const message = getValidationMessages(fieldMeta[fieldId]?.errors ?? [])[0]
    return message ? [{ fieldId: `${idPrefix}-${fieldId}`, label, message }] : []
  }) satisfies FormErrorSummaryItem[]
}

export interface CustomerFormExampleProps {
  onSubmit: (values: CustomerFormExampleValues) => void | Promise<void>
}

/**
 * Copyable integration example. It imports shared form/UI modules only and keeps
 * the Zod schema as the source of inferred domain values.
 */
export function CustomerFormExample({ onSubmit }: CustomerFormExampleProps) {
  const idPrefix = `customer-${React.useId()}`
  const form = useForm({
    defaultValues,
    validators: {
      onBlur: customerFormExampleSchema,
      onSubmit: customerFormExampleSchema,
    },
    onSubmit: ({ value }) => onSubmit(value),
  })

  return (
    <form
      aria-label="Cadastro de cliente"
      className="grid gap-5"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Subscribe selector={(state) => state.fieldMeta}>
        {(fieldMeta) => (
          <ErrorSummary errors={buildSummary(fieldMeta, idPrefix)} />
        )}
      </form.Subscribe>

      <form.Field name="legalName">
        {(field) => (
          <FormTextField
            field={field}
            id={`${idPrefix}-${field.name}`}
            label="Razão social"
            description="Nome empresarial registrado."
            autoComplete="organization"
          />
        )}
      </form.Field>

      <form.Field name="taxId">
        {(field) => (
          <ExampleField
            id={`${idPrefix}-${field.name}`}
            label="CNPJ"
            description="Somente os 14 caracteres do domínio são armazenados."
            errors={field.state.meta.errors}
          >
            {({ descriptionId, errorId, hasError }) => (
              <BrazilianMaskedInput
                id={`${idPrefix}-${field.name}`}
                name={field.name}
                mask="cnpj"
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                aria-invalid={hasError}
                aria-describedby={[descriptionId, errorId]
                  .filter(Boolean)
                  .join(' ')}
              />
            )}
          </ExampleField>
        )}
      </form.Field>

      <form.Field name="city">
        {(field) => (
          <ExampleField
            id={`${idPrefix}-${field.name}`}
            label="Cidade"
            description="Digite ou escolha uma opção da lista."
            errors={field.state.meta.errors}
          >
            {({ descriptionId, errorId, hasError }) => (
              <ComboboxInput
                id={`${idPrefix}-${field.name}`}
                name={field.name}
                value={field.state.value}
                onValueChange={field.handleChange}
                onBlur={field.handleBlur}
                options={cityOptions}
                aria-invalid={hasError}
                aria-describedby={[descriptionId, errorId]
                  .filter(Boolean)
                  .join(' ')}
              />
            )}
          </ExampleField>
        )}
      </form.Field>

      <div className="grid gap-5 sm:grid-cols-3">
        <form.Field name="validUntil">
          {(field) => (
            <ExampleField
              id={`${idPrefix}-${field.name}`}
              label="Validade"
              description="Data civil no formato ISO no domínio."
              errors={field.state.meta.errors}
            >
              {({ descriptionId, errorId, hasError }) => (
                <DateInput
                  id={`${idPrefix}-${field.name}`}
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                  aria-invalid={hasError}
                  aria-describedby={[descriptionId, errorId]
                    .filter(Boolean)
                    .join(' ')}
                />
              )}
            </ExampleField>
          )}
        </form.Field>

        <form.Field name="creditLimit">
          {(field) => (
            <ExampleField
              id={`${idPrefix}-${field.name}`}
              label="Limite de crédito"
              description="Valor decimal; vazio permanece nulo."
              errors={field.state.meta.errors}
            >
              {({ descriptionId, errorId, hasError }) => (
                <CurrencyInput
                  id={`${idPrefix}-${field.name}`}
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                  aria-invalid={hasError}
                  aria-describedby={[descriptionId, errorId]
                    .filter(Boolean)
                    .join(' ')}
                />
              )}
            </ExampleField>
          )}
        </form.Field>

        <form.Field name="commissionRate">
          {(field) => (
            <ExampleField
              id={`${idPrefix}-${field.name}`}
              label="Comissão"
              description="Percentual de 0 a 100; vazio permanece nulo."
              errors={field.state.meta.errors}
            >
              {({ descriptionId, errorId, hasError }) => (
                <PercentInput
                  id={`${idPrefix}-${field.name}`}
                  name={field.name}
                  value={field.state.value}
                  onValueChange={field.handleChange}
                  onBlur={field.handleBlur}
                  aria-invalid={hasError}
                  aria-describedby={[descriptionId, errorId]
                    .filter(Boolean)
                    .join(' ')}
                />
              )}
            </ExampleField>
          )}
        </form.Field>
      </div>

      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(isSubmitting) => (
          <Button type="submit" disabled={isSubmitting} aria-busy={isSubmitting}>
            {isSubmitting ? 'Salvando…' : 'Salvar cliente'}
          </Button>
        )}
      </form.Subscribe>
    </form>
  )
}
