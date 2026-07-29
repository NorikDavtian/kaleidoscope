// The single-file studio stays the source of truth for the renderer. This
// splits it into the three assets the Next.js app serves, so the tuned shader
// and control panel never get hand-copied out of sync.
import { readFileSync, writeFileSync } from 'node:fs'

const SRC = 'kaleidoscope-studio-polycentral.html'
const html = readFileSync(SRC, 'utf8')

const between = (open, close, fromEnd = false) => {
  const a = html.indexOf(open)
  const b = fromEnd ? html.lastIndexOf(close) : html.indexOf(close)
  if (a < 0 || b < 0) throw new Error(`could not find ${open}…${close} in ${SRC}`)
  return html.slice(a + open.length, b).trim()
}

writeFileSync('public/studio/studio.css', between('<style>', '</style>') + '\n')
writeFileSync('public/studio/markup.html', between('<body>', '<script>') + '\n')
writeFileSync('public/studio/studio.js', between('<script>', '</script>', true) + '\n')

console.log('synced studio.css, markup.html, studio.js from', SRC)
