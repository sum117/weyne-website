// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ProductDetail,
  type ProductDetailRecord,
} from '@/features/app/products/product-detail'
import {
  ProductForm,
  type ProductFormProps,
} from '@/features/app/products/product-form'

const industryOptions = [
  { value: '11111111-1111-4111-8111-111111111111', label: 'Indústria Ativa' },
  { value: '22222222-2222-4222-8222-222222222222', label: 'Indústria Arquivada', archived: true },
] as const

const initialValues = {
  industryId: industryOptions[0].value,
  internalCode: 'INT-001',
  manufacturerCode: 'FAB-009',
  description: 'Desinfetante concentrado',
  brand: 'Marca Azul',
  category: 'Limpeza profissional',
  ncm: '38089419',
  cest: '2001000',
  ean: '7891234567890',
  dun: '17891234567897',
  packaging: 'Caixa com 12',
  unit: 'UN',
  netWeight: '0.100000',
  grossWeight: '0.123456',
  width: '10.000001',
  height: '20.000002',
  depth: '30.000003',
  dimensionUnit: 'cm',
  ipiRate: '1.250000',
  icmsRate: '18.000000',
  pisRate: '1.650000',
  cofinsRate: '7.600000',
  commissionOverride: '0.000000',
} satisfies NonNullable<ProductFormProps['initialValues']>

const detailRecord: ProductDetailRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  industry: 'Indústria Ativa',
  ...initialValues,
  effectiveCommission: { rate: '0.000000', source: 'product' },
  isActive: true,
  archivedAt: null,
  createdAt: '2026-08-17T12:00:00.000Z',
  createdBy: 'Ana Admin',
  updatedAt: '2026-08-17T13:00:00.000Z',
  updatedBy: 'Ana Admin',
}

afterEach(cleanup)

describe('product create and edit form', () => {
  it('shows accessible validation and focuses a field from the summary', async () => {
    render(
      <ProductForm
        mode="create"
        role="admin"
        industryOptions={industryOptions}
        categoryOptions={['Limpeza profissional']}
        brandOptions={['Marca Azul']}
        onSubmit={vi.fn()}
      />,
    )

    fireEvent.submit(screen.getByRole('form', { name: 'Criar produto' }))

    const summary = await screen.findByRole('alert', { name: 'Revise os campos indicados' })
    expect(summary).toHaveTextContent('Indústria')
    expect(summary).toHaveTextContent('Código interno')
    expect(summary).toHaveTextContent('Descrição')
    expect(summary).toHaveTextContent('Unidade')

    fireEvent.click(screen.getByRole('link', { name: /Código interno:/ }))
    await waitFor(() => expect(screen.getByRole('textbox', { name: /Código interno/ })).toHaveFocus())
  })

  it('preserves Decimal strings exactly on create and supports selectors', async () => {
    const onSubmit = vi.fn()
    render(
      <ProductForm
        mode="create"
        role="admin"
        industryOptions={industryOptions}
        categoryOptions={['Limpeza profissional', 'Descartáveis']}
        brandOptions={['Marca Azul', 'Marca Areia']}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.change(screen.getByLabelText(/Indústria/), { target: { value: industryOptions[0].value } })
    fireEvent.change(screen.getByRole('textbox', { name: /Código interno/ }), { target: { value: 'INT-001' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Descrição/ }), { target: { value: 'Desinfetante concentrado' } })
    fireEvent.change(screen.getByRole('textbox', { name: /^Unidade \(obrigatório\)$/ }), { target: { value: 'UN' } })
    fireEvent.change(screen.getByRole('combobox', { name: /Categoria/ }), { target: { value: 'Limpeza profissional' } })
    fireEvent.blur(screen.getByRole('combobox', { name: /Categoria/ }))
    fireEvent.change(screen.getByRole('combobox', { name: /Marca/ }), { target: { value: 'Marca Azul' } })
    fireEvent.blur(screen.getByRole('combobox', { name: /Marca/ }))
    fireEvent.change(screen.getByRole('textbox', { name: /Peso líquido/ }), { target: { value: '0.100000' } })
    fireEvent.change(screen.getByRole('textbox', { name: /Comissão própria/ }), { target: { value: '0.000000' } })

    fireEvent.click(screen.getByRole('button', { name: 'Criar produto' }))

    await waitFor(() => expect(onSubmit).toHaveBeenCalledOnce())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      industryId: industryOptions[0].value,
      category: 'Limpeza profissional',
      brand: 'Marca Azul',
      netWeight: '0.100000',
      commissionOverride: '0.000000',
    }))
    expect(onSubmit.mock.calls[0]?.[0].grossWeight).toBeNull()
  })

  it('rejects malformed measurements and dimensions without a unit', async () => {
    const onSubmit = vi.fn()
    render(
      <ProductForm
        mode="edit"
        role="admin"
        industryOptions={industryOptions}
        categoryOptions={[]}
        brandOptions={[]}
        initialValues={{ ...initialValues, netWeight: '0.0000001', dimensionUnit: null }}
        onSubmit={onSubmit}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }))

    const summary = await screen.findByRole('alert', { name: 'Revise os campos indicados' })
    expect(summary).toHaveTextContent('Peso líquido: Use até 6 casas decimais')
    expect(summary).toHaveTextContent('Unidade das dimensões: Informe a unidade das dimensões')
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('omits archived industries on create but preserves the historical selection on edit', () => {
    const { rerender } = render(
      <ProductForm
        mode="create"
        role="admin"
        industryOptions={industryOptions}
        categoryOptions={[]}
        brandOptions={[]}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.queryByRole('option', { name: /Indústria Arquivada/ })).not.toBeInTheDocument()

    rerender(
      <ProductForm
        mode="edit"
        role="admin"
        industryOptions={industryOptions}
        categoryOptions={[]}
        brandOptions={[]}
        initialValues={{ ...initialValues, industryId: industryOptions[1].value }}
        onSubmit={vi.fn()}
      />,
    )
    expect(screen.getByRole('option', { name: 'Indústria Arquivada (arquivada)' })).toBeInTheDocument()
    expect(screen.getByLabelText(/Indústria/)).toHaveValue(industryOptions[1].value)
  })

  it.each(['representative', 'read_only'] as const)('does not expose or execute mutation for the %s role', (role) => {
    const onSubmit = vi.fn()
    const { container } = render(
      <ProductForm
        mode="edit"
        role={role}
        industryOptions={industryOptions}
        categoryOptions={[]}
        brandOptions={[]}
        initialValues={initialValues}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('permissão para editar produtos')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    fireEvent.submit(container)
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('keeps an archived product read-only until it is restored', () => {
    const onSubmit = vi.fn()
    render(
      <ProductForm
        mode="edit"
        role="admin"
        archived
        industryOptions={industryOptions}
        categoryOptions={[]}
        brandOptions={[]}
        initialValues={initialValues}
        onSubmit={onSubmit}
      />,
    )

    expect(screen.getByRole('alert')).toHaveTextContent('arquivado')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(onSubmit).not.toHaveBeenCalled()
  })
})

describe('product detail', () => {
  it('renders exact read-only values in responsive grouped sections without media controls', () => {
    render(<ProductDetail product={detailRecord} role="representative" />)

    expect(screen.getByRole('heading', { name: 'Desinfetante concentrado' })).toBeVisible()
    expect(screen.getByText('0.123456 kg')).toBeVisible()
    expect(screen.getByText('10.000001 × 20.000002 × 30.000003 cm')).toBeVisible()
    expect(screen.getByText('0.000000%')).toBeVisible()
    expect(screen.getByText('Própria do produto')).toBeVisible()
    expect(screen.getByTestId('product-detail-sections')).toHaveClass('grid-cols-1', 'lg:grid-cols-2')
    expect(screen.queryByText(/upload|imagem|mídia/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Editar produto|Arquivar produto/ })).not.toBeInTheDocument()
  })

  it('shows archived state, hides edit, and only exposes restore to an admin', () => {
    const onArchiveStateChange = vi.fn()
    render(
      <ProductDetail
        product={{
          ...detailRecord,
          isActive: false,
          archivedAt: '2026-08-17T14:00:00.000Z',
        }}
        role="admin"
        onEdit={vi.fn()}
        onArchiveStateChange={onArchiveStateChange}
      />,
    )

    expect(screen.getByText('Arquivado')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Editar produto' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Restaurar produto' }))
    expect(onArchiveStateChange).toHaveBeenCalledWith(detailRecord.id, false)
  })
})
