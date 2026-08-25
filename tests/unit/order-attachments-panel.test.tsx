/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  OrderAttachmentsPanel,
  type OrderAttachmentCapabilitiesView,
} from '@/features/app/orders/order-attachments-panel'
import type { OrderAttachmentListItem } from '@/features/app/orders/order-attachment.functions'

const mocks = vi.hoisted(() => ({
  listOrderAttachments: vi.fn(),
  uploadOrderAttachment: vi.fn(),
  downloadOrderAttachment: vi.fn(),
  deleteOrderAttachment: vi.fn(),
}))

vi.mock('@/features/app/orders/order-attachment.functions', () => mocks)

const orderId = '00000000-0000-4000-8000-000000000010'

const fullCapabilities: OrderAttachmentCapabilitiesView = {
  canList: true,
  canDownload: true,
  canUpload: true,
  mayDeleteAny: true,
}

function attachment(
  overrides: Partial<OrderAttachmentListItem> = {},
): OrderAttachmentListItem {
  const createdAt = new Date('2026-08-20T12:00:00.000Z')
  return {
    id: '00000000-0000-4000-8000-000000000001',
    orderId,
    label: 'Pedido assinado',
    originalFilename: 'pedido-cliente.pdf',
    sizeBytes: 2048,
    validatedMimeType: 'application/pdf',
    checksumSha256: 'a'.repeat(43) + '=',
    createdBy: '00000000-0000-4000-8000-000000000002',
    createdAt,
    updatedAt: createdAt,
    deletedBy: null,
    deletedAt: null,
    state: 'ready',
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listOrderAttachments.mockResolvedValue({
    ok: true,
    attachments: [attachment()],
  })
})

afterEach(cleanup)

function renderPanel(capabilities: OrderAttachmentCapabilitiesView = fullCapabilities) {
  return render(<OrderAttachmentsPanel orderId={orderId} capabilities={capabilities} />)
}

describe('OrderAttachmentsPanel', () => {
  it('lists attachments with safe metadata and per-row actions', async () => {
    renderPanel()

    const label = await screen.findAllByText('Pedido assinado')
    expect(label.length).toBeGreaterThan(0)
    expect(screen.getByText(/pedido-cliente\.pdf/)).toBeInTheDocument()
    expect(screen.getByText(/2 kB/)).toBeInTheDocument()
    // No internal keys or checksums leak into the UI.
    expect(document.body.textContent).not.toMatch(/attachments\//)
    expect(screen.queryByText(/checksum/i)).not.toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Baixar Pedido assinado/ }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Remover Pedido assinado/ }),
    ).toBeInTheDocument()
  })

  it('renders nothing for actors without list capability from the server', async () => {
    mocks.listOrderAttachments.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', status: 403, message: 'negado' },
    })
    const { container } = renderPanel()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides actions that capabilities do not grant', async () => {
    renderPanel({
      canList: true,
      canDownload: false,
      canUpload: false,
      mayDeleteAny: false,
    })

    expect((await screen.findAllByText('Pedido assinado')).length).toBeGreaterThan(0)
    expect(screen.queryByRole('button', { name: /Baixar/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remover/ })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/Enviar anexo/i)).not.toBeInTheDocument()
  })

  it('shows a load-failure alert with a retry action', async () => {
    mocks.listOrderAttachments.mockResolvedValue({
      ok: false,
      error: { code: 'INTERNAL_ERROR', status: 500, message: 'falha' },
    })
    renderPanel()

    expect(await screen.findByText('Não foi possível carregar os anexos')).toBeInTheDocument()
    mocks.listOrderAttachments.mockResolvedValue({
      ok: true,
      attachments: [attachment()],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    expect((await screen.findAllByText('Pedido assinado')).length).toBeGreaterThan(0)
  })

  it('requires confirmation before deleting and refreshes afterwards', async () => {
    mocks.deleteOrderAttachment.mockResolvedValue({ ok: true })
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Remover Pedido assinado/ }))
    const dialog = screen.getByRole('alertdialog')
    expect(within(dialog).getByText(/Remover anexo?/)).toBeInTheDocument()

    fireEvent.click(
      within(dialog).getByRole('button', { name: 'Remover definitivamente' }),
    )
    await waitFor(() => expect(mocks.deleteOrderAttachment).toHaveBeenCalledOnce())
    expect(mocks.deleteOrderAttachment.mock.calls[0]?.[0].data.idempotencyKey).toBeTruthy()
    await waitFor(() => expect(mocks.listOrderAttachments).toHaveBeenCalledTimes(2))
  })

  it('rejects disallowed file types before any request', async () => {
    renderPanel()
    await screen.findAllByText('Pedido assinado')

    const input = document.querySelector('#order-attachment-upload') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['x'], 'evil.exe', { type: 'application/x-msdownload' })],
    })
    fireEvent.change(input)

    expect(await screen.findByText(/Tipo de arquivo não permitido/)).toBeInTheDocument()
    expect(mocks.uploadOrderAttachment).not.toHaveBeenCalled()
  })

  it('uploads allowed files with declarations and announces success', async () => {
    const created = attachment({ id: '00000000-0000-4000-8000-000000000099' })
    mocks.uploadOrderAttachment.mockResolvedValue({ ok: true, attachment: created })
    renderPanel()
    await screen.findAllByText('Pedido assinado')

    const input = document.querySelector('#order-attachment-upload') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['%PDF-1.7 test'], 'novo.pdf', { type: 'application/pdf' })],
    })
    fireEvent.change(input)

    await waitFor(() => expect(mocks.uploadOrderAttachment).toHaveBeenCalledOnce())
    const payload = mocks.uploadOrderAttachment.mock.calls[0]?.[0].data
    expect(payload.orderId).toBe(orderId)
    expect(payload.declaredMimeType).toBe('application/pdf')
    expect(payload.bytesBase64).toBe(btoa('%PDF-1.7 test'))
    expect(payload.idempotencyKey).toBeTruthy()
    await waitFor(() =>
      expect(
        screen.getByRole('status', { hidden: false }).textContent,
      ).toMatch(/enviado com sucesso/i),
    )
  })

  it('surfaces upload failures without duplicating records', async () => {
    mocks.uploadOrderAttachment.mockResolvedValue({
      ok: false,
      error: {
        code: 'FILE_TOO_LARGE',
        status: 413,
        message: 'Arquivo maior que o limite permitido.',
      },
    })
    renderPanel()
    await screen.findAllByText('Pedido assinado')

    const input = document.querySelector('#order-attachment-upload') as HTMLInputElement
    Object.defineProperty(input, 'files', {
      value: [new File(['%PDF-1.7 big'], 'grande.pdf', { type: 'application/pdf' })],
    })
    fireEvent.change(input)

    expect(
      await screen.findByText('Arquivo maior que o limite permitido.'),
    ).toBeInTheDocument()
    expect(mocks.listOrderAttachments).toHaveBeenCalledTimes(1)
  })

  it('streams downloads through the authorized endpoint into an object URL', async () => {
    const bytes = btoa('%PDF-1.7 download')
    mocks.downloadOrderAttachment.mockResolvedValue({
      ok: true,
      file: {
        bytesBase64: bytes,
        filename: 'pedido-cliente.pdf',
        contentType: 'application/pdf',
      },
    })
    let createdUrl = ''
    const revokeSpy = vi.fn()
    // jsdom lacks blob URL APIs; install stubs before rendering.
    const urlSpy = vi.fn((blob: Blob) => {
      createdUrl = `blob:mock-${blob.size}`
      return createdUrl
    })
    ;(globalThis.URL as unknown as Record<string, unknown>).createObjectURL = urlSpy
    ;(globalThis.URL as unknown as Record<string, unknown>).revokeObjectURL = revokeSpy
    const clickSpy = vi.fn()
    const realCreateElement = document.createElement.bind(document)
    const anchorSpy = vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag === 'a') {
        return {
          href: '',
          download: '',
          click: clickSpy,
        } as unknown as HTMLAnchorElement
      }
      return realCreateElement(tag)
    }) as typeof document.createElement)
    renderPanel()

    fireEvent.click(await screen.findByRole('button', { name: /Baixar Pedido assinado/ }))

    await waitFor(() => expect(clickSpy).toHaveBeenCalledOnce())
    expect(createdUrl.startsWith('blob:mock-')).toBe(true)
    expect(anchorSpy).toHaveBeenCalledWith('a')
    anchorSpy.mockRestore()
  })
})
