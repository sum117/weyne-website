import { describe, expect, it } from 'vitest'
import {
  createObjectDownloadUrl,
  createS3Client,
  parseS3Config,
} from '@/lib/storage/s3.server'

const validEnvironment = {
  S3_ENDPOINT: 'http://127.0.0.1:9000',
  S3_REGION: 'us-east-1',
  S3_BUCKET: 'weyne-private',
  S3_ACCESS_KEY_ID: 'weyne-local',
  S3_SECRET_ACCESS_KEY: 'local-development-secret',
  S3_FORCE_PATH_STYLE: 'true',
  S3_SIGNED_URL_TTL_SECONDS: '123',
}

describe('parseS3Config', () => {
  it('normalizes provider-neutral S3 environment configuration', () => {
    expect(
      parseS3Config({
        ...validEnvironment,
        S3_ENDPOINT: '  http://127.0.0.1:9000/  ',
        S3_BUCKET: '  weyne-private  ',
      }),
    ).toEqual({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      bucket: 'weyne-private',
      accessKeyId: 'weyne-local',
      secretAccessKey: 'local-development-secret',
      forcePathStyle: true,
      signedUrlTtlSeconds: 123,
    })
  })

  it('defaults optional AWS-compatible settings', () => {
    const { S3_ENDPOINT: _endpoint, S3_FORCE_PATH_STYLE: _pathStyle, S3_SIGNED_URL_TTL_SECONDS: _ttl, ...required } = validEnvironment

    expect(parseS3Config(required)).toMatchObject({
      endpoint: undefined,
      forcePathStyle: false,
      signedUrlTtlSeconds: 900,
    })
  })

  it.each([
    [{}, 'S3_REGION is required'],
    [{ ...validEnvironment, S3_ENDPOINT: 'not-a-url' }, 'S3_ENDPOINT must be a valid HTTP(S) URL'],
    [{ ...validEnvironment, S3_FORCE_PATH_STYLE: 'yes' }, 'S3_FORCE_PATH_STYLE must be true or false'],
    [{ ...validEnvironment, S3_SIGNED_URL_TTL_SECONDS: '0' }, 'S3_SIGNED_URL_TTL_SECONDS must be between 1 and 604800'],
  ])('rejects invalid configuration without exposing credentials', (environment, message) => {
    expect(() => parseS3Config(environment)).toThrow(message)

    try {
      parseS3Config(environment)
    } catch (error) {
      expect(String(error)).not.toContain(validEnvironment.S3_SECRET_ACCESS_KEY)
    }
  })
})

describe('S3 client and signed URLs', () => {
  it('uses the configured signed-URL lifetime', async () => {
    const config = parseS3Config(validEnvironment)
    const client = createS3Client(config)

    const url = await createObjectDownloadUrl(client, config, 'private/report.pdf')

    expect(new URL(url).searchParams.get('X-Amz-Expires')).toBe('123')
  })
})
