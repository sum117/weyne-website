// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomerFormExample } from '@/components/forms/examples/customer-form-example'

afterEach(cleanup)

describe('standalone customer form example', () => {
  it('surfaces Zod errors in fields and an accessible navigable summary', async () => {
    render(<CustomerFormExample onSubmit={vi.fn()} />)

    fireEvent.submit(screen.getByRole('form', { name: 'Cadastro de cliente' }))

    const summary = await screen.findByRole('alert', {
      name: 'Revise os campos indicados',
    })
    expect(summary).toHaveTextContent('Razão social')
    expect(screen.getByText('Informe a razão social')).toHaveAttribute(
      'id',
      expect.stringContaining('legalName-error'),
    )
    const link = screen.getByRole('link', {
      name: /Razão social: Informe a razão social/,
    })
    fireEvent.click(link)
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Razão social' })).toHaveFocus(),
    )
  })

  it('generates unique control ids when more than one example is rendered', () => {
    render(
      <>
        <CustomerFormExample onSubmit={vi.fn()} />
        <CustomerFormExample onSubmit={vi.fn()} />
      </>,
    )

    const legalNameFields = document.querySelectorAll<HTMLInputElement>(
      'input[name="legalName"]',
    )
    expect(legalNameFields[0]?.id).not.toBe(legalNameFields[1]?.id)
  })
})
