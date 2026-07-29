import { NextResponse } from 'next/server'
import { getBlob, safeKey, CONTENT_TYPES } from '@/lib/blobStore'

/** Serves locally stored uploads. With S3 configured, objects come from there. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ key: string[] }> }
) {
  const { key: parts } = await params
  const key = parts.join('/')
  if (!safeKey(key)) return new NextResponse('Not found', { status: 404 })

  const body = await getBlob(key)
  if (!body) return new NextResponse('Not found', { status: 404 })

  const ext = key.split('.').pop() || ''
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'content-type': CONTENT_TYPES[ext] || 'application/octet-stream',
      'cache-control': 'public, max-age=31536000, immutable',
    },
  })
}
