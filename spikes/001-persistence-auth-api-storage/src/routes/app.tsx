import { createServerFn } from '@tanstack/react-start'
import { getRequestHeaders } from '@tanstack/react-start/server'
import { createFileRoute } from '@tanstack/react-router'

import { auth } from '../../auth.config'

const getAuthenticatedProfile = createServerFn({ method: 'GET' }).handler(
  async () => {
    const session = await auth.api.getSession({ headers: getRequestHeaders() })
    if (!session) throw new Error('Authentication required')
    return { email: session.user.email, userId: session.user.id }
  },
)

export const Route = createFileRoute('/app')({
  component: AppPage,
  loader: () => getAuthenticatedProfile(),
})

function AppPage() {
  const profile = Route.useLoaderData()
  return <main data-user-id={profile.userId}>Authenticated: {profile.email}</main>
}
