import { useState } from 'react'
import { useRouter } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { signOutCurrentSession } from './login.functions'
import { LOGIN_PATH } from '@/lib/auth/contract'

/**
 * Logout control.
 *
 * The server function revokes the session row and returns the expired
 * cookie; the browser then reloads the document at the login page. The full
 * reload matters: it drops every cached loader result and every piece of
 * in-memory router state built while the session existed, so nothing from
 * the authenticated view survives in the tab.
 */
export type SignOutButtonProps = Readonly<{
  /** Injected in tests; defaults to the real server function. */
  signOut?: typeof signOutCurrentSession
  /** Injected in tests; defaults to a full document navigation. */
  navigate?: (path: string) => void
}>

export function SignOutButton({
  signOut = signOutCurrentSession,
  navigate,
}: SignOutButtonProps = {}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      disabled={pending}
      onClick={() => {
        setPending(true)
        void (async () => {
          try {
            await signOut()
          } catch {
            // A transport failure must not strand the visitor inside the
            // application. The server-side session may or may not survive,
            // so leaving is the safe outcome either way: the guard will
            // re-check the cookie on the next request.
          }
          await router.invalidate()
          if (navigate) navigate(LOGIN_PATH)
          else window.location.assign(LOGIN_PATH)
        })()
      }}
    >
      {pending ? 'Saindo…' : 'Sair'}
    </Button>
  )
}
