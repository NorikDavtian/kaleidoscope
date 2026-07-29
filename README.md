# Kaleidoscope

Browser kaleidoscope studio. A folded, warped, interfering field, fed by noise,
by a painted plate, or by your own image.

Everything runs client-side. No image you load ever leaves the machine.

## Two ways to run it

**Standalone** — open `kaleidoscope-studio-polycentral.html` in a browser. No
build step, no server. Everything works except sharing an uploaded image.

**As an app** — a Next.js wrapper that adds S3-backed uploads and permalinks:

```bash
npm install
cp .env.example .env.local   # optional — permalinks work without it
npm run dev
```

Without S3 credentials the app still runs: generations persist to `.data/` and
permalinks resolve. Only uploading a shared image needs a bucket, and
`/api/upload` returns a clear 503 until one is configured.

The single HTML file stays the source of truth for the renderer.
`npm run sync-studio` splits it into `public/studio/{studio.css,markup.html,studio.js}`,
which the `Studio` client component mounts. Run it after editing the HTML.

### App layout

| Path | Purpose |
| --- | --- |
| `app/page.tsx` | The studio. |
| `app/g/[id]/page.tsx` | A saved generation, with its source image. |
| `app/api/upload` | Presigned PUT — the browser uploads straight to S3. |
| `app/api/share` | Stores a generation; `GET /api/share/[id]` reads it back. |
| `lib/s3.ts` | S3 client. Works with AWS, R2, MinIO, B2 via `S3_ENDPOINT`. |
| `lib/shareStore.ts` | Generation records. Falls back to `.data/` on disk when S3 is unconfigured, so permalinks work locally with no credentials. |
| `scripts/sync-studio.mjs` | Splits the HTML into the served assets. |

The bucket needs CORS allowing `PUT` from your origin for uploads, and `GET`
for reading a shared source back — the renderer samples image pixels, so a
tainted cross-origin canvas would fail.

## Files

| File | Notes |
| --- | --- |
| `kaleidoscope-studio-polycentral.html` | **Current.** GPU renderer, polycentral tilings, image sources. |
| `kaleidoscope-studio.html` | Previous studio build. |
| `refracted-descent-ii.html` | Earlier field experiment. |
| `hedral-recursion.html` | Earliest sketch. |

Open the current file directly in a browser — no build step, no server.

## How it renders

Two GPU passes, split by what actually changes:

1. **Field pass** — solves the whole field in a fragment shader and writes it to
   a texture: the palette phase packed across two bytes, plus the shade. Runs
   only when a parameter that shapes the field moves (~1.3 ms).
2. **Colour pass** — reads that texture, applies the palette ramp, seam glow and
   image blend. This is the only thing that has to keep up with the display.

Radial mode composites the buffer straight to the canvas. The tessellated modes
reflect it across cell edges on a 2D canvas, from a once-per-frame downscaled
copy so a hundred-plus cell blits stay same-size copies rather than resamples.

Measured on an integrated GPU at 1024² field, 817×854 viewport:

| | per frame |
| --- | --- |
| Radial | 4.9 ms |
| Square | 4.2 ms |
| Triangle | 3.7 ms |
| Field re-solve (parameter change) | 1.3 ms |

A CPU path is kept as a fallback and is used automatically when WebGL is
unavailable. It is much slower — the field solve alone was ~1.8 s at full
resolution, which is what motivated the move to the GPU.

## Roadmap

- **Video and camera input.** Feed a live camera or a video file into the scope
  as the source, the way a teleidoscope uses its environment. The source is
  already a texture uploaded per frame, so this is mostly plumbing plus a
  `getUserMedia` permission flow.
- Curated public-domain artwork sources with on-canvas attribution.
- The remaining two of Brewster's four polycentral shapes: the 90-45-45 and
  90-60-30 triangles.
- Export a loop as video rather than a single PNG.
- Drop the p5 dependency entirely — it is now only used for the main canvas and
  for painting the built-in plates.

## Generation IDs

Every parameter that shapes the output is packed into the URL hash, so a link
reopens exactly the same image — the field is a pure function of those values
and nothing else. The panel shows a short id (e.g. `0XOR9SV`) derived from the
same state, for quoting a result without pasting a URL.

`Copy link` registers the generation and gives you the short `/g/<id>` form when
a backend is reachable, falling back to the self-contained `#s=` link when the
file is opened standalone.

Built-in plates travel by id. Standalone, a custom upload stays on your machine
and does not travel with the link. Under the app it is stored, and the link
becomes `/g/<id>` and carries the image too.

## Seeing an image in the mirrors

Radial mode folds the plane into one wedge, so the sampler only ever reads a
**sector** of the source — `π / folds` wide, anchored at the pan point. At 10
folds that is an 18° slice: most of the picture cannot appear at all, which is
why an upload tends to come out as texture rather than as its subject.

The tessellated modes sample a rectangular patch and mirror it across cell
edges, which is what a real polycentral scope does and what makes whole faces
show up in the reference. For a recognisable subject:

| Setting | Value |
| --- | --- |
| Symmetry | **Triangle** (or Square) |
| Zoom | 0.5 – 0.7 |
| Cell Size | 280 – 340 |
| Field Mix | 0 |
| Image Warp | 0 |
| Pan X / Y | centre on the subject |

Note that Zoom runs the opposite way to the word: a *higher* value fits more of
the image into each cell, so features come out smaller. Lower magnifies.

## Section controls

Every section header carries three small controls:

| | |
| --- | --- |
| **Lock** | Randomize leaves this section exactly as it is. |
| **Dice** | Rolls only this section. |
| **Auto** | Lets this section drift on its own. |

Lock and Auto are mutually exclusive — pinning a section switches its drift off.

Continuous sections (Motion, Parameters) ease toward a fresh random target every
few seconds, so the image morphs rather than jumping. The sections that can only
step — Symmetry, Seed, Source, Colour — wait a random interval and then
cross-dissolve: the frame is snapshotted before the switch and faded out over
the new one, so a hard cut still reads as a transition.

Auto runs whether or not the Animate button is on; `needsLoop()` keeps the
sketch running while any section is drifting or a dissolve is in flight.

## Colour

Palettes are generated from a single base colour across eight harmony schemes,
each row drawing its own lightness envelope, saturation swing and direction. The
browser widens as it is scrolled — the first rows are close variations on the
chosen colour, and by row 60 or so they have drifted right around the wheel.

The tile format is Gregg Gunn's: a palette shown as a composition rather than a
strip, which previews how the colours sit against each other.

## Inspiration and credits

- [Leif Gehrmann — Digital Kaleidoscopes](https://leifgehrmann.com/kaleidoscopes/)
  and the [live scope](https://kaleidoscope.leifgehrmann.com/). The write-up on
  why only four mirror arrangements tessellate, and the shape of the landing
  screen and floating toolbar, come from here.
- [kazuhikoarase/kaleidoscope](https://github.com/kazuhikoarase/kaleidoscope)
  (MIT, 2014) — the triangle and square tessellation geometry and the
  counter-rotating cell trick are adapted from it.
- [Anthropic algorithmic-art skill](https://github.com/anthropics/skills/blob/main/skills/algorithmic-art/SKILL.md)
- [Gregg Gunn — How to make your own color palettes](https://medium.com/@greggunn/how-to-make-your-own-color-palettes-712959fbf021),
  for the square palette format used in the browser.
- David Brewster, *A Treatise on the Kaleidoscope* (1819), for the term
  *polycentral* and the underlying optics.

Palette families are restrained on purpose. A kaleidoscope repeats a colour
dozens of times per frame, so a full-spectrum ramp reads as noise rather than as
pattern — every preset stays inside a limited range.
