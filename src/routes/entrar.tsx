import { createFileRoute, redirect, useRouter } from '@tanstack/react-router'
import { LoginForm } from '@/features/app/auth/login-form'
import { fetchAppSession } from '@/features/app/auth/session.functions'
import {
  DEFAULT_AUTHENTICATED_PATH,
  sanitizeRedirectPath,
} from '@/lib/auth/contract'

/**
 * Credential login page.
 *
 * `beforeLoad` runs on the server for a direct request and on the client for
 * an in-app navigation, so an already-authenticated visitor never sees the
 * form. The `redirect` search value is sanitized to a same-origin path before
 * it is ever used, closing the open-redirect hole a raw `location.href`
 * round-trip would otherwise open.
 */
export const Route = createFileRoute('/entrar')({
  // `redirect` stays absent when it was absent: emitting a default here would
  // make a bare `/entrar` visit redirect to itself just to canonicalize the
  // URL. The target is resolved at the point of use instead.
  validateSearch: (search: Record<string, unknown>) =>
    search.redirect === undefined
      ? {}
      : { redirect: sanitizeRedirectPath(search.redirect) },
  beforeLoad: async ({ search }) => {
    const session = await fetchAppSession()
    if (session) {
      throw redirect({ to: search.redirect ?? DEFAULT_AUTHENTICATED_PATH })
    }
  },
  head: () => ({
    meta: [
      { title: 'Entrar | Weyne Representações' },
      { name: 'robots', content: 'noindex, nofollow' },
    ],
  }),
  component: LoginPage,
})

function LoginPage() {
  const target = Route.useSearch().redirect ?? DEFAULT_AUTHENTICATED_PATH
  const router = useRouter()

  return (
    <main className="grid min-h-screen place-items-center bg-paper px-6 py-16">
      <section className="min-w-0 w-full max-w-md rounded-3xl border border-line bg-white p-6 shadow-card sm:p-10">
        <p className="font-sans text-sm font-semibold tracking-[0.16em] text-blue uppercase">
          Área de gestão
        </p>
        <h1 className="mt-4 break-words font-display text-3xl leading-tight text-navy">
          Entrar
        </h1>
        <p className="mt-3 mb-8 font-sans text-base leading-relaxed text-muted">
          Use as credenciais fornecidas pela administração.
        </p>
        <LoginForm
          onAuthenticated={async () => {
            // Drop every cached route match before navigating: loaders that
            // ran while anonymous must not be reused now that a session
            // exists.
            await router.invalidate()
            await router.navigate({ to: target, replace: true })
          }}
        />
      </section>
    </main>
  )
}
