# Image plates

Files here appear as built-in sources in the studio, ahead of the painted ones.
They are referenced by `BASE_PLATES` in `kaleidoscope-studio-polycentral.html`:

| File | Appears as |
| --- | --- |
| `spaceship.jpg` | Spaceship |
| `syndicate.jpg` | Syndicate |
| `decks.jpg` | Decks |
| `plumage.jpg` | Plumage |
| `companions.jpg` | Companions |
| `prism.webp` | Prism |

Any entry whose file is missing removes itself from the grid, so the studio
works with none, some, or all of them present.

These are re-encoded from the originals: JPEG, quality 4, long edge capped at
1600px. The full-resolution sources are kept out of the repo in
`.data/plate-originals/`.

Two things to know:

- **Serve over http.** Opening the HTML from `file://` taints the canvas when a
  local image is drawn into it, and the sampler cannot read pixels back. The
  plate detects this, logs, and leaves the source unchanged. `npm run dev` is
  fine; so is any static server.
- **Size them sensibly.** They are uploaded to the GPU whole. Anything past
  ~2000px on the long edge costs upload time for detail the wedge never
  resolves. 1400-1800px is plenty.

To add another: drop the file here and add a line to `BASE_PLATES` with
`{ id, name, src: 'plates/<file>' }`, then `npm run sync-studio`.
