import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/**
 * Local stand-in for object storage, used when S3 is unconfigured so that
 * dropping a file still produces a working shareable link during development.
 */
const ROOT = join(process.cwd(), '.data', 'blobs')

/** Keys are minted server-side; validate anyway so nothing escapes the root. */
export function safeKey(key: string) {
  return /^sources\/[A-Za-z0-9_-]{1,120}\.[a-z0-9]{1,5}$/.test(key)
}

export async function putBlob(key: string, body: Buffer) {
  const path = join(ROOT, key)
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, body)
}

export async function getBlob(key: string) {
  try {
    return await readFile(join(ROOT, key))
  } catch {
    return null
  }
}

export const CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}
