import * as React from 'react'
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/cn'

export interface FormFieldLike<TValue> {
  name: string
  state: {
    value: TValue
    meta: {
      errors: unknown[]
      isTouched: boolean
    }
  }
  handleBlur: () => void
  handleChange: (value: TValue) => void
}

interface ValidationMessageValue {
  message?: unknown
}

export function getValidationMessages(errors: unknown[]) {
  const messages = errors.flatMap((error) => {
    if (typeof error === 'string') return [error]
    if (
      error &&
      typeof error === 'object' &&
      'message' in error &&
      typeof (error as ValidationMessageValue).message === 'string'
    ) {
      return [(error as ValidationMessageValue).message as string]
    }
    return []
  })
  return [...new Set(messages)]
}

export interface FormTextFieldProps
  extends Omit<
    React.ComponentProps<typeof Input>,
    | 'aria-describedby'
    | 'aria-invalid'
    | 'name'
    | 'onBlur'
    | 'onChange'
    | 'value'
  > {
  field: FormFieldLike<string>
  label: React.ReactNode
  description?: React.ReactNode
  id?: string
  showErrors?: boolean
}

export function FormTextField({
  field,
  label,
  description,
  id,
  showErrors = field.state.meta.isTouched,
  className,
  ...props
}: FormTextFieldProps) {
  const fieldId = id ?? field.name
  const descriptionId = description ? `${fieldId}-description` : undefined
  const messages = showErrors
    ? getValidationMessages(field.state.meta.errors)
    : []
  const errorId = messages.length ? `${fieldId}-error` : undefined
  const describedBy = [descriptionId, errorId].filter(Boolean).join(' ') || undefined

  return (
    <Field>
      <FieldLabel htmlFor={fieldId} className="text-ink">
        {label}
      </FieldLabel>
      {description ? (
        <FieldDescription id={descriptionId} className="text-muted">
          {description}
        </FieldDescription>
      ) : null}
      <Input
        {...props}
        id={fieldId}
        name={field.name}
        value={field.state.value}
        onChange={(event) => field.handleChange(event.currentTarget.value)}
        onBlur={field.handleBlur}
        aria-invalid={messages.length > 0}
        aria-describedby={describedBy}
        className={className}
      />
      <FieldError id={errorId} className="text-destructive">
        {messages.join(' ')}
      </FieldError>
    </Field>
  )
}

export interface FormErrorSummaryItem {
  fieldId: string
  label: string
  message: string
}

export interface ErrorSummaryProps extends React.ComponentProps<'section'> {
  errors: FormErrorSummaryItem[]
  title?: string
}

export const ErrorSummary = React.forwardRef<HTMLElement, ErrorSummaryProps>(
  function ErrorSummary(
    {
      errors,
      title = 'Revise os campos indicados',
      className,
      ...props
    },
    ref,
  ) {
    const titleId = React.useId()
    if (!errors.length) return null

    function focusField(fieldId: string) {
      const element = document.getElementById(fieldId)
      if (!(element instanceof HTMLElement)) return
      element.focus()
      const reducedMotion = globalThis.matchMedia?.(
        '(prefers-reduced-motion: reduce)',
      ).matches
      element.scrollIntoView?.({
        block: 'center',
        behavior: reducedMotion ? 'auto' : 'smooth',
      })
    }

    return (
      <section
        {...props}
        ref={ref}
        role="alert"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={cn(
          'rounded-xl border border-destructive/40 bg-destructive/5 p-4 text-sm text-ink',
          className,
        )}
      >
        <h2 id={titleId} className="font-semibold">
          {title}
        </h2>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          {errors.map((error) => (
            <li key={error.fieldId}>
              <a
                href={`#${error.fieldId}`}
                className="underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-baltic"
                onClick={(event) => {
                  event.preventDefault()
                  focusField(error.fieldId)
                }}
              >
                {error.label}: {error.message}
              </a>
            </li>
          ))}
        </ul>
      </section>
    )
  },
)
