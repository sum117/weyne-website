/** @vitest-environment jsdom */

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ReportsShell,
  type ReportNavigate,
} from '@/features/app/reports/reports-shell'

const currentSearch = {
  from: '2026-07-01',
  to: '2026-08-01',
  status: ['invoiced'],
  representative: ['rep-1'],
  page: 3,
  sort: 'client.asc',
  columns: ['client', 'total'],
}

const capabilities = {
  availableTabs: ['clientes', 'produtos', 'industrias', 'comissoes'],
  canFilterRepresentatives: true,
} as const

const representatives = [
  { id: 'rep-1', label: 'Ana Souza' },
  { id: 'rep-2', label: 'Bruno Lima' },
]

afterEach(cleanup)

function renderShell(
  overrides: Partial<React.ComponentProps<typeof ReportsShell>> = {},
) {
  const navigate = vi.fn<ReportNavigate>()
  render(
    <ReportsShell
      search={currentSearch}
      navigate={navigate}
      today="2026-08-17"
      capabilities={capabilities}
      representatives={representatives}
      {...overrides}
    />,
  )
  return navigate
}

describe('ReportsShell', () => {
  it('renders the four keyboard-accessible report tabs and shared filters without export controls', () => {
    renderShell()

    expect(screen.getByRole('heading', { name: 'Relatórios' })).toBeInTheDocument()
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual([
      'Vendas por cliente',
      'Vendas por produto',
      'Vendas por indústria',
      'Comissões',
    ])
    expect(screen.getByLabelText('Data inicial')).toHaveValue('2026-07-01')
    expect(screen.getByLabelText('Data final')).toHaveValue('2026-08-01')
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.getByLabelText('Representantes')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /exportar/i })).not.toBeInTheDocument()
  })

  it('pushes tab state to the URL while preserving valid shared filters', () => {
    const navigate = renderShell()

    fireEvent.click(screen.getByRole('tab', { name: 'Vendas por produto' }))

    const navigation = navigate.mock.calls.at(-1)?.[0]
    expect(navigation?.replace).toBe(false)
    expect(navigation?.search(currentSearch)).toEqual({
      from: '2026-07-01',
      to: '2026-08-01',
      status: ['invoiced'],
      representative: ['rep-1'],
      tab: 'produtos',
    })
  })

  it('normalizes date changes and resets pagination through a history-restorable URL update', () => {
    const navigate = renderShell()

    fireEvent.change(screen.getByLabelText('Data final'), {
      target: { value: '2026-06-01' },
    })

    const navigation = navigate.mock.calls.at(-1)?.[0]
    expect(navigation?.replace).toBe(false)
    expect(navigation?.search(currentSearch)).toMatchObject({
      from: '2026-06-01',
      to: '2026-07-01',
    })
    expect(navigation?.search(currentSearch)).not.toHaveProperty('page')
  })

  it('hides unauthorized tabs and representative scope controls', () => {
    renderShell({
      capabilities: {
        availableTabs: ['clientes', 'produtos', 'industrias'],
        canFilterRepresentatives: false,
      },
      renderReport: ({ state }) => (
        <output aria-label="Escopo de representantes">
          {state.filters.representativeIds.join(',')}
        </output>
      ),
    })

    expect(screen.queryByRole('tab', { name: 'Comissões' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Representantes')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Escopo de representantes')).toBeEmptyDOMElement()
  })

  it('exposes loading, empty, and error report states accessibly', () => {
    const { rerender } = render(
      <ReportsShell
        search={{}}
        navigate={() => undefined}
        today="2026-08-17"
        capabilities={capabilities}
        representatives={representatives}
        tableState="loading"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Carregando dados')

    rerender(
      <ReportsShell
        search={{}}
        navigate={() => undefined}
        today="2026-08-17"
        capabilities={capabilities}
        representatives={representatives}
        tableState="empty"
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('Nenhum resultado')

    rerender(
      <ReportsShell
        search={{}}
        navigate={() => undefined}
        today="2026-08-17"
        capabilities={capabilities}
        representatives={representatives}
        tableState="error"
      />,
    )
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar')
  })
})
