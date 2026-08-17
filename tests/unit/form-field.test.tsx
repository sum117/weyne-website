// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import {
  ErrorSummary,
  FormTextField,
  getValidationMessages,
  type FormFieldLike,
} from '@/components/forms/form-field'

function createStringField(
  errors: unknown[] = [],
): FormFieldLike<string> & { handleChange: ReturnType<typeof vi.fn> } {
  return {
    name: 'legalName',
    state: {
      value: '',
      meta: { errors, isTouched: true },
    },
    handleBlur: vi.fn(),
    handleChange: vi.fn(),
  }
}

describe('form field adapters', () => {
  it('renders Zod messages and connects label, description and error ids', () => {
    const result = z.string().min(3, 'Informe ao menos 3 caracteres').safeParse('')
    const errors = result.success ? [] : result.error.issues
    const field = createStringField(errors)

    render(
      <FormTextField
        field={field}
        label="Razão social"
        description="Nome registrado na Receita Federal."
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Razão social' })
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute(
      'aria-describedby',
      'legalName-description legalName-error',
    )
    expect(screen.getByText('Informe ao menos 3 caracteres')).toHaveAttribute(
      'id',
      'legalName-error',
    )

    fireEvent.change(input, { target: { value: 'Weyne' } })
    fireEvent.blur(input)
    expect(field.handleChange).toHaveBeenCalledWith('Weyne')
    expect(field.handleBlur).toHaveBeenCalledOnce()
  })

  it('normalizes duplicate and non-message validation values', () => {
    expect(
      getValidationMessages([
        { message: 'Campo obrigatório' },
        'Campo obrigatório',
        null,
        { other: true },
      ]),
    ).toEqual(['Campo obrigatório'])
  })
})

describe('error summary', () => {
  it('focuses an invalid field from mouse or keyboard activation', () => {
    const firstFieldRef = createRef<HTMLInputElement>()
    render(
      <>
        <input id="taxId" ref={firstFieldRef} />
        <ErrorSummary
          errors={[
            { fieldId: 'taxId', label: 'CNPJ', message: 'CNPJ inválido' },
          ]}
        />
      </>,
    )

    const link = screen.getByRole('link', { name: 'CNPJ: CNPJ inválido' })
    link.focus()
    fireEvent.keyDown(link, { key: 'Enter' })
    fireEvent.click(link)
    expect(firstFieldRef.current).toHaveFocus()
  })
})
