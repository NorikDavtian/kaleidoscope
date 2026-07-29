'use client'

import { useEffect, useRef, useState } from 'react'

type Props = {
  /** URL-hash encoding of a saved generation, when arriving at a permalink. */
  state?: string
  /** Signed or public URL of the source image that generation used. */
  imageUrl?: string | null
}

const P5_SRC = 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.7.0/p5.min.js'

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`)
    if (existing) {
      if (existing.dataset.loaded) return resolve()
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error(src)))
      return
    }
    const el = document.createElement('script')
    el.src = src
    el.async = false
    el.addEventListener('load', () => {
      el.dataset.loaded = '1'
      resolve()
    })
    el.addEventListener('error', () => reject(new Error(src)))
    document.body.appendChild(el)
  })
}

/**
 * The studio is a self-contained sketch that drives the DOM directly and runs
 * p5 in global mode, so it is mounted rather than reimplemented: React owns the
 * container, the sketch owns everything inside it. `npm run sync-studio` keeps
 * these assets in step with the single-file version.
 */
export default function Studio({ state, imageUrl }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (started.current) return
    started.current = true

    let cancelled = false

    ;(async () => {
      try {
        const markup = await fetch('/studio/markup.html').then((r) => r.text())
        if (cancelled || !host.current) return
        host.current.innerHTML = markup

        // A permalink carries its state in the hash the sketch already reads.
        if (state) {
          history.replaceState(null, '', `${location.pathname}#s=${state}`)
        }
        if (imageUrl) {
          ;(window as any).__kaleidoscopeSourceUrl = imageUrl
        }
        ;(window as any).__kaleidoscopeUpload = uploadSource

        await loadScript(P5_SRC)
        await loadScript('/studio/studio.js')

        // p5 global mode starts itself on window load. Injected after mount
        // that event is long past, so start the sketch by hand when it has not
        // already claimed the container.
        const w = window as any
        if (typeof w.p5 === 'function' && !document.querySelector('#canvas-wrap canvas')) {
          new w.p5()
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      cancelled = true
    }
  }, [state, imageUrl])

  if (error) {
    return (
      <div style={{ padding: 32, fontFamily: 'system-ui', color: '#faf9f5' }}>
        Could not start the studio: {error}
      </div>
    )
  }

  return <div ref={host} />
}

/**
 * Uploads a chosen file straight to storage and registers the generation, so
 * the resulting link reopens the image as well as the parameters.
 */
async function uploadSource(file: File, encodedState: string) {
  const presign = await fetch('/api/upload', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, size: file.size }),
  })
  if (!presign.ok) throw new Error((await presign.json()).error ?? 'Upload failed.')

  const { key, uploadUrl } = await presign.json()

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  })
  if (!put.ok) throw new Error('Storage rejected the upload.')

  const share = await fetch('/api/share', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ state: encodedState, imageKey: key }),
  })
  if (!share.ok) throw new Error('Could not save the generation.')

  return share.json() as Promise<{ id: string; url: string }>
}
