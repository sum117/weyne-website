import { useState } from 'react'
import { useForm } from '@tanstack/react-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field, FieldError, FieldLabel } from '@/components/ui/field'
import { signInWithPassword } from './login.functions'

/**
 * Credential login form for the authenticated application.
 *
 * The form owns no session state. It posts the credentials to the
 * `signInWithPassword` server function, which sets the HttpOnly session
 * cookie; on success the caller navigates and the route guard resolves the
 * session from that cookie on the server. Nothing about the identity is kept
 * in browser memory or storage here.
 *
 * Every rejection renders the same message, so the form cannot be used to
 * discover which addresses have an account.
 */

const loginSchema = z.object({
  email: z
    .string()
    .trim()
    .min(1, 'Informe seu e-mail.')
    .email('Informe um e-mail válido.'),
  password: z.string().min(1, 'Informe sua senha.'),
})

export type LoginFormProps = Readonly<{
  /** Called after the session cookie is established. */
  onAuthenticated: () => void | Promise<void>
  /** Injected in tests; defaults to the real server function. */
  signIn?: typeof signInWithPassword
}>

export function LoginForm({ onAuthenticated, signIn = signInWithPassword }: LoginFormProps) {
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const form = useForm({
    defaultValues: { email: '', password: '' },
    validators: { onSubmit: loginSchema },
    onSubmit: async ({ value }) => {
      setFormError(null)
      setSubmitting(true)
      try {
        const result = await signIn({ data: value })
        if (!result.ok) {
          setFormError(result.error.message)
          return
        }
        await onAuthenticated()
      } catch {
        setFormError('Não foi possível concluir a operação. Tente novamente.')
      } finally {
        setSubmitting(false)
      }
    },
  })

  return (
    <form
      noValidate
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        event.stopPropagation()
        void form.handleSubmit()
      }}
    >
      <form.Field name="email">
        {(field) => {
          const errors = field.state.meta.errors
          const hasError = field.state.meta.isTouched && errors.length > 0
          return (
            <Field>
              <FieldLabel htmlFor={field.name} className="text-muted">
                E-mail
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="email"
                autoComplete="username"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={hasError}
                aria-describedby={hasError ? `${field.name}-error` : undefined}
              />
              {hasError && (
                <FieldError id={`${field.name}-error`} className="text-destructive">
                  {errors[0]?.message}
                </FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>

      <form.Field name="password">
        {(field) => {
          const errors = field.state.meta.errors
          const hasError = field.state.meta.isTouched && errors.length > 0
          return (
            <Field>
              <FieldLabel htmlFor={field.name} className="text-muted">
                Senha
              </FieldLabel>
              <Input
                id={field.name}
                name={field.name}
                type="password"
                autoComplete="current-password"
                value={field.state.value}
                onChange={(event) => field.handleChange(event.target.value)}
                onBlur={field.handleBlur}
                aria-invalid={hasError}
                aria-describedby={hasError ? `${field.name}-error` : undefined}
              />
              {hasError && (
                <FieldError id={`${field.name}-error`} className="text-destructive">
                  {errors[0]?.message}
                </FieldError>
              )}
            </Field>
          )
        }}
      </form.Field>

      {formError && (
        <p
          role="alert"
          data-slot="login-error"
          className="rounded-lg border border-destructive-border bg-destructive-surface px-4 py-3 text-sm text-destructive-surface-foreground"
        >
          {formError}
        </p>
      )}

      <Button type="submit" size="submit" disabled={submitting}>
        {submitting ? 'Entrando…' : 'Entrar'}
      </Button>
    </form>
  )
}
