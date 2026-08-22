/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LoginForm } from '@/features/app/auth/login-form'
import { SignOutButton } from '@/features/app/auth/sign-out-button'

/**
 * The login form and the logout control own no session state — the cookie
 * does. These tests pin the behaviors that protect that arrangement: a
 * rejected login never leaks which part of the credential was wrong, and
 * logout leaves the application only after the server call has settled.
 */

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(async () => undefined) }),
}))

afterEach(cleanup)

type SignInFn = Parameters<typeof LoginForm>[0]['signIn']
type SignOutButtonProps = NonNullable<Parameters<typeof SignOutButton>[0]>
type SignOutFn = SignOutButtonProps['signOut']

function signInStub(result: unknown): SignInFn {
  return vi.fn(async () => result) as unknown as SignInFn
}

function fillCredentials(email: string, password: string) {
  fireEvent.change(screen.getByLabelText('E-mail'), { target: { value: email } })
  fireEvent.change(screen.getByLabelText('Senha'), { target: { value: password } })
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: 'Entrar' }))
}

describe('LoginForm', () => {
  it('requires both fields before it calls the server', async () => {
    const signIn = signInStub({ ok: true })
    render(<LoginForm onAuthenticated={vi.fn()} signIn={signIn} />)

    submit()

    expect(await screen.findByText('Informe seu e-mail.')).toBeInTheDocument()
    expect(screen.getByText('Informe sua senha.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('rejects a malformed address without calling the server', async () => {
    const signIn = signInStub({ ok: true })
    render(<LoginForm onAuthenticated={vi.fn()} signIn={signIn} />)

    fillCredentials('nao-e-um-email', 'alguma-senha-longa')
    submit()

    expect(await screen.findByText('Informe um e-mail válido.')).toBeInTheDocument()
    expect(signIn).not.toHaveBeenCalled()
  })

  it('hands the credentials to the server function and reports success', async () => {
    const signIn = signInStub({
      ok: true,
      session: {
        user: { id: 'u1', name: 'Ana', email: 'ana@weyne.test', role: 'admin' },
        expiresAt: '2026-09-01T00:00:00.000Z',
      },
    })
    const onAuthenticated = vi.fn()
    render(<LoginForm onAuthenticated={onAuthenticated} signIn={signIn} />)

    fillCredentials('ana@weyne.test', 'senha-de-teste-bem-longa')
    submit()

    await waitFor(() => expect(onAuthenticated).toHaveBeenCalledTimes(1))
    expect(signIn).toHaveBeenCalledWith({
      data: { email: 'ana@weyne.test', password: 'senha-de-teste-bem-longa' },
    })
  })

  it('renders the server message verbatim and stays on the form', async () => {
    const signIn = signInStub({
      ok: false,
      error: { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' },
    })
    const onAuthenticated = vi.fn()
    render(<LoginForm onAuthenticated={onAuthenticated} signIn={signIn} />)

    fillCredentials('ana@weyne.test', 'senha-errada-porem-longa')
    submit()

    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('E-mail ou senha inválidos.')
    // The message names neither field, so it cannot be used to enumerate.
    expect(alert.textContent).not.toMatch(/senha incorreta|não encontrado|não existe/i)
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('surfaces a transport failure without claiming a session', async () => {
    const signIn = vi.fn(async () => {
      throw new Error('network down')
    }) as unknown as SignInFn
    const onAuthenticated = vi.fn()
    render(<LoginForm onAuthenticated={onAuthenticated} signIn={signIn} />)

    fillCredentials('ana@weyne.test', 'senha-de-teste-bem-longa')
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a operação. Tente novamente.',
    )
    expect(onAuthenticated).not.toHaveBeenCalled()
  })

  it('uses the standard credential autocomplete hints', () => {
    render(<LoginForm onAuthenticated={vi.fn()} signIn={signInStub({ ok: true })} />)

    expect(screen.getByLabelText('E-mail')).toHaveAttribute('autocomplete', 'username')
    const senha = screen.getByLabelText('Senha')
    expect(senha).toHaveAttribute('type', 'password')
    expect(senha).toHaveAttribute('autocomplete', 'current-password')
  })
})

describe('SignOutButton', () => {
  it('leaves for the login page only after the server call settles', async () => {
    const order: string[] = []
    const signOut = vi.fn(async () => {
      order.push('signOut')
      return { ok: true as const }
    }) as unknown as SignOutFn
    const navigate = vi.fn((path: string) => {
      order.push(`navigate:${path}`)
    })

    render(<SignOutButton signOut={signOut} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/entrar'))
    expect(order).toEqual(['signOut', 'navigate:/entrar'])
  })

  it('still clears the browser out of the app when revocation fails', async () => {
    const signOut = vi.fn(async () => {
      throw new Error('revocation unavailable')
    }) as unknown as SignOutFn
    const navigate = vi.fn()

    render(<SignOutButton signOut={signOut} navigate={navigate} />)
    fireEvent.click(screen.getByRole('button', { name: 'Sair' }))

    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/entrar'))
  })
})
