import { createServerFn } from '@tanstack/react-start'
import { z } from 'zod'

import type { createAuth } from './auth'

type Auth = ReturnType<typeof createAuth>

const authenticatedProfileInput = z.object({ cookie: z.string().min(1) })

export function createAuthenticatedProfileServerFn(auth: Auth) {
  return createServerFn({ method: 'GET' })
    .validator(authenticatedProfileInput)
    .handler(async ({ data }) => {
      const session = await auth.api.getSession({
        headers: new Headers({ cookie: data.cookie }),
      })
      if (!session) throw new Error('Authentication required')

      return {
        email: session.user.email,
        userId: session.user.id,
      }
    })
}
