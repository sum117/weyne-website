import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3'

export function createS3Client(input: {
  accessKeyId: string
  endpoint: string
  region: string
  secretAccessKey: string
}) {
  return new S3Client({
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
    endpoint: input.endpoint,
    forcePathStyle: true,
    region: input.region,
  })
}

export {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
}
