import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { expect, request } from '@playwright/test'
import {
  AUTHENTICATED_SHELL_BASE_URL,
  AUTHENTICATED_SHELL_USERS,
} from './authenticated-shell.fixture'

const storageStatePath = resolve(process.cwd(), 'test-results', 'authenticated-shell-admin.json')

export default async function globalSetup() {
  await mkdir(resolve(process.cwd(), 'test-results'), { recursive: true })

  const context = await request.newContext({
    baseURL: AUTHENTICATED_SHELL_BASE_URL,
    extraHTTPHeaders: { origin: AUTHENTICATED_SHELL_BASE_URL },
  })
  try {
    const response = await context.post('/api/auth/sign-in/email', {
      data: {
        email: AUTHENTICATED_SHELL_USERS.admin.email,
        password: AUTHENTICATED_SHELL_USERS.admin.password,
      },
    })
    expect(response.status()).toBe(200)
    await context.storageState({ path: storageStatePath })
  } finally {
    await context.dispose()
  }
}

export { storageStatePath }
