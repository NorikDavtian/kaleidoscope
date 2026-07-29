import { PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { s3, BUCKET, isConfigured } from './s3'

export type Generation = {
  /** The same URL-hash encoding the studio uses, so nothing is re-derived. */
  state: string
  /** Short id shown in the panel — a hash of `state`. */
  id: string
  /** Storage key of the uploaded source, when the generation used one. */
  imageKey?: string
  createdAt: string
}

function key(id: string) {
  return `generations/${id}.json`
}

/**
 * Without S3 configured, generations go to a local directory. A module-scoped
 * Map is not enough: route handlers and server components are separate module
 * graphs in dev, so a link minted by the API would 404 on the page.
 */
const LOCAL_DIR = join(process.cwd(), '.data', 'generations')

async function localWrite(gen: Generation) {
  await mkdir(LOCAL_DIR, { recursive: true })
  await writeFile(join(LOCAL_DIR, `${gen.id}.json`), JSON.stringify(gen))
}

async function localRead(id: string): Promise<Generation | null> {
  try {
    return JSON.parse(await readFile(join(LOCAL_DIR, `${id}.json`), 'utf8'))
  } catch {
    return null
  }
}

export async function saveGeneration(gen: Generation) {
  if (!isConfigured()) {
    await localWrite(gen)
    return gen
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: key(gen.id),
      Body: JSON.stringify(gen),
      ContentType: 'application/json',
    })
  )
  return gen
}

export async function loadGeneration(id: string): Promise<Generation | null> {
  if (!/^[A-Z0-9]{1,16}$/.test(id)) return null
  if (!isConfigured()) return localRead(id)
  try {
    const res = await s3.send(new GetObjectCommand({ Bucket: BUCKET, Key: key(id) }))
    const body = await res.Body?.transformToString()
    return body ? (JSON.parse(body) as Generation) : null
  } catch {
    return null
  }
}

/** Same FNV-1a the studio uses, so ids match what the panel displays. */
export function generationId(state: string) {
  let h = 2166136261
  for (let i = 0; i < state.length; i++) {
    h ^= state.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0).toString(36).toUpperCase().padStart(7, '0')
}
