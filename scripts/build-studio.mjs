// Composes the studio from src/ into both delivery targets:
//   kaleidoscope-studio-polycentral.html  — one self-contained file
//   public/studio/{studio.css,markup.html,studio.js} — what the Next app mounts
//
// src/ is the source of truth. Edit there, run `npm run build-studio`.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'

const read = (p) => readFileSync(p, 'utf8').replace(/\s+$/, '')

const head = read('src/head.html')
const css = read('src/studio.css')
const body = read('src/studio.html')
const js = read('src/studio.js')

const standalone = `${head}
    <style>
${css}
    </style>
</head>
<body>
${body}

    <script>
${js}
    </script>
</body>
</html>
`

writeFileSync('kaleidoscope-studio-polycentral.html', standalone)

mkdirSync('public/studio', { recursive: true })
writeFileSync('public/studio/studio.css', css + '\n')
writeFileSync('public/studio/markup.html', body + '\n')
writeFileSync('public/studio/studio.js', js + '\n')

console.log('built standalone html + public/studio assets from src/')
