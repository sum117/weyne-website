// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ClientDetail,
  type ClientDetailRecord,
} from '@/features/app/clients/client-detail'

const client: ClientDetailRecord = {
  id: 'client-1',
  legalName: 'Mercado Boa Praça Ltda.',
  tradeName: 'Mercado Boa Praça',
  cnpj: '12345678000195',
  stateRegistration: '0321418-40',
  status: 'active',
  segment: 'Supermercado',
  contactName: 'Ana Souza',
  phone: '81999964054',
  whatsapp: '81999964054',
  email: 'compras@boapraca.com.br',
  address: {
    street: 'Rua das Flores',
    number: '120',
    complement: 'Sala 2',
    district: 'Centro',
    city: 'Recife',
    state: 'PE',
    postalCode: '50010000',
  },
  representativeName: 'Carolina Weyne',
  creditLimit: '12500.50',
  notes: 'Entregas somente pela manhã.',
}

afterEach(cleanup)

describe('client detail', () => {
  it('renders the service-provided summary with pt-BR formatting', () => {
    render(
      <ClientDetail
        state={{ status: 'ready', client }}
        actions={{ canEdit: false, canArchive: false }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'Mercado Boa Praça' })).toBeVisible()
    expect(screen.getByText('12.345.678/0001-95')).toBeVisible()
    expect(screen.getAllByText('(81) 99996-4054')).toHaveLength(2)
    expect(screen.getByText('50010-000')).toBeVisible()
    expect(screen.getByText(/R\$.*12\.500,50/)).toBeVisible()
    expect(screen.getByText('Ativo')).toBeVisible()
    expect(screen.getByText('Entregas somente pela manhã.')).toBeVisible()
  })

  it.each([
    ['loading', 'Carregando dados do cliente'],
    ['not-found', 'Cliente não encontrado'],
    ['forbidden', 'Acesso não autorizado'],
    ['error', 'Não foi possível carregar o cliente'],
  ] as const)('renders the accessible %s state', (status, expectedText) => {
    const state = status === 'error' ? { status, message: 'Tente novamente.' } : { status }

    render(
      <ClientDetail
        state={state}
        actions={{ canEdit: false, canArchive: false }}
      />,
    )

    expect(screen.getByText(expectedText)).toBeVisible()
  })

  it('shows only authorized actions and restores focus after archive cancellation', async () => {
    const onEdit = vi.fn()
    const onArchive = vi.fn()
    const { rerender } = render(
      <ClientDetail
        state={{ status: 'ready', client }}
        actions={{ canEdit: true, canArchive: true }}
        onEdit={onEdit}
        onArchive={onArchive}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Editar cliente' }))
    expect(onEdit).toHaveBeenCalledWith(client)

    const archiveTrigger = screen.getByRole('button', { name: 'Arquivar cliente' })
    archiveTrigger.focus()
    fireEvent.click(archiveTrigger)
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Mercado Boa Praça')
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'deixará de aparecer nas listas de clientes ativos',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(archiveTrigger).toHaveFocus())
    expect(onArchive).not.toHaveBeenCalled()

    rerender(
      <ClientDetail
        state={{ status: 'ready', client }}
        actions={{ canEdit: false, canArchive: false }}
      />,
    )
    expect(screen.queryByRole('button', { name: 'Editar cliente' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Arquivar cliente' })).not.toBeInTheDocument()
  })

  it('submits archive once and hands successful navigation back to the route', async () => {
    let resolveArchive: ((value: { ok: true }) => void) | undefined
    const onArchive = vi.fn(
      () =>
        new Promise<{ ok: true }>((resolve) => {
          resolveArchive = resolve
        }),
    )
    const onArchived = vi.fn()
    render(
      <ClientDetail
        state={{ status: 'ready', client }}
        actions={{ canEdit: false, canArchive: true }}
        onArchive={onArchive}
        onArchived={onArchived}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Arquivar cliente' }))
    const confirm = screen.getByRole('button', { name: 'Confirmar arquivamento' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)

    expect(onArchive).toHaveBeenCalledOnce()
    expect(onArchive).toHaveBeenCalledWith(client)
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')

    resolveArchive?.({ ok: true })
    await waitFor(() => expect(onArchived).toHaveBeenCalledWith(client))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it.each([
    ['CONFLICT', 'Este cliente não pode ser arquivado no estado atual.'],
    ['FORBIDDEN', 'Você não tem permissão para arquivar este cliente.'],
    ['NOT_FOUND', 'Este cliente não está mais disponível.'],
    ['INTERNAL_ERROR', 'Não foi possível arquivar o cliente.'],
  ] as const)('keeps the dialog recoverable after a %s response', async (code, message) => {
    const onArchive = vi.fn().mockResolvedValue({ ok: false, code })
    render(
      <ClientDetail
        state={{ status: 'ready', client }}
        actions={{ canEdit: false, canArchive: true }}
        onArchive={onArchive}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Arquivar cliente' })
    fireEvent.click(trigger)
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar arquivamento' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('alertdialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Confirmar arquivamento' })).toBeEnabled()

    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('keeps the summary and actions operable at narrow widths without inferring eligibility', () => {
    render(
      <ClientDetail
        state={{ status: 'ready', client: { ...client, status: 'archived' } }}
        actions={{ canEdit: true, canArchive: true }}
        onArchive={vi.fn().mockResolvedValue({ ok: false, code: 'CONFLICT' })}
      />,
    )

    const heading = screen.getByRole('heading', { name: 'Mercado Boa Praça' })
    const header = heading.closest('header')
    expect(header).toHaveClass('flex-col', 'sm:flex-row')
    expect(screen.getByText('CNPJ').closest('dl')).toHaveClass(
      'grid-cols-1',
      'sm:grid-cols-2',
    )
    expect(screen.getByRole('button', { name: 'Editar cliente' })).toHaveClass(
      'min-h-11',
    )
    expect(screen.getByRole('button', { name: 'Arquivar cliente' })).toHaveClass(
      'min-h-11',
    )
  })
})
