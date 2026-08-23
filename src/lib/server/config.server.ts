import '@tanstack/react-start/server-only'
import { isIP } from 'node:net'
import { z } from 'zod'
import { parseDatabaseConfig } from '@/lib/db/config.server'

const DEFAULT_HOST = '0.0.0.0'
const DEFAULT_PORT = 3000
const hostnamePattern = /^(?=.{1,253}$)(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?)(?:\.(?:[a-z\d](?:[a-z\d-]{0,61}[a-z\d])?))*$/i

const serverEnvironmentSchema = z.object({
  HOST: z
    .string()
    .trim()
    .min(1)
    .refine(isValidHost, 'HOST must be a valid hostname or IP address')
    .default(DEFAULT_HOST),
  PORT: z
    .string()
    .trim()
    .regex(/^\d+$/, 'PORT must be an integer between 1 and 65535')
    .refine(
      (port) => Number(port) >= 1 && Number(port) <= 65_535,
      'PORT must be an integer between 1 and 65535',
    )
    .default(String(DEFAULT_PORT)),
  // Hard byte cap for any single request body; see production-server.ts.
  WEYNE_MAX_BODY_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(1024 * 1024 * 1024)
    .default(48 * 1024 * 1024),
})

export type ServerConfig = Readonly<{
  databaseUrl: string
  host: string
  port: number
  maxBodyBytes: number
}>

export function parseServerConfig(
  environment: Readonly<Record<string, string | undefined>>,
): ServerConfig {
  const database = parseDatabaseConfig(environment)
  const result = serverEnvironmentSchema.safeParse(environment)

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid server runtime configuration: ${details}`)
  }

  return Object.freeze({
    databaseUrl: database.url,
    host: result.data.HOST,
    port: Number(result.data.PORT),
    maxBodyBytes: result.data.WEYNE_MAX_BODY_BYTES,
  })
}

function isValidHost(value: string): boolean {
  return value === '::' || isIP(value) !== 0 || hostnamePattern.test(value)
}
