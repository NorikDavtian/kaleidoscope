import { NextResponse } from 'next/server'
import { loadGeneration } from '@/lib/shareStore'
import { presignGet, publicUrl } from '@/lib/s3'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const gen = await loadGeneration(id)
  if (!gen) return NextResponse.json({ error: 'Not found.' }, { status: 404 })

  const imageUrl = gen.imageKey
    ? (publicUrl(gen.imageKey) ?? (await presignGet(gen.imageKey)))
    : null

  return NextResponse.json({ ...gen, imageUrl })
}
