import { z } from 'zod'

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .trim()
    .min(1, 'DATABASE_URL is required')
    .refine(isPostgresUrl, 'DATABASE_URL must be a valid PostgreSQL URL'),
})

export type DatabaseConfig = Readonly<{
  url: string
}>

export function parseDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const result = databaseEnvironmentSchema.safeParse(environment)

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid server database configuration: ${details}`)
  }

  return Object.freeze({ url: result.data.DATABASE_URL })
}

function isPostgresUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (
      (url.protocol === 'postgres:' || url.protocol === 'postgresql:') &&
      url.hostname.length > 0 &&
      url.pathname.length > 1
    )
  } catch {
    return false
  }
}
