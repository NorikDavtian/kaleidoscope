# Image plates

Files here appear as built-in sources in the studio, ahead of the painted ones.
They are referenced by `BASE_PLATES` in `kaleidoscope-studio-polycentral.html`:

| Expected file | Appears as |
| --- | --- |
| `spaceship.jpg` | Spaceship |
| `masks.jpg` | Masks |
| `corsairs.jpg` | Corsairs |
| `companions.jpg` | Companions |
| `syndicate.jpg` | Syndicate |

Any entry whose file is missing removes itself from the grid, so the studio
works with none, some, or all of them present.

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
