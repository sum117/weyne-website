import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { z } from 'zod'

const signedUrlTtlSchema = z
  .string()
  .trim()
  .regex(/^\d+$/, 'S3_SIGNED_URL_TTL_SECONDS must be between 1 and 604800')
  .transform(Number)
  .pipe(
    z
      .number()
      .int()
      .min(1, 'S3_SIGNED_URL_TTL_SECONDS must be between 1 and 604800')
      .max(604_800, 'S3_SIGNED_URL_TTL_SECONDS must be between 1 and 604800'),
  )

const s3EnvironmentSchema = z.object({
  S3_ENDPOINT: z
    .string()
    .trim()
    .url('S3_ENDPOINT must be a valid HTTP(S) URL')
    .refine(
      (value) => value.startsWith('http://') || value.startsWith('https://'),
      'S3_ENDPOINT must be a valid HTTP(S) URL',
    )
    .transform((value) => value.replace(/\/+$/, ''))
    .optional(),
  S3_REGION: requiredString('S3_REGION'),
  S3_BUCKET: requiredString('S3_BUCKET'),
  S3_ACCESS_KEY_ID: requiredString('S3_ACCESS_KEY_ID'),
  S3_SECRET_ACCESS_KEY: requiredString('S3_SECRET_ACCESS_KEY'),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'], {
      error: 'S3_FORCE_PATH_STYLE must be true or false',
    })
    .transform((value) => value === 'true')
    .default(false),
  S3_SIGNED_URL_TTL_SECONDS: signedUrlTtlSchema.default(900),
})

export type S3Config = Readonly<{
  endpoint?: string
  region: string
  bucket: string
  accessKeyId: string
  secretAccessKey: string
  forcePathStyle: boolean
  signedUrlTtlSeconds: number
}>

export function parseS3Config(
  environment: Readonly<Record<string, string | undefined>>,
): S3Config {
  const result = s3EnvironmentSchema.safeParse(environment)

  if (!result.success) {
    const details = result.error.issues.map((issue) => issue.message).join('; ')
    throw new Error(`Invalid server S3 configuration: ${details}`)
  }

  return Object.freeze({
    endpoint: result.data.S3_ENDPOINT,
    region: result.data.S3_REGION,
    bucket: result.data.S3_BUCKET,
    accessKeyId: result.data.S3_ACCESS_KEY_ID,
    secretAccessKey: result.data.S3_SECRET_ACCESS_KEY,
    forcePathStyle: result.data.S3_FORCE_PATH_STYLE,
    signedUrlTtlSeconds: result.data.S3_SIGNED_URL_TTL_SECONDS,
  })
}

export function createS3Client(config: S3Config): S3Client {
  return new S3Client({
    ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  })
}

export async function createObjectDownloadUrl(
  client: S3Client,
  config: S3Config,
  key: string,
): Promise<string> {
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: config.signedUrlTtlSeconds },
  )
}

function requiredString(name: string) {
  return z
    .string({ error: `${name} is required` })
    .trim()
    .min(1, `${name} is required`)
}
