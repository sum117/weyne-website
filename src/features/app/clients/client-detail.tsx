import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  formatCep,
  formatCnpj,
  formatPhone,
} from '@/domain/primitives/brazilian'
import { formatCurrency } from '@/lib/intl/format'

export interface ClientAddress {
  street: string
  number: string
  complement?: string | null
  district: string
  city: string
  state: string
  postalCode: string
}

export interface ClientDetailRecord {
  id: string
  legalName: string
  tradeName?: string | null
  cnpj: string
  stateRegistration?: string | null
  status: 'active' | 'archived'
  segment?: string | null
  contactName?: string | null
  phone?: string | null
  whatsapp?: string | null
  email?: string | null
  address?: ClientAddress | null
  representativeName?: string | null
  creditLimit?: string | null
  notes?: string | null
}

export type ClientDetailState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'forbidden' }
  | { status: 'error'; message?: string }
  | { status: 'ready'; client: ClientDetailRecord }

export interface ClientDetailActions {
  /** Server-authorized capability projection; not an archive eligibility rule. */
  canEdit: boolean
  canArchive: boolean
}

export type ArchiveClientResult =
  | { ok: true }
  | {
      ok: false
      code: 'CONFLICT' | 'FORBIDDEN' | 'NOT_FOUND' | 'INTERNAL_ERROR'
      message?: string
    }

export interface ClientDetailProps {
  state: ClientDetailState
  actions: ClientDetailActions
  onRetry?: () => void
  onEdit?: (client: ClientDetailRecord) => void
  onArchive?: (client: ClientDetailRecord) => Promise<ArchiveClientResult>
  onArchived?: (client: ClientDetailRecord) => void
}

const archiveErrorMessages: Record<
  Exclude<ArchiveClientResult, { ok: true }>['code'],
  string
> = {
  CONFLICT: 'Este cliente não pode ser arquivado no estado atual.',
  FORBIDDEN: 'Você não tem permissão para arquivar este cliente.',
  NOT_FOUND: 'Este cliente não está mais disponível.',
  INTERNAL_ERROR: 'Não foi possível arquivar o cliente.',
}

function DetailItem({ label, value }: { label: string; value?: string | null }) {
  if (!value) return null

  return (
    <div className="min-w-0">
      <dt className="font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase">
        {label}
      </dt>
      <dd className="mt-1 break-words font-sans text-sm text-ink">{value}</dd>
    </div>
  )
}

function ClientDetailUnavailable({
  state,
  onRetry,
}: {
  state: Exclude<ClientDetailState, { status: 'ready' }>
  onRetry?: () => void
}) {
  if (state.status === 'loading') {
    return (
      <section
        className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"
        aria-busy="true"
        aria-live="polite"
      >
        <p className="sr-only">Carregando dados do cliente</p>
        <Skeleton className="h-16 w-full max-w-xl" />
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </section>
    )
  }

  const copy = {
    'not-found': {
      title: 'Cliente não encontrado',
      description: 'O registro pode ter sido removido ou o endereço está incorreto.',
    },
    forbidden: {
      title: 'Acesso não autorizado',
      description: 'Você não tem permissão para consultar este cliente.',
    },
    error: {
      title: 'Não foi possível carregar o cliente',
      description: state.status === 'error' && state.message
        ? state.message
        : 'Tente novamente em alguns instantes.',
    },
  }[state.status]

  return (
    <section className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6">
      <Alert variant="destructive" role="alert">
        <AlertTitle>{copy.title}</AlertTitle>
        <AlertDescription>
          <p>{copy.description}</p>
          {state.status === 'error' && onRetry && (
            <button
              type="button"
              className="mt-3 min-h-11 rounded-lg border border-current px-4 font-sans font-semibold outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onClick={onRetry}
            >
              Tentar novamente
            </button>
          )}
        </AlertDescription>
      </Alert>
    </section>
  )
}

function ArchiveClientDialog({
  client,
  onArchive,
  onArchived,
}: {
  client: ClientDetailRecord
  onArchive?: (client: ClientDetailRecord) => Promise<ArchiveClientResult>
  onArchived?: (client: ClientDetailRecord) => void
}) {
  const displayName = client.tradeName || client.legalName
  const [open, setOpen] = useState(false)
  const [isPending, setIsPending] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  async function submitArchive() {
    if (isPending || !onArchive) return

    setErrorMessage(null)
    setIsPending(true)
    try {
      const result = await onArchive(client)
      if (result.ok) {
        setOpen(false)
        onArchived?.(client)
      } else {
        setErrorMessage(result.message || archiveErrorMessages[result.code])
      }
    } catch {
      setErrorMessage(archiveErrorMessages.INTERNAL_ERROR)
    } finally {
      setIsPending(false)
    }
  }

  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) {
          setOpen(nextOpen)
          if (nextOpen) setErrorMessage(null)
        }
      }}
    >
      <AlertDialog.Trigger asChild>
        <button
          type="button"
          className="min-h-11 rounded-lg border border-destructive px-4 font-sans text-sm font-semibold text-destructive outline-hidden transition hover:bg-destructive-surface focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Arquivar cliente
        </button>
      </AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-overlay bg-navy/45 backdrop-blur-[2px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <AlertDialog.Content className="fixed top-1/2 left-1/2 z-overlay max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 overflow-y-auto overscroll-contain rounded-2xl border border-line bg-white p-6 shadow-form outline-hidden sm:p-8">
          <AlertDialog.Title className="font-display text-2xl text-navy">
            Arquivar {displayName}?
          </AlertDialog.Title>
          <AlertDialog.Description className="mt-3 font-sans text-sm leading-relaxed text-muted">
            O cliente deixará de aparecer nas listas de clientes ativos. Esta ação
            não apaga o histórico do registro.
          </AlertDialog.Description>
          {errorMessage && (
            <div
              role="alert"
              className="mt-4 rounded-lg border border-destructive-border bg-destructive-surface p-3 font-sans text-sm text-destructive-surface-foreground"
            >
              {errorMessage}
            </div>
          )}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <AlertDialog.Cancel asChild>
              <button
                type="button"
                className="min-h-11 rounded-lg border border-line px-4 font-sans text-sm font-semibold text-navy outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              >
                Cancelar
              </button>
            </AlertDialog.Cancel>
            <button
              type="button"
              className="min-h-11 rounded-lg bg-destructive px-4 font-sans text-sm font-semibold text-destructive-foreground outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-60"
              disabled={isPending || !onArchive}
              aria-busy={isPending}
              onClick={() => void submitArchive()}
            >
              {isPending ? 'Arquivando…' : 'Confirmar arquivamento'}
            </button>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}

export function ClientDetail({
  state,
  actions,
  onRetry,
  onEdit,
  onArchive,
  onArchived,
}: ClientDetailProps) {
  if (state.status !== 'ready') {
    return <ClientDetailUnavailable state={state} onRetry={onRetry} />
  }

  const { client } = state
  const displayName = client.tradeName || client.legalName
  const address = client.address

  return (
    <article className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="font-sans text-sm font-semibold text-blue">Cliente</p>
          <h1 className="mt-1 break-words font-display text-3xl leading-tight text-navy sm:text-4xl">
            {displayName}
          </h1>
          {client.tradeName && (
            <p className="mt-2 font-sans text-sm text-muted">{client.legalName}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3 sm:justify-end">
          <Badge variant={client.status === 'active' ? 'success' : 'neutral'}>
            {client.status === 'active' ? 'Ativo' : 'Arquivado'}
          </Badge>
          {actions.canEdit && (
            <button
              type="button"
              className="min-h-11 rounded-lg border border-line px-4 font-sans text-sm font-semibold text-navy outline-hidden transition hover:bg-paper focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => onEdit?.(client)}
            >
              Editar cliente
            </button>
          )}
          {actions.canArchive && (
            <ArchiveClientDialog
              client={client}
              onArchive={onArchive}
              onArchived={onArchived}
            />
          )}
        </div>
      </header>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="border-line bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-navy">Identificação</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              <DetailItem label="CNPJ" value={formatCnpj(client.cnpj)} />
              <DetailItem label="Inscrição estadual" value={client.stateRegistration} />
              <DetailItem label="Segmento" value={client.segment} />
              <DetailItem label="Representante" value={client.representativeName} />
              <DetailItem
                label="Limite de crédito"
                value={
                  client.creditLimit
                    ? formatCurrency(Number(client.creditLimit))
                    : null
                }
              />
            </dl>
          </CardContent>
        </Card>

        <Card className="border-line bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="font-display text-xl text-navy">Contato</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2">
              <DetailItem label="Contato principal" value={client.contactName} />
              <DetailItem
                label="Telefone"
                value={client.phone ? formatPhone(client.phone) : null}
              />
              <DetailItem
                label="WhatsApp"
                value={client.whatsapp ? formatPhone(client.whatsapp) : null}
              />
              <DetailItem label="E-mail" value={client.email} />
            </dl>
          </CardContent>
        </Card>

        {address && (
          <Card className="border-line bg-white shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-xl text-navy">Endereço</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                <DetailItem label="Logradouro" value={`${address.street}, ${address.number}`} />
                <DetailItem label="Complemento" value={address.complement} />
                <DetailItem label="Bairro" value={address.district} />
                <DetailItem label="Cidade/UF" value={`${address.city}/${address.state}`} />
                <DetailItem label="CEP" value={formatCep(address.postalCode)} />
              </dl>
            </CardContent>
          </Card>
        )}

        {client.notes && (
          <Card className="border-line bg-white shadow-sm lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-xl text-navy">Observações</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink">
                {client.notes}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </article>
  )
}
