import { NextResponse } from 'next/server'
import { presignPut, publicUrl, isConfigured } from '@/lib/s3'

const ALLOWED = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif']
const MAX_BYTES = 20 * 1024 * 1024

/**
 * Hands back a presigned PUT so the browser uploads straight to storage.
 * Nothing is stored until the client actually uploads.
 */
export async function POST(req: Request) {
  if (!isConfigured()) {
    return NextResponse.json(
      { error: 'Storage is not configured. See .env.example.' },
      { status: 503 }
    )
  }

  const { contentType, size } = await req.json().catch(() => ({}) as any)

  if (!ALLOWED.includes(contentType)) {
    return NextResponse.json({ error: 'Unsupported image type.' }, { status: 415 })
  }
  if (typeof size !== 'number' || size <= 0 || size > MAX_BYTES) {
    return NextResponse.json({ error: 'Image is too large.' }, { status: 413 })
  }

  const ext = contentType.split('/')[1].replace('jpeg', 'jpg')
  const key = `sources/${crypto.randomUUID()}.${ext}`

  return NextResponse.json({
    key,
    uploadUrl: await presignPut(key, contentType),
    publicUrl: publicUrl(key),
  })
}
