import { z } from 'zod'

/**
 * Runtime pool bounds for the process-wide postgres.js client.
 *
 * Conservative single-process defaults for the dedicated VPS deployment
 * (one app container; PostgreSQL runs beside it with the default 100-slot
 * max_connections). Every value is overridable by environment so operations
 * can retune without a rebuild; see docs/operations/ssr-runtime.md.
 */
const DEFAULT_POOL_MAX = 10
const DEFAULT_IDLE_TIMEOUT_SECONDS = 30
const DEFAULT_CONNECT_TIMEOUT_SECONDS = 10
const DEFAULT_STATEMENT_TIMEOUT_MS = 30_000
const DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS = 15_000

const positiveInt = (max: number) =>
  z.coerce
    .number()
    .int()
    .min(1)
    .max(max)

const databaseEnvironmentSchema = z.object({
  DATABASE_URL: z
    .string({ error: 'DATABASE_URL is required' })
    .trim()
    .min(1, 'DATABASE_URL is required')
    .refine(isPostgresUrl, 'DATABASE_URL must be a valid PostgreSQL URL'),
  // Pool sizing and timeouts are seconds for postgres.js, milliseconds for
  // server-side statement guards; units are called out per field.
  WEYNE_DB_POOL_MAX: positiveInt(100).default(DEFAULT_POOL_MAX),
  WEYNE_DB_IDLE_TIMEOUT_SECONDS: positiveInt(3600).default(
    DEFAULT_IDLE_TIMEOUT_SECONDS,
  ),
  WEYNE_DB_CONNECT_TIMEOUT_SECONDS: positiveInt(120).default(
    DEFAULT_CONNECT_TIMEOUT_SECONDS,
  ),
  WEYNE_DB_STATEMENT_TIMEOUT_MS: positiveInt(600_000).default(
    DEFAULT_STATEMENT_TIMEOUT_MS,
  ),
  WEYNE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: positiveInt(600_000).default(
    DEFAULT_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  ),
})

export type DatabaseConfig = Readonly<{
  url: string
  pool: Readonly<{
    max: number
    idleTimeoutSeconds: number
    connectTimeoutSeconds: number
    statementTimeoutMs: number
    idleInTransactionTimeoutMs: number
  }>
}>

export function parseDatabaseConfig(
  environment: Readonly<Record<string, string | undefined>>,
): DatabaseConfig {
  const result = databaseEnvironmentSchema.safeParse(environment)

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid server database configuration: ${details}`)
  }

  return Object.freeze({
    url: result.data.DATABASE_URL,
    pool: Object.freeze({
      max: result.data.WEYNE_DB_POOL_MAX,
      idleTimeoutSeconds: result.data.WEYNE_DB_IDLE_TIMEOUT_SECONDS,
      connectTimeoutSeconds: result.data.WEYNE_DB_CONNECT_TIMEOUT_SECONDS,
      statementTimeoutMs: result.data.WEYNE_DB_STATEMENT_TIMEOUT_MS,
      idleInTransactionTimeoutMs:
        result.data.WEYNE_DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    }),
  })
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
