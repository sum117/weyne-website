/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SharedPatternsExample } from '@/components/patterns/examples/shared-patterns-example'
import type { DataTableUrlNavigate } from '@/components/data-table/data-table-url-state'

const canonicalExampleFiles = [
  'src/components/data-table/examples/server-data-table-example.tsx',
  'src/components/forms/examples/customer-form-example.tsx',
  'src/components/patterns/examples/presentation-patterns-example.tsx',
  'src/components/patterns/examples/shared-patterns-example.tsx',
]

afterEach(cleanup)

describe('shared app pattern examples', () => {
  it('compose all copyable patterns without importing feature modules', () => {
    for (const path of canonicalExampleFiles) {
      expect(readFileSync(path, 'utf8')).not.toContain("@/features/")
    }

    render(
      <SharedPatternsExample
        search={{}}
        navigate={vi.fn<DataTableUrlNavigate>()}
        onSubmit={vi.fn()}
      />,
    )

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Padrões compartilhados do app',
      }),
    ).toBeVisible()
    expect(screen.getByRole('region', { name: 'Exemplo de contas' })).toBeVisible()
    expect(screen.getByRole('form', { name: 'Cadastro de cliente' })).toBeVisible()
    expect(screen.getByText('Ativo')).toHaveAttribute('data-status', 'success')
    expect(
      screen.getByRole('status', { name: 'Carregando tabela de exemplo' }),
    ).toBeVisible()
  })

  it('makes every table request state discoverable in the live example', () => {
    render(
      <SharedPatternsExample
        search={{}}
        navigate={vi.fn<DataTableUrlNavigate>()}
        onSubmit={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar carregamento' }))
    expect(screen.getByRole('status', { name: 'Carregando dados…' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar vazio' }))
    expect(screen.getByText('Nenhum registro encontrado')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar erro' }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Falha simulada ao carregar as contas.',
    )

    fireEvent.click(screen.getByRole('button', { name: 'Mostrar dados' }))
    expect(screen.getByText('Mercado Aurora')).toBeVisible()
  })

  it('returns focus to the confirmation trigger after cancellation', async () => {
    render(
      <SharedPatternsExample
        search={{}}
        navigate={vi.fn<DataTableUrlNavigate>()}
        onSubmit={vi.fn()}
      />,
    )

    const trigger = screen.getByRole('button', { name: 'Excluir exemplo' })
    fireEvent.click(trigger)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Cancelar' })).toHaveFocus(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})
