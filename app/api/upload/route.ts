import { NextResponse } from 'next/server'
import { presignPut, publicUrl, isConfigured } from '@/lib/s3'

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Hands back a URL the browser uploads straight to — presigned S3 when it is
 * configured, a local endpoint otherwise. Either way the bitmap never passes
 * through this handler.
 */
export async function POST(req: Request) {
  const { contentType, size } = await req.json().catch(() => ({}) as any)

  if (!ALLOWED.includes(contentType)) {
    return NextResponse.json({ error: 'Unsupported image type.' }, { status: 415 })
  }
  if (typeof size !== 'number' || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large.' }, { status: 413 })
  }

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg')
  const key = `sources/${crypto.randomUUID()}.${ext}`

  if (!isConfigured()) {
    return NextResponse.json({
      key,
      uploadUrl: `/api/upload/local?key=${encodeURIComponent(key)}`,
      publicUrl: `/api/blob/${key}`,
      local: true,
    })
  }

  return NextResponse.json({
    key,
    uploadUrl: await presignPut(key, contentType),
    publicUrl: publicUrl(key),
  })
}
