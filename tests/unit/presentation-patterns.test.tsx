/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ConfirmationDialog,
  confirmToneClasses,
} from '@/components/patterns/confirmation-dialog'
import {
  DataTableSkeleton,
  DetailSkeleton,
  PageHeaderSkeleton,
} from '@/components/patterns/loading-skeletons'
import { PageHeader } from '@/components/patterns/page-header'
import {
  StatusBadge,
  statusBadgeVariantMap,
} from '@/components/patterns/status-badge'
import { PresentationPatternsExample } from '@/features/app/examples/presentation-patterns-example'

afterEach(cleanup)

describe('ConfirmationDialog', () => {
  it('places initial focus on the safe cancel action', async () => {
    render(
      <ConfirmationDialog
        defaultOpen
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        onConfirm={vi.fn()}
      />,
    )

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })
  })

  it('keeps an async confirmation open and prevents duplicate submission', async () => {
    let finishConfirmation: (() => void) | undefined
    const onConfirm = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConfirmation = resolve
        }),
    )

    render(
      <ConfirmationDialog
        defaultOpen
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        pendingLabel="Excluindo…"
        onConfirm={onConfirm}
      />,
    )

    const confirm = screen.getByRole('button', { name: 'Excluir cliente' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onConfirm).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('alertdialog')).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Excluindo…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Cancelar' })).toBeDisabled()

    finishConfirmation?.()
    await waitFor(() => {
      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    })
  })

  it('retains a rejected action error and restores trigger focus after Escape', async () => {
    const onCancel = vi.fn()
    render(
      <ConfirmationDialog
        trigger={<button type="button">Excluir Maria</button>}
        title="Excluir Maria?"
        description="O cadastro será removido permanentemente."
        confirmLabel="Excluir Maria"
        onCancel={onCancel}
        onConfirm={() => Promise.reject(new Error('Servidor indisponível.'))}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Excluir Maria' })
    fireEvent.click(trigger)
    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus()
    })
    fireEvent.click(screen.getByRole('button', { name: 'Excluir Maria' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Servidor indisponível.')
    expect(screen.getByRole('alertdialog')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(
      () => {
        expect(trigger).toHaveFocus()
      },
      { timeout: 5_000 },
    )
    expect(onCancel).toHaveBeenCalledWith('escape')
  })

  it('distinguishes the explicit cancel action from other close paths', () => {
    const onCancel = vi.fn()
    render(
      <ConfirmationDialog
        defaultOpen
        title="Descartar alterações?"
        description="Os dados não salvos serão perdidos."
        confirmLabel="Descartar"
        onCancel={onCancel}
        onConfirm={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onCancel).toHaveBeenCalledOnce()
    expect(onCancel).toHaveBeenCalledWith('cancel')
  })

  it('does not expose a previous failure when a controlled dialog reopens', async () => {
    const dialog = (open: boolean, error?: React.ReactNode) => (
      <ConfirmationDialog
        open={open}
        error={error}
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        onConfirm={() => Promise.reject(new Error('Falha anterior.'))}
      />
    )
    const { rerender } = render(dialog(true))

    fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha anterior.')

    rerender(dialog(false))
    rerender(dialog(true))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('does not let a falsy external error hide a caught failure message', async () => {
    render(
      <ConfirmationDialog
        defaultOpen
        error=""
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        onConfirm={() => Promise.reject(new Error('Falha interna.'))}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Falha interna.')
  })

  it('ignores a stale rejection after a controlled close and reopen', async () => {
    let rejectConfirmation: ((reason: Error) => void) | undefined
    const dialog = (open: boolean) => (
      <ConfirmationDialog
        open={open}
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        onConfirm={() =>
          new Promise<void>((_resolve, reject) => {
            rejectConfirmation = reject
          })
        }
      />
    )
    const { rerender } = render(dialog(true))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente' }))

    rerender(dialog(false))
    rerender(dialog(true))
    await act(() => {
      rejectConfirmation?.(new Error('Resposta antiga.'))
    })

    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Excluir cliente' })).toBeEnabled()
  })

  it('ignores a stale success after a controlled close and reopen', async () => {
    let finishConfirmation: (() => void) | undefined
    const onOpenChange = vi.fn()
    const dialog = (open: boolean) => (
      <ConfirmationDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Excluir cliente?"
        description="Esta ação não pode ser desfeita."
        confirmLabel="Excluir cliente"
        onConfirm={() =>
          new Promise<void>((resolve) => {
            finishConfirmation = resolve
          })
        }
      />
    )
    const { rerender } = render(dialog(true))
    fireEvent.click(screen.getByRole('button', { name: 'Excluir cliente' }))

    rerender(dialog(false))
    rerender(dialog(true))
    onOpenChange.mockClear()
    await act(() => {
      finishConfirmation?.()
    })

    expect(onOpenChange).not.toHaveBeenCalled()
    expect(screen.getByRole('alertdialog')).toBeVisible()
  })

  it('uses static token-backed classes for normal and destructive confirms', () => {
    expect(confirmToneClasses.default).toContain('bg-blue')
    expect(confirmToneClasses.destructive).toContain('bg-destructive')
  })
})

describe('StatusBadge', () => {
  it('maps every semantic status to a fixed Badge variant', () => {
    expect(statusBadgeVariantMap).toEqual({
      neutral: 'neutral',
      info: 'info',
      warning: 'warning',
      success: 'success',
      destructive: 'destructive',
    })

    render(
      <StatusBadge status="success" icon={<span data-testid="status-icon" />}>
        Ativo
      </StatusBadge>,
    )

    expect(screen.getByText('Ativo')).toHaveAttribute('data-status', 'success')
    expect(screen.getByTestId('status-icon')).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('PageHeader', () => {
  it('renders breadcrumbs, page copy, and feature-owned actions semantically', () => {
    render(
      <PageHeader
        breadcrumbs={[
          { label: 'Clientes', href: '/app/clientes' },
          { label: 'Novo cliente' },
        ]}
        title="Novo cliente"
        description="Cadastre os dados comerciais e fiscais."
        actions={<button type="button">Salvar cliente</button>}
      />,
    )

    expect(screen.getByRole('heading', { level: 1, name: 'Novo cliente' })).toBeVisible()
    expect(screen.getByRole('navigation', { name: 'Navegação estrutural' })).toBeVisible()
    expect(screen.getByText('Novo cliente', { selector: '[aria-current="page"]' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Salvar cliente' }).parentElement).toHaveAttribute(
      'data-slot',
      'page-header-actions',
    )
  })
})

describe('representative loading skeletons', () => {
  it('preserves page, table, and detail geometry behind one named busy region each', () => {
    render(
      <>
        <PageHeaderSkeleton />
        <DataTableSkeleton rowCount={4} />
        <DetailSkeleton />
      </>,
    )

    expect(screen.getByRole('status', { name: 'Carregando cabeçalho da página' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('status', { name: 'Carregando tabela' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(screen.getByRole('status', { name: 'Carregando detalhes' })).toHaveAttribute(
      'aria-busy',
      'true',
    )
    expect(document.querySelectorAll('[data-slot="skeleton-table-row"]')).toHaveLength(4)
    expect(document.querySelector('[data-slot="skeleton"]')).toHaveAttribute('aria-hidden', 'true')
    expect(
      screen
        .getByRole('status', { name: 'Carregando cabeçalho da página' })
        .querySelector('.h-9'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('status', { name: 'Carregando tabela' }).querySelector('.min-h-11'),
    ).toBeInTheDocument()
  })
})

describe('PresentationPatternsExample', () => {
  it('renders as a feature-free copyable composition', () => {
    render(<PresentationPatternsExample />)

    expect(screen.getByRole('heading', { level: 1, name: 'Padrões de apresentação' })).toBeVisible()
    expect(screen.getByText('Ativo')).toHaveAttribute('data-status', 'success')
    expect(screen.getByRole('button', { name: 'Excluir exemplo' })).toBeEnabled()
    expect(screen.getByRole('status', { name: 'Carregando tabela de exemplo' })).toBeVisible()
  })
})
