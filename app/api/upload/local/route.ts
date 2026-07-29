import { NextResponse } from 'next/server'
import { putBlob, safeKey } from '@/lib/blobStore'

const MAX_BYTES = 20 * 1024 * 1024

/** The local counterpart of a presigned PUT. Only used when S3 is unset. */
export async function PUT(req: Request) {
  const key = new URL(req.url).searchParams.get('key') || ''
  if (!safeKey(key)) {
    return NextResponse.json({ error: 'Bad key.' }, { status: 400 })
  }

  const buf = Buffer.from(await req.arrayBuffer())
  if (!buf.length || buf.length > MAX_BYTES) {
    return NextResponse.json({ error: 'Bad size.' }, { status: 413 })
  }

  await putBlob(key, buf)
  return NextResponse.json({ ok: true, key })
}
