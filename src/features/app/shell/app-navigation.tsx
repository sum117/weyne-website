import { Link } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { House, List, Package, ShieldCheck } from '@phosphor-icons/react/dist/ssr'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { AppHeader } from '@/features/app/shell/app-header'
import { hasCapability, type Capability } from '@/lib/auth/capabilities'
import type { AppSession } from '@/lib/auth/contract'
import { cn } from '@/lib/cn'

type AppNavigationItem = Readonly<{
  capability?: Capability
  href: string
  icon: typeof House
  label: string
}>

const APP_NAVIGATION_ITEMS: readonly AppNavigationItem[] = [
  { href: '/app', icon: House, label: 'Início' },
  { capability: 'product.view', href: '/app/produtos', icon: Package, label: 'Produtos' },
  {
    capability: 'audit.view',
    href: '/app/configuracoes/auditoria',
    icon: ShieldCheck,
    label: 'Auditoria de atividades',
  },
]

function isAppNavigationItemActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== '/app' && pathname.startsWith(`${href}/`))
}

function AppNavigationLinks({
  pathname,
  role,
  onNavigate,
}: Readonly<{
  pathname: string
  role: AppSession['user']['role']
  onNavigate?: () => void
}>) {
  const items = APP_NAVIGATION_ITEMS.filter(
    (item) => !item.capability || hasCapability(role, item.capability),
  )

  return (
    <nav aria-label="Navegação principal do aplicativo">
      <ul className="space-y-1">
        {items.map((item) => {
          const active = isAppNavigationItemActive(pathname, item.href)
          const Icon = item.icon
          return (
            <li key={item.href}>
              <Link
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors ease-house focus-visible:ring-2 focus-visible:ring-sidebar-ring focus-visible:ring-offset-2 focus-visible:ring-offset-sidebar',
                  active
                    ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                    : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
                )}
                onClick={onNavigate}
                to={item.href}
              >
                <Icon aria-hidden="true" className="size-5 shrink-0" weight="light" />
                {item.label}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function AppNavigation({
  children,
  pathname,
  session,
}: Readonly<{
  children: ReactNode
  pathname: string
  session: AppSession
}>) {
  const [mobileNavigationOpen, setMobileNavigationOpen] = useState(false)

  useEffect(() => {
    setMobileNavigationOpen(false)
  }, [pathname])

  return (
    <Sheet open={mobileNavigationOpen} onOpenChange={setMobileNavigationOpen}>
      <div
        className="grid min-h-svh min-w-0 grid-cols-1 bg-background text-foreground nav:grid-cols-[16.5rem_minmax(0,1fr)]"
        data-app-shell
      >
        <aside
          className="hidden min-w-0 bg-sidebar text-sidebar-foreground nav:flex nav:flex-col"
          data-app-shell-sidebar
        >
          <div className="border-b border-sidebar-border p-5">
            <p className="font-display text-2xl leading-none">Weyne</p>
            <p className="mt-1 font-sans text-xs font-medium tracking-[0.16em] text-sidebar-muted-foreground uppercase">
              Representações
            </p>
          </div>
          <div className="min-w-0 p-3">
            <AppNavigationLinks pathname={pathname} role={session.user.role} />
          </div>
        </aside>

        <div className="flex min-w-0 flex-col" data-app-shell-content>
          <AppHeader
            navigationTrigger={
              <SheetTrigger asChild>
                <Button
                  aria-label="Abrir navegação"
                  className="size-11 shrink-0"
                  size="icon"
                  type="button"
                  variant="ghost"
                >
                  <List aria-hidden="true" className="size-5" weight="light" />
                </Button>
              </SheetTrigger>
            }
            pathname={pathname}
            session={session}
          />
          <main className="min-h-0 min-w-0 flex-1" id="app-main" tabIndex={-1}>
            {children}
          </main>
        </div>
      </div>

      <SheetContent
        side="left"
        className="w-[min(20rem,calc(100vw-2rem))] max-w-none gap-0 bg-sidebar p-0 text-sidebar-foreground nav:hidden"
      >
        <SheetHeader className="border-b border-sidebar-border pr-14">
          <SheetTitle className="text-sidebar-foreground">Navegação principal</SheetTitle>
          <SheetDescription className="text-sidebar-muted-foreground">
            Acesse as áreas disponíveis para seu perfil.
          </SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <AppNavigationLinks
            onNavigate={() => setMobileNavigationOpen(false)}
            pathname={pathname}
            role={session.user.role}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}

export { AppNavigation, AppNavigationLinks, isAppNavigationItemActive }
