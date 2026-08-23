import { createFileRoute, Link } from '@tanstack/react-router'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { getRuntimeStatus } from '@/features/app/runtime-status'
import { requireAuthenticatedRoute } from '@/features/app/auth/route-guard'
import { SignOutButton } from '@/features/app/auth/sign-out-button'

/**
 * Search contract for the authenticated app home.
 *
 * `negado` is set by `requireCapableRoute` when a capability-gated route
 * bounces the visitor here: the shell acknowledges the denial in pt-BR and
 * moves on instead of rendering a dead end. It is presentation state only —
 * no server code reads it and no authorization decision derives from it.
 */
function validateAppSearch(search: Record<string, unknown>): { negado?: string } {
  return typeof search.negado === 'string' && search.negado.length > 0
    ? { negado: search.negado }
    : {}
}

export const Route = createFileRoute('/app')({
  validateSearch: validateAppSearch,
  beforeLoad: ({ location }) => requireAuthenticatedRoute(location),
  loader: () => getRuntimeStatus(),
  head: () => ({
    meta: [
      { title: 'Área de gestão | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: AppPage,
})

const DENIED_CAPABILITY_LABELS: Record<string, string> = {
  'audit.view': 'Auditoria de atividades',
  'settings.read': 'Configurações',
  'settings.update': 'Configurações',
}

function deniedSectionLabel(capability: string): string | null {
  return DENIED_CAPABILITY_LABELS[capability] ?? null
}

function AppPage() {
  const status = Route.useLoaderData()
  const { session } = Route.useRouteContext()
  const { negado } = Route.useSearch()
  const deniedSection = negado ? deniedSectionLabel(negado) : null

  return (
    <main className="grid min-h-screen place-items-center bg-off-white px-6 py-16">
      <section className="min-w-0 w-full max-w-xl rounded-3xl border border-line bg-white p-6 shadow-card sm:p-10">
        <p className="font-sans text-sm font-semibold tracking-[0.16em] text-blue uppercase">
          Área de gestão
        </p>
        <h1 className="mt-4 break-words font-display text-3xl leading-tight text-navy sm:text-4xl">
          Weyne Representações
        </h1>
        {deniedSection ? (
          <Alert className="mt-5" role="alert">
            <AlertTitle>Acesso não permitido</AlertTitle>
            <AlertDescription>
              Seu perfil não tem acesso à seção {deniedSection}. Se você precisa
              deste acesso, fale com um administrador.
            </AlertDescription>
          </Alert>
        ) : (
          <p className="mt-5 font-sans text-base leading-relaxed text-muted">
            {status.message}. A estrutura está pronta para receber os módulos
            autenticados.
          </p>
        )}
        <p
          className="mt-3 break-all font-sans text-sm text-muted"
          data-server-rendered-at={status.renderedAt}
        >
          Resposta SSR gerada em {status.renderedAt}.
        </p>
        <p className="mt-3 break-words font-sans text-sm text-muted" data-session-email>
          Sessão ativa: {session.user.email}.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link
            to="/"
            className="inline-flex min-h-11 items-center font-sans font-semibold text-blue underline decoration-sand decoration-2 underline-offset-4"
          >
            Voltar ao site institucional
          </Link>
          <Link
            to="/app/padroes"
            className="inline-flex min-h-11 items-center font-sans font-semibold text-blue underline decoration-sand decoration-2 underline-offset-4"
          >
            Ver padrões compartilhados
          </Link>
          <SignOutButton />
        </div>
      </section>
    </main>
  )
}
