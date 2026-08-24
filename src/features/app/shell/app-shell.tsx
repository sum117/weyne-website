import { useEffect } from 'react'
import { useLocation } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { AppSession } from '@/lib/auth/contract'
import { AppNavigation } from './app-navigation'

function focusAppRouteContent() {
  const main = document.getElementById('app-main')
  const target = main?.querySelector<HTMLElement>('[data-app-route-focus], h1') ?? main

  if (!target) return

  target.tabIndex = -1
  target.focus({ preventScroll: true })
}

function focusAppMain() {
  const main = document.getElementById('app-main')

  if (!main) return

  main.tabIndex = -1
  main.focus({ preventScroll: true })
}

type AppShellProps = Readonly<{
  children: ReactNode
  session: AppSession
}>

/**
 * Structural boundary for every authenticated route.
 *
 * Navigation, contextual controls, and route states deliberately compose into
 * these named regions in later app-shell cards. Keeping this frame free of
 * route-specific data makes the public document layout entirely independent.
 */
export function AppShell({ children, session }: AppShellProps) {
  const pathname = useLocation({ select: (location) => location.pathname })

  useEffect(() => {
    focusAppRouteContent()
  }, [pathname])

  return (
    <>
      <a
        className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-skip focus:rounded-lg focus:bg-primary focus:px-4 focus:py-2 focus:font-medium focus:text-primary-foreground focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
        href="#app-main"
        onClick={focusAppMain}
      >
        Pular para o conteúdo principal
      </a>
      <AppNavigation pathname={pathname} session={session}>
        {children}
      </AppNavigation>
    </>
  )
}
