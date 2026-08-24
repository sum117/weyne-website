import { Link } from '@tanstack/react-router'
import { useState, type ReactNode } from 'react'
import { SignOut, UserCircle } from '@phosphor-icons/react/dist/ssr'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Button } from '@/components/ui/button'
import {
  type SignOutButtonProps,
  useSignOut,
} from '@/features/app/auth/sign-out-button'
import type { AppSession } from '@/lib/auth/contract'

export type AppBreadcrumb = Readonly<{
  href?: string
  label: string
}>

const BREADCRUMB_BY_PATH: Readonly<Record<string, readonly AppBreadcrumb[]>> = {
  '/app': [{ label: 'Início' }],
  '/app/padroes': [
    { href: '/app', label: 'Início' },
    { label: 'Padrões compartilhados' },
  ],
  '/app/produtos': [
    { href: '/app', label: 'Início' },
    { label: 'Produtos' },
  ],
  '/app/relatorios': [
    { href: '/app', label: 'Início' },
    { label: 'Relatórios' },
  ],
  '/app/configuracoes/auditoria': [
    { href: '/app', label: 'Início' },
    { label: 'Configurações' },
    { label: 'Auditoria de atividades' },
  ],
}

const ROLE_LABELS = {
  admin: 'Administrador(a)',
  representative: 'Representante',
  read_only: 'Consulta',
} as const satisfies Record<AppSession['user']['role'], string>

function normalizePathname(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith('/')) return pathname.slice(0, -1)
  return pathname
}

/**
 * Maps every currently registered application route to a human-readable
 * location trail. Unknown future routes still retain a meaningful app-home
 * fallback instead of exposing a filesystem segment as user-facing copy.
 */
export function getAppBreadcrumbs(pathname: string): readonly AppBreadcrumb[] {
  const normalizedPathname = normalizePathname(pathname)
  return BREADCRUMB_BY_PATH[normalizedPathname] ?? [
    { href: '/app', label: 'Início' },
    { label: 'Área de gestão' },
  ]
}

function accountInitials(user: AppSession['user']): string {
  const words = user.name.trim().split(/\s+/).filter(Boolean)
  if (words.length > 0) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join('')
      .toLocaleUpperCase('pt-BR')
  }
  return user.email.slice(0, 1).toLocaleUpperCase('pt-BR')
}

type AppHeaderProps = Readonly<{
  /** A navigation card owns the real Sheet trigger and supplies it here. */
  navigationTrigger?: ReactNode
  pathname: string
  session: AppSession
}> &
  Pick<SignOutButtonProps, 'navigate' | 'signOut'>

export function AppHeader({
  navigate,
  navigationTrigger,
  pathname,
  session,
  signOut: signOutRequest,
}: AppHeaderProps) {
  const breadcrumbs = getAppBreadcrumbs(pathname)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const { pending, signOut } = useSignOut({ navigate, signOut: signOutRequest })

  return (
    <header
      aria-label="Contexto do aplicativo"
      className="flex h-14 min-w-0 items-center gap-2 border-b border-border bg-card px-4 nav:h-16 nav:px-6"
      data-app-shell-context
    >
      {navigationTrigger ? (
        <div className="contents nav:hidden" data-app-navigation-trigger-slot>
          {navigationTrigger}
        </div>
      ) : null}

      <nav aria-label="Localização atual" className="min-w-0 flex-1 overflow-hidden">
        <ol className="flex min-w-0 items-center gap-1.5 overflow-hidden text-sm text-muted-foreground">
          {breadcrumbs.map((breadcrumb, index) => {
            const isCurrent = index === breadcrumbs.length - 1
            return (
              <li
                key={`${breadcrumb.href ?? 'current'}-${breadcrumb.label}`}
                className="min-w-0 truncate"
              >
                {index > 0 ? <span aria-hidden="true" className="mr-1.5">/</span> : null}
                {breadcrumb.href && !isCurrent ? (
                  <Link
                    className="rounded-sm transition-colors ease-house hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                    to={breadcrumb.href}
                  >
                    {breadcrumb.label}
                  </Link>
                ) : (
                  <span
                    aria-current={isCurrent ? 'page' : undefined}
                    className={isCurrent ? 'font-medium text-foreground' : undefined}
                    title={breadcrumb.label}
                  >
                    {breadcrumb.label}
                  </span>
                )}
              </li>
            )
          })}
        </ol>
      </nav>

      <DropdownMenu open={accountMenuOpen} onOpenChange={setAccountMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={`Abrir menu da conta de ${session.user.name}`}
            className="shrink-0 px-2 sm:px-3"
            size="default"
            type="button"
            variant="ghost"
          >
            <span
              aria-hidden="true"
              className="grid size-7 place-items-center rounded-full bg-secondary text-xs font-semibold text-secondary-foreground"
            >
              {accountInitials(session.user)}
            </span>
            <span className="hidden max-w-40 truncate text-left sm:block">
              {session.user.name}
            </span>
            <UserCircle aria-hidden="true" className="size-4 sm:hidden" weight="light" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-68">
          <DropdownMenuLabel className="space-y-0.5 p-2">
            <p className="truncate text-sm font-semibold text-foreground">{session.user.name}</p>
            <p className="truncate text-xs font-normal text-muted-foreground">{session.user.email}</p>
            <p className="text-xs font-medium text-muted-foreground">{ROLE_LABELS[session.user.role]}</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={pending}
            onSelect={() => {
              setAccountMenuOpen(false)
              void signOut()
            }}
          >
            <SignOut aria-hidden="true" className="size-4" weight="light" />
            {pending ? 'Saindo…' : 'Sair'}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  )
}
