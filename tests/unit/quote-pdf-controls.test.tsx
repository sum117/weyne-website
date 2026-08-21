/** @vitest-environment jsdom */
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  QuotePdfControls,
  type QuotePdfStatusView,
} from '@/features/app/quotes/quote-pdf-controls'

const mocks = vi.hoisted(() => ({
  pollQuotePdfStatus: vi.fn(),
  requestQuotePdfGeneration: vi.fn(),
  previewQuotePdf: vi.fn(),
  downloadQuotePdf: vi.fn(),
}))

vi.mock('@/features/app/quotes/quote-pdf.functions', () => mocks)

const identity = {
  quoteId: '00000000-0000-4000-8000-000000000001',
  snapshotId: '00000000-0000-4000-8000-000000000002',
  snapshotVersion: 3,
  templateId: '00000000-0000-4000-8000-000000000003',
  templateVersion: 2,
}

const completed: QuotePdfStatusView = {
  kind: 'completed',
  artifactId: 'artifact-1',
  snapshotVersion: 3,
  templateVariant: 'commercial',
  sizeBytes: 2048,
  pageCount: 2,
  outputChecksum: 'a'.repeat(64),
  completedAt: '2026-08-21T12:00:00.000Z',
}

afterEach(cleanup)

function renderControls(
  overrides: Partial<Parameters<typeof QuotePdfControls>[0]> = {},
) {
  return render(
    <QuotePdfControls
      identity={identity}
      versionLabel="Revisão 3"
      capabilities={{ canDownload: true, canRegenerate: true }}
      {...overrides}
    />,
  )
}

describe('QuotePdfControls', () => {
  it('shows preview and download actions for a completed artifact', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({ ok: true, status: completed })
    renderControls()

    expect(await screen.findByRole('button', { name: /Visualizar PDF/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Baixar PDF/ })).toBeInTheDocument()
    expect(screen.getByText(/2 páginas/)).toBeInTheDocument()
    expect(screen.getByText(/revisão 3/i)).toBeInTheDocument()
  })

  it('renders nothing for unauthorized actors instead of disabled controls', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({
      ok: false,
      error: { code: 'FORBIDDEN', status: 403, message: 'negado' },
    })
    const { container } = renderControls()
    await waitFor(() => expect(container).toBeEmptyDOMElement())
  })

  it('hides regeneration controls when the capability is absent', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({ ok: true, status: completed })
    renderControls({ capabilities: { canDownload: true, canRegenerate: false } })

    expect(await screen.findByRole('button', { name: /Baixar PDF/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Gerar/ })).not.toBeInTheDocument()
  })

  it('polls while generating and stops once completed', async () => {
    mocks.pollQuotePdfStatus
      .mockResolvedValueOnce({
        ok: true,
        status: {
          kind: 'generating',
          artifactId: 'artifact-1',
          attemptCount: 1,
          startedAt: '2026-08-21T12:00:00.000Z',
        } satisfies QuotePdfStatusView,
      })
      .mockResolvedValue({ ok: true, status: completed })
    renderControls({ pollIntervalMs: 5 })
    expect(await screen.findByText(/Gerando o documento/)).toBeInTheDocument()
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Visualizar PDF/ })).toBeInTheDocument(),
      { timeout: 2_000 },
    )
    expect(mocks.pollQuotePdfStatus.mock.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('offers retry after a failed generation with an actionable message', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({
      ok: true,
      status: {
        kind: 'failed',
        artifactId: 'artifact-1',
        attemptCount: 1,
        errorCode: 'render_timeout',
        message: 'PDF rendering exceeded the configured time limit',
        retryable: true,
      } satisfies QuotePdfStatusView,
    })
    mocks.requestQuotePdfGeneration.mockResolvedValue({ ok: true, status: completed })
    renderControls()

    expect(await screen.findByText('A geração do PDF falhou')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }))
    await waitFor(() =>
      expect(mocks.requestQuotePdfGeneration).toHaveBeenCalledOnce(),
    )
  })

  it('prevents duplicate submissions while a request is active', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({ ok: true, status: completed })
    vi.stubGlobal('URL', {
      ...URL,
      createObjectURL: vi.fn(() => 'blob:mock'),
      revokeObjectURL: vi.fn(),
    })
    let resolveDownload: (value: unknown) => void = () => undefined
    mocks.downloadQuotePdf.mockReturnValue(
      new Promise((resolve) => {
        resolveDownload = resolve
      }),
    )
    renderControls()

    const download = await screen.findByRole('button', { name: /Baixar PDF/ })
    fireEvent.click(download)
    expect(download).toBeDisabled()
    resolveDownload({
      ok: true,
      file: {
        bytes: btoa('%PDF-1.7'),
        filename: 'ORC-2026-000123-v3-comercial.pdf',
        contentType: 'application/pdf',
      },
    })
    await waitFor(() => expect(download).not.toBeDisabled())
    expect(mocks.downloadQuotePdf).toHaveBeenCalledOnce()
    vi.unstubAllGlobals()
  })

  it('surfaces storage errors through the retryable error alert', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({
      ok: false,
      error: { code: 'STORAGE_UNAVAILABLE', status: 503, message: 'indisponível', retryable: true },
    })
    renderControls()

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Não foi possível concluir a operação',
    )
    expect(screen.getByRole('button', { name: 'Tentar novamente' })).toBeInTheDocument()
  })

  it('keeps the historical version disclaimer so old PDFs are not mistaken for current state', async () => {
    mocks.pollQuotePdfStatus.mockResolvedValue({ ok: true, status: completed })
    renderControls()

    expect(await screen.findByText(/não refletem edições posteriores/)).toBeInTheDocument()
  })
})
