import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field, FieldLabel, FieldError } from '@/components/ui/field'
import { leadSchema } from '../lead.schema'
import { buildLeadMessage, buildWhatsAppUrl } from '../whatsapp'
import { siteConfig } from '../content'
import { WhatsappLogoIcon } from '@phosphor-icons/react/dist/ssr'

const { form: copy } = siteConfig.contact
const { whatsappNumber } = siteConfig.contactInfo

const fieldClass =
  'border-white/[0.16] bg-white/[0.06] text-white placeholder:text-white/40 focus-visible:border-baltic focus-visible:ring-4 focus-visible:ring-baltic/[0.12] aria-invalid:border-sand aria-invalid:ring-sand/20'

export function ContactForm() {
  const [opening, setOpening] = useState(false)

  const form = useForm({
    defaultValues: { nome: '', empresa: '', mensagem: '' },
    validators: { onBlur: leadSchema, onSubmit: leadSchema },
    onSubmit: ({ value }) => {
      openWhatsApp(value)
    },
  })

  /** Open synchronously so browsers do not block the new tab. */
  function openWhatsApp(value: {
    nome: string
    empresa: string
    mensagem: string
  }) {
    const url = buildWhatsAppUrl(whatsappNumber, buildLeadMessage(value))
    window.open(url, '_blank', 'noopener,noreferrer')
    toast(copy.submittingLabel)
    setOpening(true)
    window.setTimeout(() => setOpening(false), 2600)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    event.stopPropagation()
    // Validate synchronously; on success open WhatsApp inside the gesture.
    const result = leadSchema.safeParse(form.state.values)
    if (result.success) openWhatsApp(form.state.values)
    else void form.handleSubmit() // surfaces field errors
  }

  return (
    <form data-form onSubmit={handleSubmit} noValidate className="relative flex flex-col gap-3.5">
      <form.Field name="nome">
        {(field) => {
          const errors = field.state.meta.errors
          const hasError = field.state.meta.isTouched && errors.length > 0
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>{copy.nameLabel}</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={copy.namePlaceholder}
                aria-invalid={hasError}
                aria-describedby={hasError ? `${field.name}-error` : undefined}
                className={fieldClass}
              />
              {hasError && (
                <FieldError id={`${field.name}-error`}>
                  {errors[0]?.message}
                </FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="empresa">
        {(field) => {
          const errors = field.state.meta.errors
          const hasError = field.state.meta.isTouched && errors.length > 0
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>{copy.companyLabel}</FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={copy.companyPlaceholder}
                aria-invalid={hasError}
                aria-describedby={hasError ? `${field.name}-error` : undefined}
                className={fieldClass}
              />
              {hasError && (
                <FieldError id={`${field.name}-error`}>
                  {errors[0]?.message}
                </FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="mensagem">
        {(field) => {
          const errors = field.state.meta.errors
          const hasError = field.state.meta.isTouched && errors.length > 0
          return (
            <Field>
              <FieldLabel htmlFor={field.name}>{copy.messageLabel}</FieldLabel>
              <Textarea
                id={field.name}
                name={field.name}
                rows={3}
                value={field.state.value}
                onChange={(e) => field.handleChange(e.target.value)}
                onBlur={field.handleBlur}
                placeholder={copy.messagePlaceholder}
                aria-invalid={hasError}
                aria-describedby={hasError ? `${field.name}-error` : undefined}
                className={fieldClass}
              />
              {hasError && (
                <FieldError id={`${field.name}-error`}>
                  {errors[0]?.message}
                </FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>

      <Button type="submit" variant="sand" size="submit" className="mt-1.5">
        <WhatsappLogoIcon size={20} weight="light" />
        {opening ? copy.submittingLabel : copy.submitLabel}
      </Button>
    </form>
  )
}
