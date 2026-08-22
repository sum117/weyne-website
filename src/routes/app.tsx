import { createFileRoute, Link } from '@tanstack/react-router'
import { getRuntimeStatus } from '@/features/app/runtime-status'
import { requireAuthenticatedRoute } from '@/features/app/auth/route-guard'
import { SignOutButton } from '@/features/app/auth/sign-out-button'

export const Route = createFileRoute('/app')({
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

function AppPage() {
  const status = Route.useLoaderData()
  const { session } = Route.useRouteContext()

  return (
    <main className="grid min-h-screen place-items-center bg-off-white px-6 py-16">
      <section className="min-w-0 w-full max-w-xl rounded-3xl border border-line bg-white p-6 shadow-card sm:p-10">
        <p className="font-sans text-sm font-semibold tracking-[0.16em] text-blue uppercase">
          Área de gestão
        </p>
        <h1 className="mt-4 break-words font-display text-3xl leading-tight text-navy sm:text-4xl">
          Weyne Representações
        </h1>
        <p className="mt-5 font-sans text-base leading-relaxed text-muted">
          {status.message}. A estrutura está pronta para receber os módulos
          autenticados.
        </p>
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
