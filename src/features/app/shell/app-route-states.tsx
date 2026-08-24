import { useEffect, useRef, type ReactNode } from 'react'
import { WarningCircle } from '@phosphor-icons/react/dist/ssr'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

type AppRouteErrorProps = Readonly<{
  error: unknown
  reset: () => void
}>

function useRouteStateHeadingFocus() {
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])

  return headingRef
}

function RouteStateFrame({
  children,
  busy = false,
}: Readonly<{
  children: ReactNode
  busy?: boolean
}>) {
  return (
    <main
      aria-busy={busy || undefined}
      className="min-w-0 flex-1 bg-background px-4 py-8 sm:px-6 nav:px-8"
      id="app-main"
    >
      <div className="mx-auto w-full max-w-3xl">{children}</div>
    </main>
  )
}

export function AppRoutePending() {
  const headingRef = useRouteStateHeadingFocus()

  return (
    <RouteStateFrame busy>
      <section aria-busy="true" aria-labelledby="app-route-pending-heading" role="status">
        <h1
          ref={headingRef}
          className="font-display text-3xl leading-tight text-foreground sm:text-4xl"
          data-app-route-focus
          id="app-route-pending-heading"
          tabIndex={-1}
        >
          Carregando página
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Estamos preparando o conteúdo solicitado.
        </p>
        <div aria-hidden="true" className="mt-8 space-y-4">
          <Skeleton className="h-7 w-2/5" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-4/5" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-28" />
            <Skeleton className="h-28" />
          </div>
        </div>
      </section>
    </RouteStateFrame>
  )
}

export function AppRouteError({ error: _error, reset }: AppRouteErrorProps) {
  const headingRef = useRouteStateHeadingFocus()

  return (
    <RouteStateFrame>
      <Alert className="max-w-2xl" role="alert">
        <WarningCircle aria-hidden="true" className="size-5" weight="light" />
        <h1
          ref={headingRef}
          className="col-start-2 font-display text-3xl leading-tight text-foreground sm:text-4xl"
          data-app-route-focus
          tabIndex={-1}
        >
          Não foi possível carregar esta página
        </h1>
        <AlertDescription className="mt-2 space-y-5">
          <p>Tente novamente. Se o problema continuar, atualize a página ou fale com o suporte.</p>
          <Button onClick={reset} type="button" variant="outline">
            Tentar novamente
          </Button>
        </AlertDescription>
      </Alert>
    </RouteStateFrame>
  )
}

export function AppRouteNotFound() {
  const headingRef = useRouteStateHeadingFocus()

  return (
    <RouteStateFrame>
      <section className="max-w-2xl rounded-lg border border-border bg-card p-6 sm:p-8">
        <p className="text-sm font-semibold tracking-[0.16em] text-primary uppercase">Área de gestão</p>
        <h1
          ref={headingRef}
          className="mt-4 font-display text-3xl leading-tight text-foreground sm:text-4xl"
          data-app-route-focus
          tabIndex={-1}
        >
          Página não encontrada
        </h1>
        <p className="mt-3 text-muted-foreground">
          O endereço informado não corresponde a uma página disponível nesta área.
        </p>
        <a
          className="mt-6 inline-flex min-h-11 items-center rounded-md font-semibold text-primary underline decoration-secondary decoration-2 underline-offset-4 focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          href="/app"
        >
          Voltar ao início da área de gestão
        </a>
      </section>
    </RouteStateFrame>
  )
}
