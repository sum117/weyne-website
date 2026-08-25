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

/**
 * Shares the session termination sequence between button and menu controls.
 *
 * Consumers may safely close their overlay before invoking `signOut`; the
 * document redirect remains intentionally full-page after invalidation.
 */
export function useSignOut({
  signOut = signOutCurrentSession,
  navigate,
}: SignOutButtonProps = {}) {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  const terminateSession = async () => {
    if (pending) return
    setPending(true)
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
  }

  return { pending, signOut: terminateSession }
}

export function SignOutButton(props: SignOutButtonProps = {}) {
  const { pending, signOut } = useSignOut(props)

  return (
    <Button
      type="button"
      variant="ghost"
      size="default"
      disabled={pending}
      onClick={() => void signOut()}
    >
      {pending ? 'Saindo…' : 'Sair'}
    </Button>
  )
}
