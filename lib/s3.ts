import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

const endpoint = process.env.S3_ENDPOINT || undefined

export const BUCKET = process.env.S3_BUCKET || 'kaleidoscope'

export const s3 = new S3Client({
  region: process.env.S3_REGION || 'us-east-1',
  endpoint,
  forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  credentials:
    process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
      ? {
          accessKeyId: process.env.S3_ACCESS_KEY_ID,
          secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
        }
      : undefined,
})

export function isConfigured() {
  return Boolean(process.env.S3_BUCKET && process.env.S3_ACCESS_KEY_ID)
}

/** Browser uploads straight to storage — the bitmap never passes through Node. */
export function presignPut(key: string, contentType: string) {
  return getSignedUrl(
    s3,
    new PutObjectCommand({ Bucket: BUCKET, Key: key, ContentType: contentType }),
    { expiresIn: 900 }
  )
}

export function presignGet(key: string) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: 60 * 60 * 24 * 7,
  })
}

/**
 * A stable public URL when the bucket serves objects directly, otherwise null
 * so callers fall back to a signed URL.
 */
export function publicUrl(key: string) {
  if (!isConfigured()) return `/api/blob/${key}`
  const base = process.env.S3_PUBLIC_BASE_URL
  return base ? `${base.replace(/\/$/, '')}/${key}` : null
}
