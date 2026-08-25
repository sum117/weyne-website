/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AnchorHTMLAttributes, PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/features/app/shell/app-shell'
import type { AppSession } from '@/lib/auth/contract'

const routerState = vi.hoisted(() => ({ pathname: '/app' }))

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to, ...props }: PropsWithChildren<{ to: string }> & AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a {...props} href={to}>{children}</a>
  ),
  useLocation: <T,>({ select }: { select: (location: { pathname: string }) => T }) =>
    select({ pathname: routerState.pathname }),
  useRouter: () => ({ invalidate: vi.fn(async () => undefined) }),
}))

afterEach(() => {
  cleanup()
  routerState.pathname = '/app'
})

function session(role: AppSession['user']['role']): AppSession {
  return {
    user: {
      id: `${role}-1`,
      name: 'Ana Silva',
      email: 'ana@weyne.test',
      role,
    },
    expiresAt: '2026-09-01T00:00:00.000Z',
  }
}

describe('AppShell navigation', () => {
  it('shows representatives only destinations permitted by the capability matrix', () => {
    render(
      <AppShell session={session('representative')}>
        <div>Conteúdo</div>
      </AppShell>,
    )

    const navigation = screen.getByRole('navigation', {
      name: 'Navegação principal do aplicativo',
    })
    expect(navigation).toBeVisible()
    expect(screen.getByRole('link', { name: 'Início' })).toHaveAttribute('href', '/app')
    expect(screen.getByRole('link', { name: 'Produtos' })).toHaveAttribute(
      'href',
      '/app/produtos',
    )
    expect(
      screen.queryByRole('link', { name: 'Auditoria de atividades' }),
    ).not.toBeInTheDocument()
  })

  it('moves focus into the mobile Sheet and restores it after Escape', async () => {
    const view = render(
      <AppShell session={session('admin')}>
        <div>Conteúdo</div>
      </AppShell>,
    )

    const trigger = screen.getByRole('button', { name: 'Abrir navegação' })
    fireEvent.click(trigger)

    const sheet = await screen.findByRole('dialog', { name: 'Navegação principal' })
    expect(sheet).toContainElement(document.activeElement as HTMLElement | null)

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(trigger).toHaveFocus()

    fireEvent.click(trigger)
    await screen.findByRole('dialog', { name: 'Navegação principal' })
    routerState.pathname = '/app/produtos'
    view.rerender(
      <AppShell session={session('admin')}>
        <div>Conteúdo</div>
      </AppShell>,
    )
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
