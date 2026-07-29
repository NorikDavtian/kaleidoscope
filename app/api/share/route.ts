import { NextResponse } from 'next/server'
import { saveGeneration, generationId } from '@/lib/shareStore'

/** Persists a generation so its id resolves to the exact same image later. */
export async function POST(req: Request) {
  const { state, imageKey } = await req.json().catch(() => ({}) as any)

  if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{1,4096}$/.test(state)) {
    return NextResponse.json({ error: 'Invalid state.' }, { status: 400 })
  }
  if (imageKey !== undefined && !/^sources\/[\w.-]{1,128}$/.test(imageKey)) {
    return NextResponse.json({ error: 'Invalid image key.' }, { status: 400 })
  }

  const id = generationId(state)
  await saveGeneration({ id, state, imageKey, createdAt: new Date().toISOString() })

  return NextResponse.json({ id, url: `/g/${id}` })
}
