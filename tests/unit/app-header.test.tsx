/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppHeader, getAppBreadcrumbs } from '@/features/app/shell/app-header'
import type { AppSession } from '@/lib/auth/contract'

vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({ invalidate: vi.fn(async () => undefined) }),
}))

afterEach(cleanup)

const SESSION: AppSession = {
  user: {
    id: 'user-1',
    name: 'Ana Silva',
    email: 'ana@weyne.test',
    role: 'admin',
  },
  expiresAt: '2026-09-01T00:00:00.000Z',
}

function openAccountMenu() {
  const trigger = screen.getByRole('button', { name: 'Abrir menu da conta de Ana Silva' })
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false })
  fireEvent.click(trigger)
  return trigger
}

describe('getAppBreadcrumbs', () => {
  it('maps known nested routes to human-readable trails with one current page', () => {
    expect(getAppBreadcrumbs('/app/configuracoes/auditoria')).toEqual([
      { href: '/app', label: 'Início' },
      { label: 'Configurações' },
      { label: 'Auditoria de atividades' },
    ])
    expect(getAppBreadcrumbs('/app/produtos/')).toEqual([
      { href: '/app', label: 'Início' },
      { label: 'Produtos' },
    ])
  })
})

describe('AppHeader', () => {
  it('renders a labeled location trail and the signed-in account context', () => {
    render(<AppHeader pathname="/app/configuracoes/auditoria" session={SESSION} />)

    expect(screen.getByRole('banner', { name: 'Contexto do aplicativo' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Localização atual' })).toBeVisible()
    expect(
      screen.getByText('Auditoria de atividades', { selector: '[aria-current="page"]' }),
    ).toBeVisible()
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('button', { name: 'Abrir menu da conta de Ana Silva' })).toBeVisible()
  })

  it('closes with Escape and restores focus to the account trigger', async () => {
    render(<AppHeader pathname="/app/produtos" session={SESSION} />)

    const trigger = openAccountMenu()
    expect(await screen.findByRole('menu')).toBeVisible()
    expect(screen.getByText('ana@weyne.test')).toBeVisible()
    expect(screen.getByText('Administrador(a)')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()
  })

  it('closes the account menu before it terminates the session and redirects', async () => {
    const events: string[] = []
    let finishSignOut: (() => void) | undefined
    const signOut = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          events.push('signOut')
          finishSignOut = () => resolve({ ok: true })
        }),
    )
    const navigate = vi.fn((path: string) => events.push(`navigate:${path}`))

    render(
      <AppHeader
        navigate={navigate}
        pathname="/app"
        session={SESSION}
        signOut={signOut as never}
      />,
    )

    openAccountMenu()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sair' }))

    await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument())
    expect(signOut).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()

    finishSignOut?.()
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/entrar'))
    expect(events).toEqual(['signOut', 'navigate:/entrar'])
  })

  it('keeps the mobile navigation trigger a single named control supplied by navigation', () => {
    render(
      <AppHeader
        navigationTrigger={<button type="button">Abrir navegação</button>}
        pathname="/app"
        session={SESSION}
      />,
    )

    expect(screen.getAllByRole('button', { name: 'Abrir navegação' })).toHaveLength(1)
  })
})
