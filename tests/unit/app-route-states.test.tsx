/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { AnchorHTMLAttributes, PropsWithChildren } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from '@/features/app/shell/app-shell'
import {
  AppRouteError,
  AppRouteNotFound,
  AppRoutePending,
} from '@/features/app/shell/app-route-states'
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

function session(): AppSession {
  return {
    user: {
      id: 'admin-1',
      name: 'Ana Silva',
      email: 'ana@weyne.test',
      role: 'admin',
    },
    expiresAt: '2026-09-01T00:00:00.000Z',
  }
}

describe('authenticated app route states', () => {
  it('keeps pending, error, and not-found route boundaries inside the guarded app layout', async () => {
    const routeSource = await readFile(resolve(process.cwd(), 'src/routes/app.tsx'), 'utf8')

    expect(routeSource).toContain('pendingComponent: AppRoutePending')
    expect(routeSource).toContain('errorComponent: AppRouteError')
    expect(routeSource).toContain('notFoundComponent: AppRouteNotFound')
  })

  it('announces the pending state without replacing the app shell', () => {
    render(
      <AppShell session={session()}>
        <AppRoutePending />
      </AppShell>,
    )

    expect(screen.getByRole('status', { name: 'Carregando página' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Carregando página' })).toBeVisible()
    expect(document.querySelector('[data-app-shell]')).toBeVisible()
  })

  it('offers a focused retry action for a route error', () => {
    const reset = vi.fn()

    render(<AppRouteError error={new Error('service unavailable')} reset={reset} />)

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar esta página')
    expect(screen.getByRole('heading', { level: 1, name: 'Não foi possível carregar esta página' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect(reset).toHaveBeenCalledOnce()
  })

  it('gives a missing route a safe in-shell return destination', () => {
    render(<AppRouteNotFound />)

    expect(screen.getByRole('heading', { level: 1, name: 'Página não encontrada' })).toHaveFocus()
    expect(screen.getByRole('link', { name: 'Voltar ao início da área de gestão' })).toHaveAttribute(
      'href',
      '/app',
    )
  })

  it('exposes a visible-on-focus skip link and moves route focus only after a pathname change', async () => {
    const view = render(
      <AppShell session={session()}>
        <div>
          <h1>Início</h1>
        </div>
      </AppShell>,
    )

    const skipLink = screen.getByRole('link', { name: 'Pular para o conteúdo principal' })
    expect(skipLink).toHaveAttribute('href', '#app-main')
    fireEvent.click(skipLink)
    expect(screen.getByRole('main')).toHaveFocus()

    const outsideControl = document.createElement('button')
    document.body.append(outsideControl)
    outsideControl.focus()

    routerState.pathname = '/app/produtos'
    view.rerender(
      <AppShell session={session()}>
        <div>
          <h1>Produtos</h1>
        </div>
      </AppShell>,
    )

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Produtos' })).toHaveFocus())
    outsideControl.remove()
  })
})
