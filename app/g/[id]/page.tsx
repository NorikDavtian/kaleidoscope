import Studio from '@/components/Studio'
import { loadGeneration } from '@/lib/shareStore'
import { presignGet, publicUrl } from '@/lib/s3'
import { notFound } from 'next/navigation'

export const dynamic = 'force-dynamic'

/** A saved generation, including the uploaded source when there was one. */
export default async function GenerationPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const gen = await loadGeneration(id)
  if (!gen) notFound()

  let imageUrl: string | null = null
  if (gen.imageKey) {
    imageUrl = publicUrl(gen.imageKey) ?? (await presignGet(gen.imageKey))
  }

  return <Studio state={gen.state} imageUrl={imageUrl} />
}
