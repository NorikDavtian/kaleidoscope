        // ═══════════════════════════════════════════════════════════════════════
        // REFRACTED DESCENT — PARAMETERS
        // ═══════════════════════════════════════════════════════════════════════

        let params = {
            seed: 500321,
            source: 'generated',
            tiling: 'radial', // radial | triangle | square (the latter two tessellate)
            cellSize: 219,    // edge length of one tessellated cell, in screen px
            cellSpin: 0.08,   // how much of the mirror rotation the cell contents follow
            trail: 0,         // frame persistence while in motion
            folds: 5,        // mirror count — default 10, the tetractys
            moire: 0.01,       // interference depth
            mfreq: 3.3,       // fringe frequency
            detune: 1.48,     // ratio between the two interfering systems
            descent: 2.9,     // logarithmic radial compression → depth
            angular: 2,     // angular field frequency
            twist: 0.73,      // angle bled into radius → spiral
            warp: 2.3,        // iterated domain-warp strength
            octaves: 3,       // fbm depth
            bands: 0.7,         // times the palette cycle wraps
            rings: 0.9,       // concentric colour cadence bound to the descent
            shift: 0.26,         // palette phase
            seam: 0.09,        // luminous contour at band boundaries
            contrast: 0.9,
            rotation: 350,
            flow: 1,          // palette phase drift per frame
            spin: 0.3,        // rotation per frame
            bpm: 16,          // beat the automatic transitions are locked to
            breath: 'calm',   // off | box | calm | deep | progressive
            breathDepth: 0.6, // how far the breath swings the colour and scale
            breathGuide: true,// show the ring to breathe along with
            breathLabel: true,// and the stage text under it
            breathLabelSize: 12,
            orbSize: 300,     // diameter of the breath orb, in px
            orbStrength: 1,   // how strongly it reads against the artwork
            orbTint: 'white', // white | palette | warm | cool | depth
            edgeMask: 'off',  // off | circle | petal | scallop | bloom
            edgeSize: 0.86,   // how far out the shape reaches
            edgeSoft: 46,     // px of blur on its boundary — never a clean cut
            imgZoom: 1.04,    // how much of the source image one wedge covers
            imgPanX: 0.51,     // centre of the sampled patch, in source uv
            imgPanY: 0.69,
            imgAngle: 223,      // turn the source under the scope, in degrees
            imgWarp: 0.04,       // domain-warp displacement applied to image sampling
            mix: 0.18,        // 0 = pure image, 1 = pure generated field
            colorPalette: ['#04232b', '#0b4f4a', '#2e8b74', '#84c4a8', '#d9edd8']
        };

        let defaultParams = JSON.parse(JSON.stringify(params));

        const PREVIEW_SIDE = 360;
        const ANIM_SIDE = 560;
        const FULL_SIDE = 1150;

        // The field is cached quantised, not as floats: the phase as 16-bit
        // fixed point (so it wraps for free on integer overflow) and the shade
        // as a byte. That turns the per-frame colour pass into table lookups.
        let cacheT = null, cacheS = null;
        let cacheIR = null, cacheIG = null, cacheIB = null;
        let cacheSide = 0, cachedImage = false;
        let img = null;
        let lut = new Uint8Array(256 * 3);

        const SH_MIN = 0.45, SH_SPAN = 1.1;
        // Field colour for every (shade, phase) pair, folded into one lookup.
        const combR = new Uint8ClampedArray(65536);
        const combG = new Uint8ClampedArray(65536);
        const combB = new Uint8ClampedArray(65536);
        const palR = new Float32Array(256), palG = new Float32Array(256), palB = new Float32Array(256);
        const glowT = new Float32Array(256);
        const shadeT = new Float32Array(256);
        let tablesDirty = true;
        for (let q = 0; q < 256; q++) shadeT[q] = SH_MIN + (q / 255) * SH_SPAN;
        let hiTimer = null, resizeTimer = null;
        let phaseX = 0, phaseY = 0, ripple = 1;
        let animating = false, animPhase = 0, spinAngle = 0;
        let dragging = false, dragVel = 0, lastPtr = 0;
        let srcPixels = null, srcW = 0, srcH = 0, srcHolder = null;
        let activeBase = null;
        let srcThumbURL = null, srcName = '', srcNote = '';
        let srcCanvas = null;   // whatever the sampler / GPU is reading from
        // Pins the chosen image alone. The Source section lock is broader — it
        // holds the zoom, pan and mix too — so this exists for the common case
        // of wanting one picture while everything around it keeps moving.
        let imageLocked = false;
        let plateAnim = false, platePhase = 0;

        // ═══════════════════════════════════════════════════════════════════════
        // SEEDED GRADIENT NOISE
        // ═══════════════════════════════════════════════════════════════════════

        const perm = new Uint8Array(512);
        let rndState = 1;

        function rnd() {
            let s = rndState;
            s ^= s << 13; s >>>= 0;
            s ^= s >> 17;
            s ^= s << 5;  s >>>= 0;
            rndState = s;
            return s / 4294967296;
        }

        // Independent stream, so painting a plate never disturbs the field noise.
        function makeRng(seed) {
            let s = (seed >>> 0) || 1;
            return function () {
                s ^= s << 13; s >>>= 0;
                s ^= s >> 17;
                s ^= s << 5;  s >>>= 0;
                return s / 4294967296;
            };
        }

        function seedNoise(seed) {
            rndState = (seed >>> 0) || 1;
            const p = new Uint8Array(256);
            for (let i = 0; i < 256; i++) p[i] = i;
            for (let i = 255; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1));
                const t = p[i]; p[i] = p[j]; p[j] = t;
            }
            for (let i = 0; i < 512; i++) perm[i] = p[i & 255];

            phaseX = rnd() * 512;
            phaseY = rnd() * 512;
            ripple = 0.7 + rnd() * 1.6;
        }

        function grad2(h, x, y) {
            switch (h & 7) {
                case 0: return x + y;
                case 1: return -x + y;
                case 2: return x - y;
                case 3: return -x - y;
                case 4: return x;
                case 5: return -x;
                case 6: return y;
                default: return -y;
            }
        }

        function pnoise(x, y) {
            const fx = Math.floor(x), fy = Math.floor(y);
            const X = fx & 255, Y = fy & 255;
            x -= fx; y -= fy;
            const u = x * x * x * (x * (x * 6 - 15) + 10);
            const v = y * y * y * (y * (y * 6 - 15) + 10);
            const A = perm[X] + Y, B = perm[X + 1] + Y;
            const n00 = grad2(perm[A], x, y);
            const n10 = grad2(perm[B], x - 1, y);
            const n01 = grad2(perm[A + 1], x, y - 1);
            const n11 = grad2(perm[B + 1], x - 1, y - 1);
            const nx0 = n00 + u * (n10 - n00);
            const nx1 = n01 + u * (n11 - n01);
            return nx0 + v * (nx1 - nx0);
        }

        function fbm(x, y, oct) {
            let amp = 0.5, freq = 1, sum = 0;
            for (let i = 0; i < oct; i++) {
                sum += amp * pnoise(x * freq, y * freq);
                freq *= 2.03;   // slightly off 2.0 — kills grid resonance
                amp *= 0.5;
            }
            return sum;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // BUILT-IN BASE PLATES
        //
        // Painted in code rather than shipped as photographs: the file stays
        // self-contained, and a cross-origin bitmap could not be pixel-read by
        // the sampler anyway. Each is a deterministic composition — same plate
        // every time, at any resolution.
        // ═══════════════════════════════════════════════════════════════════════

        // Entries with `src` are photographs rather than code. They are resolved
        // against a few candidate paths so the same file works whether this is
        // served by the app or opened straight off disk, and any that fail to
        // load simply drop out of the grid.
        const BASE_PLATES = [
            { id: 'spaceship', name: 'Spaceship', src: 'plates/spaceship.jpg' },
            { id: 'syndicate', name: 'Syndicate', src: 'plates/syndicate.jpg' },
            { id: 'decks',     name: 'Decks',     src: 'plates/decks.jpg' },
            { id: 'plumage',   name: 'Plumage',   src: 'plates/plumage.jpg' },
            { id: 'companions',name: 'Companions',src: 'plates/companions.jpg' },
            { id: 'drift',     name: 'Drift',     video: 'plates/drift.mp4',
              poster: 'plates/drift-poster.jpg' },
            { id: 'stilllife', name: 'Still Life' },
            { id: 'meadow',    name: 'Meadow' },
            { id: 'linocut',   name: 'Linocut' },
            { id: 'tartan',    name: 'Tartan' },
            { id: 'glass',     name: 'Glass' },
            { id: 'blossom',   name: 'Blossom' },
            { id: 'smiley',    name: 'Smiley' },
            { id: 'faces',     name: 'Faces' },
            { id: 'wink',      name: 'Wink', anim: true }
        ];

        const PLATE_ROOTS = ['/studio/', 'public/studio/', ''];
        const plateBitmaps = {};        // id -> p5.Image, once loaded

        // Try each root in turn; the first that yields an image wins.
        function loadPlateBitmap(plate, done, fail) {
            if (plateBitmaps[plate.id]) { done(plateBitmaps[plate.id]); return; }
            let i = 0;
            const attempt = function () {
                if (i >= PLATE_ROOTS.length) { if (fail) fail(); return; }
                const url = PLATE_ROOTS[i++] + plate.src;
                loadImage(url, function (img) {
                    plateBitmaps[plate.id] = img;
                    done(img);
                }, attempt);
            };
            attempt();
        }

        let plateVideo = null, videoCv = null, videoCtx = null, videoLive = false;

        // A video source is the animated plate with its frames coming from a
        // file: draw the current frame to a canvas, hand that to the GPU, and
        // let the existing per-frame re-upload do the rest.
        function useVideoPlate(meta, name) {
            if (!plateVideo) {
                plateVideo = document.createElement('video');
                plateVideo.muted = true;              // required for autoplay
                plateVideo.loop = true;
                plateVideo.autoplay = true;
                plateVideo.playsInline = true;
                plateVideo.setAttribute('playsinline', '');
                plateVideo.crossOrigin = 'anonymous';
                plateVideo.style.display = 'none';
                document.body.appendChild(plateVideo);
            }

            let i = 0;
            const attempt = function () {
                if (i >= PLATE_ROOTS.length) {
                    console.warn('Video plate missing: ' + meta.video);
                    return;
                }
                plateVideo.src = PLATE_ROOTS[i++] + meta.video;
                plateVideo.load();
            };

            plateVideo.onerror = attempt;
            plateVideo.onloadeddata = function () {
                const w = plateVideo.videoWidth, h = plateVideo.videoHeight;
                if (!w || !h) return;
                if (!videoCv) { videoCv = document.createElement('canvas'); videoCtx = videoCv.getContext('2d'); }
                videoCv.width = w; videoCv.height = h;
                videoCtx.drawImage(plateVideo, 0, 0, w, h);

                if (srcHolder) { srcHolder.remove(); srcHolder = null; }
                srcPixels = null;                     // the CPU path cannot follow a video
                srcW = w; srcH = h;
                srcCanvas = videoCv;
                srcTexDirty = true;
                videoLive = true;
                plateAnim = true;
                activeBase = meta.id;
                markActiveThumb(meta.id);
                document.getElementById('drop-label').textContent = 'Or use your own';
                setSourceMeta(videoCv.toDataURL('image/jpeg', 0.7), name,
                    w + ' × ' + h + ' · built-in video');
                setSource('image');
                plateVideo.play().catch(function () {});
                loop();
            };

            attempt();
        }

        function plateById(id) {
            return BASE_PLATES.filter(function (b) { return b.id === id; })[0] || null;
        }

        // 1 = open, 0 = shut. One wink per loop, eased.
        function eyeOpen(t) {
            t = t - Math.floor(t);
            if (t < 0.34 || t > 0.70) return 1;
            if (t < 0.42) { const k = (t - 0.34) / 0.08; return 1 - k * k; }
            if (t < 0.56) return 0;
            const k = (t - 0.56) / 0.14;
            return k * k * (3 - 2 * k);
        }

        function pick(R, arr) { return arr[(R() * arr.length) | 0]; }

        function paintPlate(id, w, h, phase) {
            const pg = createGraphics(w, h);
            pg.pixelDensity(1);
            drawPlate(pg, id, w, h, phase);
            return pg;
        }

        function drawPlate(pg, id, w, h, phase) {
            pg.noStroke();
            const R = makeRng(id.charCodeAt(0) * 7919 + id.length * 104729);
            const S = Math.min(w, h) / 500;   // everything scales off the short edge

            if (id === 'stilllife') {
                // Dutch table piece: dark ground, warm fruit masses, cool glazes
                pg.background(20, 15, 11);
                const warm = [[196, 44, 32], [214, 134, 30], [122, 26, 40],
                              [64, 86, 38], [236, 208, 150], [152, 42, 72], [96, 62, 32]];
                for (let i = 0; i < 46; i++) {
                    pg.fill(70, 44, 20, 22);
                    const r = (120 + R() * 380) * S;
                    pg.ellipse(R() * w, R() * h, r, r * (0.6 + R() * 0.7));
                }
                for (let i = 0; i < 320; i++) {
                    const c = pick(R, warm);
                    const r = (10 + R() * R() * 110) * S;
                    pg.fill(c[0], c[1], c[2], 95 + R() * 130);
                    pg.ellipse(R() * w, R() * h, r * (0.7 + R() * 0.7), r * (0.7 + R() * 0.7));
                }
                for (let i = 0; i < 150; i++) {
                    pg.fill(252, 242, 214, 40 + R() * 150);
                    const r = (3 + R() * 22) * S;
                    pg.ellipse(R() * w, R() * h, r, r * (0.5 + R() * 0.8));
                }
                for (let i = 0; i < 70; i++) {
                    pg.fill(8, 6, 4, 42);
                    const r = (60 + R() * 260) * S;
                    pg.ellipse(R() * w, R() * h, r, r);
                }

            } else if (id === 'meadow') {
                // Broken-colour dabs: post-impressionist spring valley
                for (let y = 0; y < h; y++) {
                    const t = y / h;
                    pg.fill(120 + 90 * (1 - t), 150 + 60 * t, 190 - 120 * t);
                    pg.rect(0, y, w, 1);
                }
                const dab = [[246, 214, 68], [212, 168, 40], [96, 150, 62], [46, 104, 58],
                             [128, 186, 210], [72, 96, 168], [232, 240, 220], [190, 84, 126]];
                for (let i = 0; i < 4200; i++) {
                    const c = pick(R, dab);
                    pg.push();
                    pg.translate(R() * w, R() * h);
                    pg.rotate(R() * Math.PI);
                    pg.fill(c[0], c[1], c[2], 140 + R() * 110);
                    pg.rect(0, 0, (6 + R() * 26) * S, (2.5 + R() * 5) * S, 2);
                    pg.pop();
                }

            } else if (id === 'linocut') {
                // Few colours, hard edges, big sweeping forms
                pg.background(240, 232, 216);
                const cols = [[214, 48, 31], [20, 18, 20], [248, 246, 240], [40, 70, 132]];
                for (let i = 0; i < 26; i++) {
                    const c = pick(R, cols);
                    pg.fill(c[0], c[1], c[2], 215);
                    pg.beginShape();
                    const cx = R() * w, cy = R() * h;
                    const rad = (60 + R() * 210) * S;
                    const pts = 5 + ((R() * 4) | 0);
                    for (let k = 0; k < pts; k++) {
                        const a = (k / pts) * Math.PI * 2;
                        const rr = rad * (0.45 + R() * 0.95);
                        pg.curveVertex(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr * 0.8);
                    }
                    pg.endShape(pg.CLOSE);
                }
                pg.noFill();
                for (let i = 0; i < 40; i++) {
                    const c = pick(R, cols);
                    pg.stroke(c[0], c[1], c[2], 200);
                    pg.strokeWeight((2 + R() * 9) * S);
                    const cx = R() * w, cy = R() * h, rad = (30 + R() * 170) * S;
                    pg.arc(cx, cy, rad * 2, rad * 2, R() * 6.28, R() * 6.28 + 1 + R() * 3);
                }
                pg.noStroke();

            } else if (id === 'tartan') {
                // Woven sett: warp, weft, and a twill hatch over the top
                pg.background(14, 12, 16);
                const sett = [[214, 22, 130, 46], [10, 10, 12, 30], [22, 190, 214, 26],
                              [10, 10, 12, 52], [240, 238, 232, 12], [10, 10, 12, 30],
                              [214, 22, 130, 18], [120, 20, 150, 38]];
                let x = 0;                while (x < w) {
                    for (let i = 0; i < sett.length && x < w; i++) {
                        const b = sett[i], bw = b[3] * S * 2.2;
                        pg.fill(b[0], b[1], b[2], 200);
                        pg.rect(x, 0, bw, h);
                        x += bw;
                    }
                }
                let y = 0;
                while (y < h) {
                    for (let i = 0; i < sett.length && y < h; i++) {
                        const b = sett[i], bh = b[3] * S * 2.2;
                        pg.fill(b[0], b[1], b[2], 122);
                        pg.rect(0, y, w, bh);
                        y += bh;
                    }
                }
                pg.stroke(255, 255, 255, 16);
                pg.strokeWeight(1);
                for (let d = -h; d < w; d += 4 * S) pg.line(d, 0, d + h, h);
                pg.noStroke();

            } else if (id === 'glass') {
                // Leaded cells: jewel tones caught in a dark came
                pg.background(8, 8, 14);
                const jewel = [[190, 30, 44], [22, 96, 168], [216, 158, 24], [26, 132, 96],
                               [124, 34, 152], [226, 96, 30], [40, 172, 190]];
                for (let i = 0; i < 150; i++) {
                    const c = pick(R, jewel);
                    const cx = R() * w, cy = R() * h;
                    const rad = (24 + R() * 120) * S;
                    const pts = 4 + ((R() * 4) | 0);
                    const rot = R() * Math.PI;
                    pg.fill(c[0], c[1], c[2], 190 + R() * 60);
                    pg.stroke(6, 6, 10, 240);
                    pg.strokeWeight((3 + R() * 5) * S);
                    pg.beginShape();
                    for (let k = 0; k < pts; k++) {
                        const a = rot + (k / pts) * Math.PI * 2;
                        const rr = rad * (0.72 + R() * 0.5);
                        pg.vertex(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
                    }
                    pg.endShape(pg.CLOSE);
                }
                pg.noStroke();
                for (let i = 0; i < 200; i++) {
                    pg.fill(255, 255, 255, 20 + R() * 70);
                    pg.ellipse(R() * w, R() * h, (4 + R() * 26) * S, (3 + R() * 12) * S);
                }

            } else if (id === 'smiley') {
                // One big subject, flat ground. A plate for seeing what the
                // mirrors do to something recognisable — so it holds a single
                // large face rather than a crowd of small ones, which is what
                // survives being sampled a cell at a time.
                pg.background(18, 19, 26);

                const cx = w / 2, cy = h / 2;
                const rad = Math.min(w, h) * 0.31;

                pg.fill(232, 168, 124);
                pg.ellipse(cx, cy, rad * 2, rad * 2);

                pg.fill(18, 19, 26);
                const ex = rad * 0.35, ey = rad * 0.27, er = rad * 0.16;
                pg.ellipse(cx - ex, cy - ey, er * 2, er * 2.25);
                pg.ellipse(cx + ex, cy - ey, er * 2, er * 2.25);

                // Stroked, not filled — a filled arc reads as a blob.
                pg.push();
                pg.noFill();
                pg.stroke(18, 19, 26);
                pg.strokeWeight(rad * 0.13);
                pg.strokeCap(ROUND);
                pg.arc(cx, cy + rad * 0.1, rad * 1.08, rad * 1.02, 0.4, Math.PI - 0.4);
                pg.pop();

                // Two corner accents, so the mirrors have something off-centre
                // to work with and the tiling does not read as pure repetition.
                const sq = Math.min(w, h) * 0.19;
                pg.fill(217, 119, 87);
                pg.rect(w * 0.05, h * 0.07, sq, sq);
                pg.rect(w * 0.95 - sq, h * 0.93 - sq, sq, sq);
            } else if (id === 'wink') {
                // The animated plate: same face as 'smiley', but its right eye
                // is driven by `phase`, and draw() repaints it every frame.
                const e = eyeOpen(phase || 0);
                pg.background(18, 19, 26);

                const wcx = w / 2, wcy = h / 2;
                const wrad = Math.min(w, h) * 0.34;

                pg.fill(232, 168, 124);
                pg.ellipse(wcx, wcy, wrad * 2, wrad * 2);

                pg.fill(18, 19, 26);
                const wex = wrad * 0.35, wey = wrad * 0.27, wer = wrad * 0.16;
                pg.ellipse(wcx - wex, wcy - wey, wer * 2, wer * 2.1);
                pg.ellipse(wcx + wex, wcy - wey, wer * 2, wer * 2.1 * (0.16 + 0.84 * e));

                // A touch smugger while the eye is down.
                const grin = 1 + 0.1 * (1 - e);
                pg.push();
                pg.noFill();
                pg.stroke(18, 19, 26);
                pg.strokeWeight(wrad * 0.13);
                pg.strokeCap(ROUND);
                pg.arc(wcx, wcy + wrad * 0.1, wrad * 1.04 * grin, wrad * 1.0 * grin,
                       0.4, Math.PI - 0.4);
                pg.pop();

                const wsq = Math.min(w, h) * 0.15;
                pg.fill(217, 119, 87);
                pg.rect(w * 0.05, h * 0.07, wsq, wsq);
                pg.rect(w * 0.95 - wsq, h * 0.93 - wsq, wsq, wsq);
            } else if (id === 'faces') {
                // The crowd version: many small faces, so a single cell catches
                // several and the mirrors braid them into each other.
                pg.background(18, 19, 26);
                const skin = [[232, 168, 124], [214, 132, 96], [244, 198, 160],
                              [198, 108, 78], [240, 180, 140]];
                const rows = 3, cols = 4;
                for (let gy = 0; gy < rows; gy++) {
                    for (let gx = 0; gx < cols; gx++) {
                        const cx = (gx + 0.5) * w / cols + (R() - 0.5) * w * 0.04;
                        const cy = (gy + 0.5) * h / rows + (R() - 0.5) * h * 0.05;
                        const rad = Math.min(w / cols, h / rows) * (0.34 + R() * 0.09);
                        const c = pick(R, skin);

                        pg.fill(c[0], c[1], c[2]);
                        pg.ellipse(cx, cy, rad * 2, rad * 2);

                        pg.fill(18, 19, 26);
                        const ey = rad * 0.3, ex = rad * 0.36, er = rad * 0.17;
                        pg.ellipse(cx - ex, cy - ey, er * 2, er * 2.2);
                        pg.ellipse(cx + ex, cy - ey, er * 2, er * 2.2);

                        pg.push();
                        pg.noFill();
                        pg.stroke(18, 19, 26);
                        pg.strokeWeight(rad * 0.14);
                        pg.strokeCap(ROUND);
                        pg.arc(cx, cy + rad * 0.12, rad * 1.05, rad * 1.0, 0.42, Math.PI - 0.42);
                        pg.pop();
                    }
                }
                const conf = [[217, 119, 87], [122, 160, 190], [200, 200, 190]];
                for (let i = 0; i < 26; i++) {
                    const c = pick(R, conf);
                    pg.fill(c[0], c[1], c[2], 210);
                    const sz = (12 + R() * 26) * S;
                    pg.rect(R() * w, R() * h, sz, sz);
                }
            } else {   // blossom
                // Roses on a cool ground — concentric petal whorls
                pg.background(38, 62, 62);
                for (let i = 0; i < 60; i++) {
                    pg.fill(30, 78, 66, 90);
                    const r = (80 + R() * 300) * S;
                    pg.ellipse(R() * w, R() * h, r, r * 0.7);
                }
                for (let i = 0; i < 260; i++) {   // leaves
                    pg.push();
                    pg.translate(R() * w, R() * h);
                    pg.rotate(R() * Math.PI);
                    pg.fill(52 + R() * 40, 108 + R() * 50, 58 + R() * 30, 200);
                    pg.ellipse(0, 0, (14 + R() * 60) * S, (5 + R() * 16) * S);
                    pg.pop();
                }
                const petal = [[244, 176, 190], [232, 128, 152], [206, 82, 116],
                               [250, 226, 226], [176, 52, 92]];
                for (let i = 0; i < 44; i++) {   // roses
                    const cx = R() * w, cy = R() * h;
                    const rad = (22 + R() * 62) * S;
                    const layers = 5 + ((R() * 4) | 0);
                    for (let k = layers; k > 0; k--) {
                        const c = petal[Math.min(petal.length - 1, layers - k)];
                        pg.fill(c[0], c[1], c[2], 235);
                        const rr = rad * (k / layers);
                        pg.ellipse(cx + (R() - 0.5) * rad * 0.22,
                                   cy + (R() - 0.5) * rad * 0.22, rr * 2, rr * 1.85);
                    }
                    pg.fill(150, 40, 78, 200);
                    pg.ellipse(cx, cy, rad * 0.3, rad * 0.3);
                }
            }
        }

        function buildThumbs() {
            const grid = document.getElementById('thumb-grid');
            BASE_PLATES.forEach(function (b) {
                const btn = document.createElement('button');
                btn.className = 'thumb';
                btn.id = 'thumb-' + b.id;
                const im = document.createElement('img');
                im.alt = b.name;

                if (b.video) {
                    im.onerror = function () { btn.remove(); b.missing = true; };
                    im.src = PLATE_ROOTS[0] + (b.poster || '');
                } else if (b.src) {
                    // A missing photograph should not leave a broken tile behind.
                    let root = 0;
                    im.onerror = function () {
                        if (root < PLATE_ROOTS.length - 1) { im.src = PLATE_ROOTS[++root] + b.src; }
                        else { btn.remove(); b.missing = true; }
                    };
                    im.src = PLATE_ROOTS[0] + b.src;
                } else {
                    const pg = paintPlate(b.id, 168, 108);
                    im.src = pg.canvas.toDataURL();
                    pg.remove();
                }
                const cap = document.createElement('span');
                cap.textContent = b.name;
                btn.appendChild(im);
                btn.appendChild(cap);
                btn.onclick = function () { useBasePlate(b.id, b.name); };
                grid.appendChild(btn);
            });
        }

        function markActiveThumb(id) {
            BASE_PLATES.forEach(function (b) {
                const el = document.getElementById('thumb-' + b.id);
                if (el) el.className = (b.id === id) ? 'thumb active' : 'thumb';
            });
        }

        function adoptPlateSurface(surface, id, name, note) {
            srcPixels = surface.pixels;
            srcW = surface.width;
            srcH = surface.height;
            srcCanvas = surface.canvas;
            srcTexDirty = true;
            activeBase = id;
            markActiveThumb(id);
            document.getElementById('drop-label').textContent = 'Or use your own';
            setSourceMeta(surface.canvas.toDataURL(), name, note);
            setSource('image');
        }

        function useBasePlate(id, name) {
            const meta = plateById(id);

            if (meta && meta.video) { useVideoPlate(meta, name); return; }

            if (meta && meta.src) {
                plateAnim = false;
                videoLive = false;
                if (plateVideo) plateVideo.pause();
                loadPlateBitmap(meta, function (img) {
                    if (srcHolder) srcHolder.remove();
                    srcHolder = createGraphics(img.width, img.height);
                    srcHolder.pixelDensity(1);
                    srcHolder.image(img, 0, 0, img.width, img.height);
                    try {
                        srcHolder.loadPixels();
                    } catch (err) {
                        // file:// taints the canvas, so pixels cannot be read back
                        console.warn('Cannot read pixels from ' + meta.src + ' — serve the page over http.');
                        return;
                    }
                    adoptPlateSurface(srcHolder, id, name, img.width + ' × ' + img.height + ' · built-in image');
                }, function () {
                    console.warn('Plate image missing: ' + meta.src);
                });
                return;
            }

            plateAnim = !!(meta && meta.anim);
            videoLive = false;
            if (plateVideo) plateVideo.pause();
            if (srcHolder) srcHolder.remove();
            // Animated plates stay square and small: the surface is repainted
            // and re-uploaded to the GPU on every frame.
            srcHolder = plateAnim ? paintPlate(id, 512, 512, 0)
                                  : paintPlate(id, 1100, 715);
            srcHolder.loadPixels();
            srcPixels = srcHolder.pixels;
            srcW = srcHolder.width;
            srcH = srcHolder.height;
            srcCanvas = srcHolder.canvas;
            srcTexDirty = true;
            activeBase = id;
            markActiveThumb(id);
            document.getElementById('drop-label').textContent = 'Or use your own';
            setSourceMeta(srcHolder.canvas.toDataURL(), name,
                plateAnim ? 'Built-in plate · animated'
                          : 'Built-in plate · generated from the plate seed');
            setSource('image');
            if (plateAnim) loop();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // WHAT THE SCOPE IS LOOKING AT
        // ═══════════════════════════════════════════════════════════════════════

        function setSourceMeta(url, name, note) {
            srcThumbURL = url;
            srcName = name;
            srcNote = note || '';

            ['src-preview', 'card-img'].forEach(function (id) {
                const el = document.getElementById(id);
                if (el) el.src = url;
            });
            document.getElementById('src-name').textContent = name;
            document.getElementById('src-note').textContent = srcNote;
            document.getElementById('card-title').textContent = name;
            document.getElementById('card-sub').textContent = srcNote;
            refreshSrcRegion();
        }

        // Marks the patch of the source the wedge is currently reading, so Zoom
        // and Pan are adjustable by eye rather than by trial and error.
        function refreshSrcRegion() {
            const box = document.getElementById('src-region');
            if (!box || !srcW || !srcH) return;
            const m = Math.min(srcW, srcH);
            const hx = params.imgZoom * m / srcW;
            const hy = params.imgZoom * m / srcH;
            box.style.left   = ((params.imgPanX - hx) * 100) + '%';
            box.style.top    = ((params.imgPanY - hy) * 100) + '%';
            box.style.width  = (hx * 200) + '%';
            box.style.height = (hy * 200) + '%';
            box.style.transform = 'rotate(' + (-params.imgAngle) + 'deg)';
        }

        let cardTimer = null;

        // The card says what the scope is reading, which matters for a moment
        // after choosing and then just sits on the artwork. Show it, then let it
        // go. Picking another source brings it back.
        function toggleImageLock() {
            imageLocked = !imageLocked;
            const el = document.getElementById('img-lock');
            if (el) el.className = imageLocked ? 'sec-btn on' : 'sec-btn';
        }

        function toggleSourceCard(on) {
            const el = document.getElementById('source-card');
            if (!el) return;
            if (cardTimer) { clearTimeout(cardTimer); cardTimer = null; }

            const show = on && srcThumbURL;
            el.classList.toggle('off', !show);
            el.classList.remove('faded');
            if (!show) return;

            cardTimer = setTimeout(function () {
                el.classList.add('faded');
                cardTimer = null;
            }, 10000);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CLOSED PALETTE
        // ═══════════════════════════════════════════════════════════════════════

        function hexToRgb(h) {
            const n = parseInt(h.slice(1), 16);
            return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        }

        function buildLUT() {
            const stops = params.colorPalette.map(hexToRgb);
            const n = stops.length;
            for (let i = 0; i < 256; i++) {
                const p = (i / 256) * n;
                const k = Math.floor(p);
                const f = p - k;
                const a = stops[k % n], b = stops[(k + 1) % n];
                lut[i * 3]     = a[0] + (b[0] - a[0]) * f;
                lut[i * 3 + 1] = a[1] + (b[1] - a[1]) * f;
                lut[i * 3 + 2] = a[2] + (b[2] - a[2]) * f;
            }
        }

        // Reflect a coordinate back into [0,1] so the source tiles seamlessly
        // instead of clamping to a smear at the edges.
        function mirrorWrap(x) {
            const a = Math.abs(x) % 2;
            return a > 1 ? 2 - a : a;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // THE FIELD ON THE GPU
        //
        // The same field as the CPU path below, ported to a fragment shader.
        // Solving it per frame on the GPU costs less than copying the solved
        // pixels out of a buffer once, so parameter changes stop being a stall
        // and animation stops being a budget. The CPU path is kept as the
        // fallback for machines without WebGL.
        // ═══════════════════════════════════════════════════════════════════════

        const FIELD_SIDE = 1024;
        let gl = null, glCanvas = null;
        let fieldProg = null, colourProg = null;
        let fieldTarget = null, imgTarget = null, srcTex = null;
        let glReady = false, srcTexDirty = true, glSeed = -1;
        let fieldDirty = true;

        const VERT_SRC = [
            'attribute vec2 aPos;',
            'varying vec2 vPos;',
            'void main() {',
            // y flipped so the field matches the CPU buffer's row order
            '    vPos = vec2(aPos.x, -aPos.y);',
            '    gl_Position = vec4(aPos, 0.0, 1.0);',
            '}'
        ].join('\n');

        const FRAG_SRC = [
            'precision highp float;',
            'varying vec2 vPos;',
            'uniform sampler2D uSrc;',
            'uniform float uSeed;',
            'uniform int uPass, uTess, uOct;',
            'uniform float uFolds, uRot, uDescent, uAngular, uTwist, uWarp;',
            'uniform float uMoire, uMFreq, uDetune, uBands, uRings, uContrast;',
            'uniform float uPhaseX, uPhaseY, uRipple;',
            'uniform float uZX, uZY, uPanX, uPanY, uIC, uIS, uIW;',

            // Gradient noise with an arithmetic hash rather than a permutation
            // texture. Same construction as the CPU version — quintic fade,
            // corner gradients, bilinear blend — but 60 dependent texture reads
            // per pixel was the whole frame budget, and this costs none.
            'vec2 hash2(vec2 p) {',
            '    vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));',
            '    p3 += dot(p3, p3.yzx + 33.33 + uSeed);',
            '    return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;',
            '}',

            'float pnoise(float x, float y) {',
            '    vec2 P = vec2(x, y);',
            '    vec2 i = floor(P);',
            '    vec2 f = P - i;',
            '    vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);',
            '    float n00 = dot(hash2(i), f);',
            '    float n10 = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));',
            '    float n01 = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));',
            '    float n11 = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));',
            '    return 1.4 * mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);',
            '}',

            'float fbm(float x, float y) {',
            '    float amp = 0.5, freq = 1.0, sum = 0.0;',
            '    for (int i = 0; i < 6; i++) {',
            '        if (i >= uOct) break;',
            '        sum += amp * pnoise(x * freq, y * freq);',
            '        freq *= 2.03;',   // slightly off 2.0 — kills grid resonance
            '        amp *= 0.5;',
            '    }',
            '    return sum;',
            '}',

            'float mirrorWrap(float x) {',
            '    float a = mod(abs(x), 2.0);',
            '    return a > 1.0 ? 2.0 - a : a;',
            '}',

            'void main() {',
            '    float dx = vPos.x, dy = vPos.y;',
            '    float r = sqrt(dx * dx + dy * dy);',
            '    float th, lr, u, v;',
            '    if (uTess == 1) {',
            '        th = 0.0;',
            '        lr = r * r * 1.5;',
            '        u = dx * uDescent * 1.1 + dy * uTwist * 1.4;',
            '        v = dy * uAngular * 2.2;',
            '    } else {',
            '        float wedge = 6.28318530718 / uFolds;',
            '        float hw = wedge * 0.5;',
            '        th = atan(dy, dx) - uRot;',
            '        th = th - floor(th / wedge) * wedge;',
            '        if (th > hw) th = wedge - th;',
            '        lr = log(r + 0.045) * uDescent;',
            '        u = lr + th * uTwist * 4.0;',
            '        v = th * uAngular * 6.0 + uPhaseY * 0.01;',
            '    }',

            '    float q1 = fbm(u + uPhaseX, v);',
            '    float q2 = fbm(u + 5.2 + uPhaseX, v + 1.3);',
            '    float s1 = fbm(u + uWarp * q1 + 1.7, v + uWarp * q2 + 9.2);',
            '    float s2 = fbm(u + uWarp * q1 + 8.3, v + uWarp * q2 + 2.8);',
            '    float wu = u + uWarp * s1 * uRipple;',
            '    float wv = v + uWarp * s2 * uRipple;',
            '    float f = fbm(wu, wv) * uContrast;',
            '    float mo = sin(wu * uMFreq) * sin(wv * uMFreq * uDetune);',

            // uPass 0 writes the solved field: phase packed across two bytes so
            // animation can slide it smoothly, plus the shade. uPass 1 writes the
            // sampled source. Neither depends on palette or phase, so both
            // survive until a parameter that shapes the field actually changes.
            '    if (uPass == 1) {',
            '        float sx = (uTess == 1 ? dx : r * cos(th)) + s1 * uIW;',
            '        float sy = (uTess == 1 ? dy : r * sin(th)) + s2 * uIW;',
            '        float rx = sx * uIC - sy * uIS;',
            '        float ry = sx * uIS + sy * uIC;',
            '        vec2 uv = vec2(mirrorWrap(rx * uZX + uPanX), mirrorWrap(ry * uZY + uPanY));',
            '        gl_FragColor = vec4(texture2D(uSrc, uv).rgb, 1.0);',
            '        return;',
            '    }',

            '    float t = fract(f * uBands + lr * uRings * 0.16 + mo * uMoire);',
            '    float sh = clamp(1.0 + 0.45 * s1, 0.45, 1.55);',
            '    float t16 = floor(t * 65535.0);',
            '    gl_FragColor = vec4(floor(t16 / 256.0) / 255.0,',
            '                        mod(t16, 256.0) / 255.0,',
            '                        (sh - 0.45) / 1.1, 1.0);',
            '}'
        ].join('\n');

        // Per frame: two texture reads and a palette ramp. This is the only
        // thing that has to keep up with the display.
        const COLOUR_SRC = [
            'precision highp float;',
            'varying vec2 vPos;',
            'uniform sampler2D uField;',
            'uniform sampler2D uImg;',
            'uniform int uUseImage;',
            'uniform float uMix, uSeam, uShift;',
            'uniform vec3 uPal0, uPal1, uPal2, uPal3, uPal4;',

            'vec3 palAt(float k) {',
            '    float m = mod(k, 5.0);',
            '    if (m < 0.5) return uPal0;',
            '    if (m < 1.5) return uPal1;',
            '    if (m < 2.5) return uPal2;',
            '    if (m < 3.5) return uPal3;',
            '    return uPal4;',
            '}',

            'void main() {',
            '    vec2 uv = vec2(vPos.x, -vPos.y) * 0.5 + 0.5;',
            '    vec4 fld = texture2D(uField, uv);',
            '    float t = fract((floor(fld.r * 255.0 + 0.5) * 256.0',
            '                   + floor(fld.g * 255.0 + 0.5)) / 65535.0 + uShift);',
            '    float sh = fld.b * 1.1 + 0.45;',

            '    float p = t * 5.0;',
            '    float k = floor(p);',
            '    vec3 col = mix(palAt(k), palAt(k + 1.0), p - k);',

            '    float e = 1.0 - abs(t * 2.0 - 1.0);',
            '    float e4 = e * e * e * e;',
            '    float glow = uSeam * e4 * e4 * 0.92156;',

            '    vec3 outc;',
            '    if (uUseImage == 1) {',
            '        vec3 im = texture2D(uImg, uv).rgb;',
            '        outc = mix(im, col, uMix) * (1.0 + (sh - 1.0) * uMix) + glow * uMix;',
            '    } else {',
            '        outc = col * sh + glow;',
            '    }',
            '    gl_FragColor = vec4(outc, 1.0);',
            '}'
        ].join('\n');

        function compile(type, src) {
            const s = gl.createShader(type);
            gl.shaderSource(s, src);
            gl.compileShader(s);
            if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
                console.warn('shader:', gl.getShaderInfoLog(s));
                return null;
            }
            return s;
        }

        function makeProgram(fragSrc, names) {
            const vs = compile(gl.VERTEX_SHADER, VERT_SRC);
            const fs = compile(gl.FRAGMENT_SHADER, fragSrc);
            if (!vs || !fs) return null;
            const pr = gl.createProgram();
            gl.attachShader(pr, vs);
            gl.attachShader(pr, fs);
            gl.bindAttribLocation(pr, 0, 'aPos');
            gl.linkProgram(pr);
            if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) {
                console.warn('link:', gl.getProgramInfoLog(pr));
                return null;
            }
            const u = {};
            names.forEach(function (n) { u[n] = gl.getUniformLocation(pr, n); });
            return { prog: pr, u: u };
        }

        function makeTarget(side) {
            const tex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, tex);
            // NEAREST is not optional: the phase is packed across two bytes and
            // interpolating them would blend high bits into low ones.
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, side, side, 0,
                gl.RGBA, gl.UNSIGNED_BYTE, null);
            const fb = gl.createFramebuffer();
            gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
            gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                gl.TEXTURE_2D, tex, 0);
            const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            return ok ? { tex: tex, fb: fb } : null;
        }

        function initGL() {
            glCanvas = document.createElement('canvas');
            glCanvas.width = glCanvas.height = FIELD_SIDE;
            gl = glCanvas.getContext('webgl', {
                antialias: false, depth: false, stencil: false, alpha: false,
                preserveDrawingBuffer: true
            });
            if (!gl) return false;

            fieldProg = makeProgram(FRAG_SRC,
                ['uSrc', 'uSeed', 'uPass', 'uTess', 'uOct', 'uFolds', 'uRot', 'uDescent',
                 'uAngular', 'uTwist', 'uWarp', 'uMoire', 'uMFreq', 'uDetune', 'uBands',
                 'uRings', 'uContrast', 'uPhaseX', 'uPhaseY', 'uRipple', 'uZX', 'uZY',
                 'uPanX', 'uPanY', 'uIC', 'uIS', 'uIW']);
            colourProg = makeProgram(COLOUR_SRC,
                ['uField', 'uImg', 'uUseImage', 'uMix', 'uSeam', 'uShift',
                 'uPal0', 'uPal1', 'uPal2', 'uPal3', 'uPal4']);
            if (!fieldProg || !colourProg) return false;

            const buf = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buf);
            gl.bufferData(gl.ARRAY_BUFFER,
                new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
            gl.enableVertexAttribArray(0);
            gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

            fieldTarget = makeTarget(FIELD_SIDE);
            imgTarget = makeTarget(FIELD_SIDE);
            if (!fieldTarget || !imgTarget) return false;

            srcTex = gl.createTexture();
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

            gl.viewport(0, 0, FIELD_SIDE, FIELD_SIDE);
            return true;
        }

        // The source is uploaded once per image, not per frame.
        function uploadSrcTex() {
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
            if (srcCanvas) {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, srcCanvas);
            } else {
                gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA,
                    gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
            }
            srcTexDirty = false;
        }

        // Expensive, and only run when a parameter that shapes the field moves.
        function glRenderField() {
            if (params.seed !== glSeed) {
                seedNoise(params.seed);
                glSeed = params.seed;
            }
            if (srcTexDirty) uploadSrcTex();

            const P = fieldProg;
            gl.useProgram(P.prog);
            gl.activeTexture(gl.TEXTURE2);
            gl.bindTexture(gl.TEXTURE_2D, srcTex);
            gl.uniform1i(P.u.uSrc, 2);

            const tess = params.tiling !== 'radial';
            const m = Math.min(srcW || 1, srcH || 1);
            const ia = params.imgAngle * Math.PI / 180;

            gl.uniform1i(P.u.uTess, tess ? 1 : 0);
            gl.uniform1i(P.u.uOct, params.octaves);
            gl.uniform1f(P.u.uSeed, (params.seed % 9973) * 0.6180339887);
            gl.uniform1f(P.u.uFolds, params.folds);
            gl.uniform1f(P.u.uRot, params.rotation * Math.PI / 180);
            gl.uniform1f(P.u.uDescent, params.descent);
            gl.uniform1f(P.u.uAngular, params.angular);
            gl.uniform1f(P.u.uTwist, params.twist);
            gl.uniform1f(P.u.uWarp, params.warp);
            gl.uniform1f(P.u.uMoire, params.moire);
            gl.uniform1f(P.u.uMFreq, params.mfreq);
            gl.uniform1f(P.u.uDetune, params.detune);
            gl.uniform1f(P.u.uBands, params.bands);
            gl.uniform1f(P.u.uRings, params.rings);
            gl.uniform1f(P.u.uContrast, params.contrast);
            gl.uniform1f(P.u.uPhaseX, phaseX);
            gl.uniform1f(P.u.uPhaseY, phaseY);
            gl.uniform1f(P.u.uRipple, ripple);
            gl.uniform1f(P.u.uZX, params.imgZoom * m / (srcW || 1));
            gl.uniform1f(P.u.uZY, params.imgZoom * m / (srcH || 1));
            gl.uniform1f(P.u.uPanX, params.imgPanX);
            gl.uniform1f(P.u.uPanY, params.imgPanY);
            gl.uniform1f(P.u.uIC, Math.cos(ia));
            gl.uniform1f(P.u.uIS, Math.sin(ia));
            gl.uniform1f(P.u.uIW, params.imgWarp);

            gl.bindFramebuffer(gl.FRAMEBUFFER, fieldTarget.fb);
            gl.uniform1i(P.u.uPass, 0);
            gl.drawArrays(gl.TRIANGLES, 0, 3);

            if (params.source === 'image' && srcCanvas) {
                gl.bindFramebuffer(gl.FRAMEBUFFER, imgTarget.fb);
                gl.uniform1i(P.u.uPass, 1);
                gl.drawArrays(gl.TRIANGLES, 0, 3);
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            fieldDirty = false;
        }

        // Cheap, and this is the one that runs every frame.
        function glRenderColour() {
            const P = colourProg;
            gl.useProgram(P.prog);

            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, fieldTarget.tex);
            gl.uniform1i(P.u.uField, 0);
            gl.activeTexture(gl.TEXTURE1);
            gl.bindTexture(gl.TEXTURE_2D, imgTarget.tex);
            gl.uniform1i(P.u.uImg, 1);

            const useImage = (params.source === 'image' && srcCanvas) ? 1 : 0;
            gl.uniform1i(P.u.uUseImage, useImage);
            gl.uniform1f(P.u.uMix, useImage ? params.mix : 1);
            gl.uniform1f(P.u.uSeam, params.seam);
            gl.uniform1f(P.u.uShift, params.shift + animPhase + 1000);
            for (let i = 0; i < 5; i++) {
                const c = hexToRgb(params.colorPalette[i]);
                gl.uniform3f(P.u['uPal' + i], c[0] / 255, c[1] / 255, c[2] / 255);
            }

            gl.bindFramebuffer(gl.FRAMEBUFFER, null);
            gl.drawArrays(gl.TRIANGLES, 0, 3);
        }

        function glRender() {
            if (fieldDirty) glRenderField();
            glRenderColour();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // THE FIELD — solved once, cached as a scalar (+ sampled source colour)
        // ═══════════════════════════════════════════════════════════════════════

        function computeField(side) {
            seedNoise(params.seed);

            // In tessellated modes the buffer is one cell, drawn small and many
            // times over — it never needs the full-frame resolution.
            const tess = params.tiling !== 'radial';
            if (tess) side = Math.min(side, 660);

            const n = side * side;
            cacheT = new Uint16Array(n);
            cacheS = new Uint8Array(n);

            const useImage = params.source === 'image' && srcPixels !== null;
            cachedImage = useImage;
            if (useImage) {
                cacheIR = new Uint8Array(n);
                cacheIG = new Uint8Array(n);
                cacheIB = new Uint8Array(n);
            }

            img = createImage(side, side);
            cacheSide = side;

            const c = side / 2;
            const scale = 1 / (side / 2);
            const wedge = (Math.PI * 2) / params.folds;
            const half = wedge / 2;
            const base = params.rotation * Math.PI / 180;

            const oct = params.octaves;
            const W = params.warp;
            const D = params.descent;
            const A = params.angular;
            const T = params.twist;
            const M = params.moire;
            const MF = params.mfreq;
            const DT = params.detune;
            const bands = params.bands;
            const rings = params.rings;
            const contrast = params.contrast;
            const IW = params.imgWarp;

            // Sampling is set up so that one unit of wedge space covers the same
            // number of source pixels horizontally as vertically — otherwise a
            // portrait gets squeezed into the square buffer and the face smears.
            const m = Math.min(srcW || 1, srcH || 1);
            const IZ = params.imgZoom;
            const ZX = IZ * m / (srcW || 1);
            const ZY = IZ * m / (srcH || 1);
            const IA = params.imgAngle * Math.PI / 180;
            const IC = Math.cos(IA), IS = Math.sin(IA);
            const PX = params.imgPanX;
            const PY = params.imgPanY;
            const sw1 = srcW - 1, sh1 = srcH - 1;

            for (let y = 0; y < side; y++) {
                const dy = (y - c) * scale;
                for (let x = 0; x < side; x++) {
                    const dx = (x - c) * scale;
                    const i = y * side + x;

                    const r = Math.sqrt(dx * dx + dy * dy);
                    let th, lr, u, v;

                    if (tess) {
                        // Polycentral cell. No radial fold here — the tiling
                        // supplies the symmetry by reflecting the cell across
                        // its own edges, so the cell itself holds a plain field.
                        th = 0;
                        lr = r * r * 1.5;                    // rings from cell centre
                        u = dx * D * 1.1 + dy * T * 1.4;     // Descent → scale
                        v = dy * A * 2.2;                    // Angular → scale
                    } else {
                        // ── polar, then kaleidoscope fold: wrap into one wedge
                        //    and mirror it
                        th = Math.atan2(dy, dx) - base;
                        th = th - Math.floor(th / wedge) * wedge;
                        if (th > half) th = wedge - th;

                        // ── logarithmic descent + angular shear (the spiral)
                        lr = Math.log(r + 0.045) * D;
                        u = lr + th * T * 4;
                        v = th * A * 6 + phaseY * 0.01;
                    }

                    // ── iterated domain warp
                    const q1 = fbm(u + phaseX, v, oct);
                    const q2 = fbm(u + 5.2 + phaseX, v + 1.3, oct);

                    const s1 = fbm(u + W * q1 + 1.7, v + W * q2 + 9.2, oct);
                    const s2 = fbm(u + W * q1 + 8.3, v + W * q2 + 2.8, oct);

                    // ── the warped coordinate. Everything downstream reads from
                    //    here, so the fringes inherit the distortion.
                    const wu = u + W * s1 * ripple;
                    const wv = v + W * s2 * ripple;

                    const f = fbm(wu, wv, oct) * contrast;

                    // ── moiré: two detuned periodic systems interfering, evaluated
                    //    in warped space so the fringes bend where the space does
                    const mo = Math.sin(wu * MF) * Math.sin(wv * MF * DT);

                    // ── the scalar. Palette phase is deliberately NOT baked in.
                    //    Stored as 16-bit fixed point: the fraction is all that
                    //    matters, and adding phase then wraps on its own.
                    const tv = f * bands + lr * rings * 0.16 + mo * M;
                    cacheT[i] = (tv - Math.floor(tv)) * 65536;

                    let sh = 1.0 + 0.45 * s1;
                    if (sh < SH_MIN) sh = SH_MIN;
                    else if (sh > 1.55) sh = 1.55;
                    cacheS[i] = ((sh - SH_MIN) / SH_SPAN) * 255;

                    // ── source sampling: the folded wedge coordinate, optionally
                    //    displaced by the same warp field, read back into the
                    //    source bitmap. Bilinear, because nearest-neighbour on a
                    //    stretched wedge is what turns a face into speckle.
                    if (useImage) {
                        const sx = (tess ? dx : r * Math.cos(th)) + s1 * IW;
                        const sy = (tess ? dy : r * Math.sin(th)) + s2 * IW;

                        const rx = sx * IC - sy * IS;
                        const ry = sx * IS + sy * IC;

                        const ux = mirrorWrap(rx * ZX + PX);
                        const uy = mirrorWrap(ry * ZY + PY);

                        const fxp = ux * sw1, fyp = uy * sh1;
                        const x0 = fxp | 0, y0 = fyp | 0;
                        const x1 = x0 < sw1 ? x0 + 1 : x0;
                        const y1 = y0 < sh1 ? y0 + 1 : y0;
                        const ax = fxp - x0, ay = fyp - y0;
                        const iax = 1 - ax;

                        const r0 = y0 * srcW, r1 = y1 * srcW;
                        const o00 = (r0 + x0) * 4, o10 = (r0 + x1) * 4;
                        const o01 = (r1 + x0) * 4, o11 = (r1 + x1) * 4;

                        const t0R = srcPixels[o00] * iax + srcPixels[o10] * ax;
                        const t1R = srcPixels[o01] * iax + srcPixels[o11] * ax;
                        const t0G = srcPixels[o00 + 1] * iax + srcPixels[o10 + 1] * ax;
                        const t1G = srcPixels[o01 + 1] * iax + srcPixels[o11 + 1] * ax;
                        const t0B = srcPixels[o00 + 2] * iax + srcPixels[o10 + 2] * ax;
                        const t1B = srcPixels[o01 + 2] * iax + srcPixels[o11 + 2] * ax;

                        cacheIR[i] = t0R + (t1R - t0R) * ay;
                        cacheIG[i] = t0G + (t1G - t0G) * ay;
                        cacheIB[i] = t0B + (t1B - t0B) * ay;
                    }
                }
            }

            paintField();
        }

        // Palette, seam glow and shading depend only on (phase, shade) — two
        // bytes — so the whole lot collapses into one 64K table that survives
        // until the palette actually changes. Animation only moves the phase.
        function buildTables() {
            buildLUT();
            const seam = params.seam;
            for (let i = 0; i < 256; i++) {
                palR[i] = lut[i * 3];
                palG[i] = lut[i * 3 + 1];
                palB[i] = lut[i * 3 + 2];
                const t = i / 256;
                const e = 1 - Math.abs(t * 2 - 1);
                const e4 = e * e * e * e;
                glowT[i] = seam * e4 * e4 * 235;
            }
            for (let q = 0; q < 256; q++) {
                const sh = shadeT[q];
                const row = q << 8;
                for (let i = 0; i < 256; i++) {
                    const k = row + i;
                    const g = glowT[i];
                    combR[k] = palR[i] * sh + g;
                    combG[k] = palG[i] * sh + g;
                    combB[k] = palB[i] * sh + g;
                }
            }
            tablesDirty = false;
        }

        // Cheap pass: scalar → colour. This is what animates.
        function paintField() {
            if (glReady) { glRender(); return; }
            if (!cacheT) return;
            if (tablesDirty) buildTables();

            img.loadPixels();
            const px = img.pixels;
            const n = cacheSide * cacheSide;
            const useImage = cachedImage;
            const mix = useImage ? params.mix : 1;

            // Phase as the same 16-bit fixed point the field is stored in, so
            // the wrap is just integer overflow inside the mask.
            let phf = params.shift + animPhase + 1000;
            phf = phf - Math.floor(phf);
            const ph = (phf * 65536) | 0;

            const T = cacheT, S = cacheS;

            if (!useImage) {
                // Pure field: one table read per channel, no arithmetic.
                for (let i = 0, i4 = 0; i < n; i++, i4 += 4) {
                    const k = (S[i] << 8) | (((T[i] + ph) & 0xffff) >>> 8);
                    px[i4]     = combR[k];
                    px[i4 + 1] = combG[k];
                    px[i4 + 2] = combB[k];
                    px[i4 + 3] = 255;
                }
            } else if (mix === 0) {
                // Pure image: the scope is a mirror, nothing is repainted.
                for (let i = 0, i4 = 0; i < n; i++, i4 += 4) {
                    px[i4]     = cacheIR[i];
                    px[i4 + 1] = cacheIG[i];
                    px[i4 + 2] = cacheIB[i];
                    px[i4 + 3] = 255;
                }
            } else {
                // Blend. The field's shading and seam glow are part of the field,
                // so they fade out with it rather than staying on top.
                const inv = 1 - mix;
                for (let i = 0, i4 = 0; i < n; i++, i4 += 4) {
                    const idx = ((T[i] + ph) & 0xffff) >>> 8;
                    const shade = 1 + (shadeT[S[i]] - 1) * mix;
                    const lift = glowT[idx] * mix;
                    px[i4]     = (cacheIR[i] * inv + palR[idx] * mix) * shade + lift;
                    px[i4 + 1] = (cacheIG[i] * inv + palG[idx] * mix) * shade + lift;
                    px[i4 + 2] = (cacheIB[i] * inv + palB[idx] * mix) * shade + lift;
                    px[i4 + 3] = 255;
                }
            }

            img.updatePixels();
        }

        function setStatus(on) {
            const el = document.getElementById('status');
            if (el) el.className = on ? 'on' : '';
        }

        // Structural change: draft immediately, full resolution once idle.
        function scheduleRender() {
            if (glReady) { fieldDirty = true; redraw(); return; }
            if (hiTimer) clearTimeout(hiTimer);

            if (animating) {
                computeField(ANIM_SIDE);
                return;
            }

            computeField(PREVIEW_SIDE);
            redraw();
            setStatus(true);
            hiTimer = setTimeout(function () {
                requestAnimationFrame(function () {
                    requestAnimationFrame(function () {
                        computeField(FULL_SIDE);
                        setStatus(false);
                        redraw();
                    });
                });
            }, 280);
        }

        // Colour-only change: skip the field entirely.
        function recolour() {
            refreshShareUI();
            paintField();
            redraw();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // CANVAS
        // ═══════════════════════════════════════════════════════════════════════

        function setup() {
            const cnv = createCanvas(windowWidth, windowHeight);
            cnv.parent('canvas-wrap');
            pixelDensity(1);
            imageMode(CENTER);
            noLoop();
            buildThumbs();
            attachDrag(cnv.elt);

            seedNoise(params.seed);
            try { glReady = initGL(); } catch (e) { glReady = false; }
            if (!glReady) console.warn('WebGL unavailable — using the CPU field.');
            scheduleRender();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // DRAG TO TURN — the one interaction a real scope has
        // ═══════════════════════════════════════════════════════════════════════

        function ptrAngle(px, py) {
            return Math.atan2(py - height / 2, px - width / 2);
        }

        function startDrag(px, py) {
            dragging = true;
            dragVel = 0;
            lastPtr = ptrAngle(px, py);
            loop();
        }

        function moveDrag(px, py) {
            if (!dragging) return;
            const a = ptrAngle(px, py);
            let d = a - lastPtr;
            if (d > Math.PI) d -= Math.PI * 2;      // shortest way round
            if (d < -Math.PI) d += Math.PI * 2;
            spinAngle += d;
            dragVel = d;
            lastPtr = a;
        }

        function endDrag() { dragging = false; }

        function attachDrag(el) {
            el.addEventListener('mousedown', function (e) {
                e.preventDefault();
                startDrag(e.clientX, e.clientY);
            });
            window.addEventListener('mousemove', function (e) {
                moveDrag(e.clientX, e.clientY);
            });
            window.addEventListener('mouseup', endDrag);

            el.addEventListener('touchstart', function (e) {
                if (e.touches[0]) startDrag(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            window.addEventListener('touchmove', function (e) {
                if (dragging && e.touches[0]) moveDrag(e.touches[0].clientX, e.touches[0].clientY);
            }, { passive: true });
            window.addEventListener('touchend', endDrag);
        }

        function setTiling(mode) {
            params.tiling = mode;
            ['radial', 'triangle', 'square'].forEach(function (m) {
                document.getElementById('tile-' + m).className =
                    (m === mode) ? 'shape active' : 'shape';
            });
            document.getElementById('tess-controls').className = (mode === 'radial') ? 'off' : '';
            refreshShareUI();
            scheduleRender();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // INTRO — the scope is already running underneath it
        // ═══════════════════════════════════════════════════════════════════════

        function enterStudio() {
            document.getElementById('intro').classList.add('gone');
            document.getElementById('dock').classList.add('up');
        }


        // Clicking the disc itself does nothing — there is a link on it. Clicking
        // past it means you have seen enough.
        function introBackdropClick(e) {
            if (e.target.closest('.intro-card')) return;
            enterStudio();
        }

        // Straight from the welcome to the link for whatever is behind it.
        function shareFromIntro(e) {
            if (e) e.stopPropagation();
            enterStudio();
            openPanel('share');
        }

        // Fullscreen. The canvas already fills the viewport, so this only has to
        // take the browser chrome out of the way and keep the icon honest.
        function toggleFullscreen() {
            const el = document.documentElement;
            if (!document.fullscreenElement) {
                (el.requestFullscreen || el.webkitRequestFullscreen || function () {}).call(el);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen || function () {}).call(document);
            }
        }

        function syncFullscreenIcon() {
            const on = !!document.fullscreenElement;
            const btn = document.getElementById('dock-fs');
            if (!btn) return;
            btn.className = 'dock-btn' + (on ? ' on' : '');
        }

        document.addEventListener('fullscreenchange', syncFullscreenIcon);
        document.addEventListener('webkitfullscreenchange', syncFullscreenIcon);

        // Keyboard. Ignored while a field has focus, and while the intro is up
        // apart from the key that dismisses it.
        window.addEventListener('keydown', function (e) {
            const t = e.target;
            if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
            if (e.metaKey || e.ctrlKey || e.altKey) return;

            const introUp = !document.getElementById('intro').classList.contains('gone');
            if (introUp) {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') {
                    e.preventDefault();
                    enterStudio();
                }
                return;
            }

            const n = parseInt(e.key, 10);
            if (n >= 1 && n <= PANELS.length) { e.preventDefault(); openPanel(PANELS[n - 1]); return; }

            switch (e.key.toLowerCase()) {
                case 'escape': e.preventDefault(); if (cinema) toggleCinema(false); else closePanel(); break;
                case 'h':      e.preventDefault(); toggleCinema(); break;
                case 'f':      e.preventDefault(); toggleFullscreen(); break;
                case 'r':      e.preventDefault(); randomSeedAndUpdate(); break;
                case 'a':      e.preventDefault(); toggleAnimate(); break;
                case 's':      e.preventDefault(); downloadPNG(); break;
                case 'i':      e.preventDefault(); showIntro(); break;
                case '?':      e.preventDefault(); showIntro(); break;
            }
        });

        function showIntro() {
            document.getElementById('intro').classList.remove('gone');
        }

        function needsLoop() {
            return animating || dragging || Math.abs(dragVel) > 0.0004 ||
                   params.breath !== 'off' ||
                   (plateAnim && params.source === 'image') ||
                   anySectionAuto() || fadeAmt > 0;
        }

        function draw() {
            if (animating) {
                if (params.breath === 'off') {
                    const rate = motionRate();
                    animPhase += params.flow * 0.005 * rate;
                    spinAngle += params.spin * 0.008 * rate;
                }
                paintField();
            }

            // Flick momentum: released angular velocity coasting to a stop.
            if (!dragging && Math.abs(dragVel) > 0.0004) {
                spinAngle += dragVel;
                dragVel *= 0.985;
            } else if (!dragging) {
                dragVel = 0;
            }

            const nowMs = performance.now();
            if (breathLast === 0) breathLast = nowMs;
            const breathDt = Math.min(0.25, (nowMs - breathLast) / 1000);
            breathLast = nowMs;
            if (params.breath !== 'off') {
                stepBreath(breathDt);
                // Colour Flow becomes a swing rather than a scroll: forward on
                // the way in, back on the way out. Scaled by dt so the pace does
                // not depend on the frame rate.
                const f = 60 * breathDt * motionRate();
                animPhase += params.flow * 0.005 * breathFlow * (0.4 + params.breathDepth) * f;
                spinAngle += params.spin * 0.008 * BREATH_SPIN * f;
                const g = document.getElementById('breath-stage');
                if (g && g.textContent !== breathStage) g.textContent = breathStage;
                const ring = document.getElementById('breath-ring');
                if (ring) ring.style.transform = 'scale(' + (0.62 + breathValue * 0.38) + ')';
                if (params.breathGuide) drawOrb();
                tablesDirty = true;
            }

            if (anySectionAuto()) stepSections(nowMs);

            if (plateAnim && params.source === 'image') {
                if (videoLive && plateVideo && plateVideo.readyState >= 2) {
                    videoCtx.drawImage(plateVideo, 0, 0, videoCv.width, videoCv.height);
                    srcTexDirty = true;
                    fieldDirty = true;
                } else if (srcHolder && activeBase) {
                    platePhase += 0.011;          // ~1.5 s per wink at 60fps
                    drawPlate(srcHolder, activeBase, srcHolder.width, srcHolder.height, platePhase);
                    srcTexDirty = true;
                    fieldDirty = true;            // the sampled source moved
                }
            }

            if (!fieldCanvas()) { if (!needsLoop()) noLoop(); return; }
            if (glReady) glRender();

            const ctx = drawingContext;

            if (params.trail > 0) {
                // Don't clear — cross-fade against the previous frame. A thin
                // dark wash each frame stops the accumulation running away.
                noStroke();
                fill(5, 5, 10, 26);
                rect(0, 0, width, height);
                ctx.globalAlpha = 1 - params.trail;
            } else {
                background(5, 5, 10);
                ctx.globalAlpha = 1;
            }

            if (params.tiling === 'square') {
                drawSquareTiling(ctx, width, height);
            } else if (params.tiling === 'triangle') {
                drawTriangleTiling(ctx, width, height);
            } else {
                // The buffer is square; drawn at the viewport diagonal it covers
                // the frame at any rotation, so spin never exposes a corner.
                const puff = 1 + (breathValue - 0.5) * params.breathDepth * 0.09;
                const D = Math.sqrt(width * width + height * height) * puff;
                ctx.save();
                ctx.translate(width / 2, height / 2);
                if (spinAngle !== 0) ctx.rotate(spinAngle);
                ctx.drawImage(fieldCanvas(), -D / 2, -D / 2, D, D);
                ctx.restore();
            }

            // Cross-dissolve out of whatever was on screen before a hard switch.
            if (fadeAmt > 0 && fadeCv) {
                ctx.globalAlpha = fadeAmt;
                ctx.drawImage(fadeCv, 0, 0, width, height);
                // Dissolve across roughly one beat, whatever the frame rate.
                fadeAmt -= Math.max(0.006, 16.7 / beatMs());
                if (fadeAmt < 0) fadeAmt = 0;
            }

            ctx.globalAlpha = 1;
            applyEdgeMask(ctx, width, height);
            if (!needsLoop()) noLoop();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // POLYCENTRAL TILING
        //
        // Geometry adapted from Kazuhiko Arase's kaleidoscope.js (MIT, 2014).
        // Only four shapes tile the plane by edge reflection; the equilateral
        // triangle and the rectangle are the two worth having. Note the
        // counter-rotation inside each clipped cell: the mirrors turn, the
        // contents do not, which is what a real scope does.
        // ═══════════════════════════════════════════════════════════════════════

        // ═══════════════════════════════════════════════════════════════════════
        // EDGE MASK
        //
        // Floats the piece on black. The boundary follows the fold count rather
        // than being a plain circle, and is always blurred — a hard cut looks
        // like a crop, where a soft one looks like the end of the mirrors.
        // ═══════════════════════════════════════════════════════════════════════

        const EDGE_SHAPES = ['off', 'circle', 'petal', 'scallop', 'bloom'];
        let maskCv = null, maskCtx = null, maskKey = '';

        function edgePath(ctx, cx, cy, R, lobes, amp) {
            const STEPS = 512;
            ctx.beginPath();
            for (let i = 0; i <= STEPS; i++) {
                const a = (i / STEPS) * Math.PI * 2;
                const r = R * (1 + amp * Math.cos(a * lobes));
                const x = cx + r * Math.cos(a), y = cy + r * Math.sin(a);
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.closePath();
        }

        // Rebuilt only when the shape, size, softness, folds or canvas change.
        function buildMask(w, h) {
            const key = [params.edgeMask, params.edgeSize, params.edgeSoft,
                         params.folds, w, h].join('|');
            if (key === maskKey && maskCv) return maskCv;

            if (!maskCv) { maskCv = document.createElement('canvas'); maskCtx = maskCv.getContext('2d'); }
            if (maskCv.width !== w || maskCv.height !== h) { maskCv.width = w; maskCv.height = h; }

            const c = maskCtx;
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.clearRect(0, 0, w, h);

            const R = Math.min(w, h) / 2 * params.edgeSize;
            const folds = Math.max(3, params.folds);

            let lobes = 0, amp = 0;
            if (params.edgeMask === 'petal')   { lobes = folds;     amp = 0.13; }
            if (params.edgeMask === 'scallop') { lobes = folds * 2; amp = 0.06; }
            if (params.edgeMask === 'bloom')   { lobes = folds;     amp = 0.24; }

            c.filter = 'blur(' + Math.max(1, params.edgeSoft) + 'px)';
            c.fillStyle = '#fff';
            edgePath(c, w / 2, h / 2, R, lobes, amp);
            c.fill();
            c.filter = 'none';

            maskKey = key;
            return maskCv;
        }

        function applyEdgeMask(ctx, w, h) {
            if (params.edgeMask === 'off') return;
            const m = buildMask(w, h);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalCompositeOperation = 'destination-in';
            ctx.drawImage(m, 0, 0);
            ctx.restore();
        }

        function setEdgeMask(shape) {
            params.edgeMask = shape;
            EDGE_SHAPES.forEach(function (k) {
                const el = document.getElementById('edge-' + k);
                if (el) el.className = (k === shape) ? 'active' : '';
            });
            const rows = document.getElementById('edge-controls');
            if (rows) rows.className = shape === 'off' ? 'off' : '';
            maskKey = '';
            redraw();
        }

        function fieldCanvas() {
            return glReady ? glCanvas : (img ? img.canvas : null);
        }

        // A tessellated frame blits the buffer once per cell — well over a
        // hundred times. Scaling the field down to cell size once, up front,
        // turns each of those into a same-size copy instead of a resample.
        const tileCv = document.createElement('canvas');
        const tileCtx = tileCv.getContext('2d');

        function tileSource(outer) {
            const src = fieldCanvas();
            const s = Math.max(64, Math.min(FIELD_SIDE, Math.ceil(outer)));
            if (tileCv.width !== s) tileCv.width = tileCv.height = s;
            tileCtx.drawImage(src, 0, 0, s, s);
            return tileCv;
        }

        function absmod(m, n) {
            const ret = m % n;
            return ret < 0 ? n + ret : ret;
        }

        // Cell count is bounded for the sake of the frame rate, so the cell has
        // a floor derived from the viewport — otherwise a small cell on a large
        // display would run out of tiles before reaching the corners.
        const SQ_CAP = 26, TRI_CAP = 11;

        // Canvas antialiases a clip edge, and two abutting antialiased edges do
        // not sum back to full opacity — which is what draws a hairline along
        // every cell boundary. Bleeding each clip outward by under a pixel makes
        // neighbours overlap instead of abut. The overlap shows one cell's
        // content a fraction of a pixel into the next, which is invisible; the
        // seam is not.
        const EDGE_BLEED = 2;

        function drawSquareTiling(ctx, w, h) {
            const diag = Math.sqrt(w * w + h * h);
            const len = Math.max(params.cellSize, diag / (SQ_CAP - 1));
            const outer = len / Math.SQRT1_2;      // len = sin(45°) · outer
            const ox = outer / 2, oy = outer / 2;
            const cells = Math.ceil(diag / len) + 1;
            const tile = tileSource(outer);

            ctx.save();
            ctx.translate((w - diag) / 2, (h - diag) / 2);
            ctx.translate(diag / 2, diag / 2);
            ctx.rotate(spinAngle);
            ctx.translate(-diag / 2, -diag / 2);

            for (let i = 0; i < cells; i++) {
                for (let j = 0; j < cells; j++) {
                    ctx.save();
                    // Alternate the sign on each axis: that is the reflection.
                    const sx = (i % 2 === 0) ? 1 : -1;
                    const sy = (j % 2 === 0) ? 1 : -1;
                    ctx.translate(sx === 1 ? i * len : i * len + len,
                                  sy === 1 ? j * len : j * len + len);
                    ctx.scale(sx, sy);
                    ctx.beginPath();
                    ctx.rect(-EDGE_BLEED, -EDGE_BLEED,
                             len + EDGE_BLEED * 2, len + EDGE_BLEED * 2);
                    ctx.clip();
                    ctx.translate(-(outer - len) / 2, -(outer - len) / 2);
                    ctx.translate(ox, oy);
                    ctx.rotate(-spinAngle * (1 - params.cellSpin));
                    ctx.translate(-ox, -oy);
                    ctx.drawImage(tile, 0, 0, outer, outer);
                    ctx.restore();
                }
            }
            ctx.restore();
        }

        function drawTriangleTiling(ctx, w, h) {
            const diag = Math.sqrt(w * w + h * h);
            const len = Math.max(params.cellSize, diag / 2 / (TRI_CAP - 1));
            const outer = len / (Math.sqrt(3) / 2);
            const ox = len / 2, oy = len / Math.sqrt(3) / 2;
            const cx = w / 2, cy = h / 2;
            const n = Math.ceil(diag / 2 / len) + 1;

            const tile = tileSource(outer);

            const mxx = Math.cos(spinAngle) * len;
            const mxy = Math.sin(spinAngle) * len;
            const myx = Math.cos(spinAngle + Math.PI / 2) * len * Math.sqrt(3) / 2;
            const myy = Math.sin(spinAngle + Math.PI / 2) * len * Math.sqrt(3) / 2;

            for (let x = -n; x <= n; x++) {
                for (let y = -n; y <= n; y++) {
                    const ddx = x + ((y % 2 !== 0) ? 0.5 : 0);
                    const tx = mxx * ddx + myx * y + cx;
                    const ty = mxy * ddx + myy * y + cy;
                    // Three rotational states around each lattice vertex,
                    // each drawn upright and inverted.
                    const rot = (absmod(x, 3) + absmod(y, 2) * 2) % 3;
                    drawTriangleCell(ctx, tx, ty, len, outer, ox, oy, rot, false, tile);
                    drawTriangleCell(ctx, tx, ty, len, outer, ox, oy, rot, true, tile);
                }
            }
        }

        function drawTriangleCell(ctx, x, y, l, outer, ox, oy, rot, inv, tile) {
            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(spinAngle);
            ctx.translate(-ox, -oy);

            if (inv) ctx.transform(1, 0, 0, -1, 0, 0);

            for (let i = 0; i < rot; i++) {
                ctx.rotate(-Math.PI / 3 * 2);
                ctx.translate(-l, 0);
            }

            // Push the three corners out from the centroid far enough to move
            // each edge EDGE_BLEED outward. For an equilateral triangle the
            // inradius is l / (2 * sqrt 3), so that is the scale it needs.
            const inr = l / (2 * Math.sqrt(3));
            const k = 1 + EDGE_BLEED / inr;
            const gx = l / 2, gy = l * Math.sqrt(3) / 6;
            const px = function (x) { return gx + (x - gx) * k; };
            const py = function (y) { return gy + (y - gy) * k; };

            ctx.beginPath();
            ctx.moveTo(px(0), py(0));
            ctx.lineTo(px(l), py(0));
            ctx.lineTo(px(l / 2), py(l * Math.sqrt(3) / 2));
            ctx.closePath();
            ctx.clip();

            ctx.translate(ox, oy);
            ctx.rotate(-spinAngle * (1 - params.cellSpin));
            ctx.translate(-outer / 2, -outer / 2);
            ctx.drawImage(tile, 0, 0, outer, outer);
            ctx.restore();
        }

        function windowResized() {
            resizeCanvas(windowWidth, windowHeight);
            if (resizeTimer) clearTimeout(resizeTimer);
            resizeTimer = setTimeout(redraw, 120);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // DOCK
        //
        // One panel at a time, opened from the dock or by number key. Nothing is
        // ever more than one keystroke away, and the artwork keeps the screen.
        // ═══════════════════════════════════════════════════════════════════════

        const PANELS = ['source', 'symmetry', 'colour', 'motion',
                        'breathing', 'params', 'seed', 'share'];
        let openPanelName = null;

        function openPanel(name) {
            if (openPanelName === name) { closePanel(); return; }
            openPanelName = name;
            PANELS.forEach(function (k) {
                const p = document.getElementById('panel-' + k);
                if (p) p.className = 'control-section' + (k === name ? ' on' : '');
                const d = document.getElementById('dock-' + k);
                if (d) d.className = 'dock-btn' + (k === name ? ' on' : '');
            });
            document.getElementById('sheet').classList.remove('hidden');
        }

        function closePanel() {
            openPanelName = null;
            PANELS.forEach(function (k) {
                const d = document.getElementById('dock-' + k);
                if (d) d.className = 'dock-btn';
            });
            document.getElementById('sheet').classList.add('hidden');
        }

        // Clicking away from the sheet closes it. The dock is exempt, or its own
        // buttons would close the panel before their handler could open it.
        window.addEventListener('pointerdown', function (e) {
            if (!openPanelName) return;
            const sheet = document.getElementById('sheet');
            const dock = document.getElementById('dock');
            if (sheet.contains(e.target) || dock.contains(e.target)) return;
            closePanel();
        }, true);

        // Cinema mode: everything but the artwork gets out of the way.
        let cinema = false;

        function toggleCinema(force) {
            cinema = (force === undefined) ? !cinema : force;
            document.body.classList.toggle('cinema', cinema);
            const d = document.getElementById('dock-cinema');
            if (d) d.className = 'dock-btn' + (cinema ? ' on' : '');
            if (cinema) closePanel();
        }


        function toggleAnimate() {
            animating = !animating;
            const btn = document.getElementById('dock-play');
            if (btn) btn.className = 'dock-btn' + (animating ? ' on' : '');
            if (animating) {
                loop();
            } else {
                if (!needsLoop()) noLoop();
                redraw();
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // IMAGE SOURCE
        // ═══════════════════════════════════════════════════════════════════════

        function setSource(mode) {
            // Guard on the canvas, not on srcPixels: a video source has no CPU
            // pixel buffer, and testing srcPixels bounced it to a painted plate.
            if (mode === 'image' && !srcCanvas) {
                useBasePlate('stilllife', 'Still Life');
                return;
            }
            params.source = mode;
            document.getElementById('src-gen').className = mode === 'generated' ? 'active' : '';
            document.getElementById('src-img').className = mode === 'image' ? 'active' : '';
            document.getElementById('img-controls').className = mode === 'image' ? '' : 'off';
            toggleSourceCard(mode === 'image');
            refreshSrcRegion();
            scheduleRender();
        }

        function onFilePicked(file) {
            if (!file) return;
            const reader = new FileReader();
            reader.onload = function (ev) {
                loadImage(ev.target.result, function (loaded) {
                    // Downscale large uploads — sampling never needs more than this
                    // and it keeps the pixel array small enough to stay cache-warm.
                    const cap = 1400;
                    if (Math.max(loaded.width, loaded.height) > cap) {
                        const k = cap / Math.max(loaded.width, loaded.height);
                        loaded.resize(Math.round(loaded.width * k), Math.round(loaded.height * k));
                    }
                    loaded.loadPixels();
                    srcPixels = loaded.pixels;
                    srcW = loaded.width;
                    srcH = loaded.height;
                    srcCanvas = loaded.canvas;
                    srcTexDirty = true;
                    plateAnim = false;
                    videoLive = false;
                    if (plateVideo) plateVideo.pause();
                    activeBase = null;
                    markActiveThumb(null);

                    const short = file.name.length > 26 ? file.name.slice(0, 24) + '…' : file.name;
                    document.getElementById('drop-label').textContent = short;
                    setSourceMeta(loaded.canvas.toDataURL(), short, srcW + ' × ' + srcH + ' · yours, never uploaded');

                    // An upload is worth seeing before it gets painted over.
                    params.mix = 0;
                    params.imgWarp = 0;
                    setSlider('mix', 0);
                    setSlider('imgWarp', 0);

                    setSource('image');

                    // Standalone this is undefined and the image simply stays
                    // local; under the app it is stored so the link carries it.
                    const share = window.__kaleidoscopeUpload;
                    if (typeof share === 'function') {
                        const note = document.getElementById('copy-note');
                        if (note) note.textContent = 'Saving…';
                        share(file, encodeState()).then(function (res) {
                            history.replaceState(null, '', res.url);
                            if (note) note.textContent = 'Shared at ' + res.url;
                        }, function (err) {
                            if (note) note.textContent = 'Not shared: ' + err.message;
                        });
                    }
                });
            };
            reader.readAsDataURL(file);
        }

        // When the page is served by the app, a shared generation arrives with
        // the source it was made from. Standalone, this is simply absent.
        function adoptHostedSource(url) {
            loadImage(url, function (loaded) {
                loaded.loadPixels();
                srcPixels = loaded.pixels;
                srcW = loaded.width;
                srcH = loaded.height;
                srcCanvas = loaded.canvas;
                srcTexDirty = true;
                plateAnim = false;
                videoLive = false;
                if (plateVideo) plateVideo.pause();
                activeBase = null;
                markActiveThumb(null);
                setSourceMeta(url, 'Shared source', 'Loaded with this generation');
                setSource('image');
            }, function () {
                console.warn('Could not load the shared source image.');
            });
        }

        // ── Drop anywhere on the page ──────────────────────────────────────
        //
        // dragenter/dragleave fire for every child element crossed, so the veil
        // is driven by a depth counter rather than by the events alone —
        // otherwise it flickers off the moment the pointer passes over the panel.
        let dragDepth = 0;

        function showVeil(on, msg) {
            const v = document.getElementById('drop-veil');
            if (!v) return;
            if (msg) document.getElementById('drop-veil-msg').textContent = msg;
            v.className = on ? 'on' : '';
        }

        function hasImage(dt) {
            if (!dt) return false;
            if (dt.items && dt.items.length) {
                for (let i = 0; i < dt.items.length; i++) {
                    const it = dt.items[i];
                    if (it.kind === 'file' && (!it.type || it.type.indexOf('image') === 0)) return true;
                }
                return false;
            }
            // Safari exposes only `types` until the drop actually happens.
            return !dt.types || Array.prototype.indexOf.call(dt.types, 'Files') >= 0;
        }

        window.addEventListener('dragenter', function (e) {
            e.preventDefault();
            dragDepth++;
            if (hasImage(e.dataTransfer)) showVeil(true, 'Drop to feed it in');
        });

        window.addEventListener('dragover', function (e) {
            e.preventDefault();                       // required, or the drop never fires
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
        });

        window.addEventListener('dragleave', function (e) {
            e.preventDefault();
            dragDepth = Math.max(0, dragDepth - 1);
            if (dragDepth === 0) showVeil(false);
        });

        window.addEventListener('drop', function (e) {
            e.preventDefault();
            dragDepth = 0;
            showVeil(false);

            const dt = e.dataTransfer;
            const f = dt && dt.files && dt.files[0];
            if (!f) return;
            if (f.type.indexOf('image') !== 0) {
                showVeil(true, 'That is not an image');
                setTimeout(function () { showVeil(false); }, 1600);
                return;
            }
            // Dropping is intent enough to get past the front door.
            enterStudio();
            onFilePicked(f);
        });

        // A file dropped outside the window would otherwise navigate away from
        // the sketch and lose whatever is on screen.
        document.addEventListener('dragover', function (e) { e.preventDefault(); });
        document.addEventListener('drop', function (e) { e.preventDefault(); });

        // ═══════════════════════════════════════════════════════════════════════
        // UI CONTROL HANDLERS
        // ═══════════════════════════════════════════════════════════════════════

        const INT_PARAMS = ['folds', 'octaves', 'rotation', 'imgAngle', 'bpm'];
        const COLOUR_ONLY = ['shift', 'seam', 'mix', 'breathDepth'];
        const MOTION_ONLY = ['flow', 'spin', 'trail', 'cellSize', 'cellSpin', 'bpm',
                             'edgeSize', 'edgeSoft'];
        const IMG_PARAMS = ['imgZoom', 'imgPanX', 'imgPanY', 'imgAngle', 'imgWarp'];

        function setSlider(name, value) {
            const s = document.getElementById(name);
            const d = document.getElementById(name + '-value');
            if (s) s.value = value;
            if (d) d.textContent = value;
        }

        function updateParam(name, value) {
            params[name] = INT_PARAMS.indexOf(name) >= 0 ? parseInt(value) : parseFloat(value);
            const el = document.getElementById(name + '-value');
            if (el) el.textContent = value;

            if (IMG_PARAMS.indexOf(name) >= 0) refreshSrcRegion();
            if (name === 'seam') tablesDirty = true;
            if (name === 'folds' || name === 'edgeSize' || name === 'edgeSoft') maskKey = '';

            refreshShareUI();

            if (MOTION_ONLY.indexOf(name) >= 0) {
                if (!animating) redraw();
                return;
            }
            if (COLOUR_ONLY.indexOf(name) >= 0) {
                if (!animating) recolour();
                return;
            }
            scheduleRender();
        }

        function updateColor(id, value) {
            const el = document.getElementById(id + '-value');
            if (el) el.textContent = value;
            params.colorPalette[parseInt(id.replace('color', '')) - 1] = value;
            tablesDirty = true;
            if (!animating) recolour();
        }

        // Narrow, related ranges. A kaleidoscope already repeats a colour
        // dozens of times per frame — a full spectrum in the ramp turns that
        // repetition into noise, so every preset stays inside a limited family.
        const PRESETS = {
            harbour:   ['#0d1b2a', '#1b4965', '#5fa8d3', '#cae9ff', '#e8a87c'],
            ember:     ['#1a0d0a', '#6b2412', '#c1440e', '#e58f65', '#f2d0a4'],
            moss:      ['#12211a', '#2d4739', '#5c8262', '#a3c9a8', '#dfe8d2'],
            plum:      ['#180d21', '#42224a', '#7b466a', '#b57a92', '#e8c5c0'],
            sandstone: ['#2b1d16', '#7a4b2a', '#c08552', '#dab785', '#f3e9dc'],
            slate:     ['#10131a', '#28303d', '#4d5a6b', '#8b9bab', '#d6dee6'],
            bloom:     ['#2a1120', '#7d2a4d', '#c75b6b', '#eda28c', '#f7dfc4'],
            tide:      ['#04232b', '#0b4f4a', '#2e8b74', '#84c4a8', '#d9edd8']
        };

        // ═══════════════════════════════════════════════════════════════════════
        // PALETTE BROWSER
        //
        // Pick one colour and scroll variations on it forever. Each row is
        // derived deterministically from (base colour, row index), so the list
        // is stable while you scroll it and reproducible later.
        // ═══════════════════════════════════════════════════════════════════════

        let paletteBase = '#2e8b74';
        let pbRows = 0, pbBusy = false;
        let activeTile = null, scanQueued = false;

        function hexToHsl(hex) {
            const c = hexToRgb(hex);
            const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
            const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
            const l = (mx + mn) / 2;
            let h = 0, s = 0;
            if (mx !== mn) {
                const d = mx - mn;
                s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
                if (mx === r) h = (g - b) / d + (g < b ? 6 : 0);
                else if (mx === g) h = (b - r) / d + 2;
                else h = (r - g) / d + 4;
                h /= 6;
            }
            return [h, s, l];
        }

        // Eight harmony schemes over a base colour. The important part is that
        // every row also draws its own lightness envelope, saturation swing and
        // direction — hue alone varied too little, and the list came out looking
        // like one palette printed twenty times.
        function paletteFrom(baseHex, idx) {
            const hsv = hexToHsl(baseHex);
            const h0 = hsv[0];
            const s0 = Math.min(0.9, Math.max(0.3, hsv[1]));
            const R = makeRng((idx + 1) * 2654435761 % 2147483647);
            const scheme = idx % 8;

            // The list opens on close variations and widens the further it is
            // scrolled: near the top everything is recognisably the chosen
            // colour, deep down it has drifted right around the wheel.
            const drift = Math.min(1, idx / 64);
            const wander = (R() - 0.5) * drift * 0.85;
            const hb = (h0 + wander + 1) % 1;

            const loL = 0.07 + R() * (0.18 + 0.16 * drift);
            const hiL = 0.60 + R() * (0.24 + 0.14 * drift);
            const satLo = Math.max(0.05, s0 * (0.25 + R() * (0.35 + 0.5 * drift)));
            const satHi = Math.min(0.97, s0 * (0.85 + R() * (0.4 + 0.7 * drift)));
            const twist = R() < 0.4;                // break the smooth ramp

            // Where each of the five stops sits on the hue wheel.
            let hues;
            if (scheme === 0) {                                   // monochrome
                hues = [0, 0, 0, 0, 0];
            } else if (scheme === 1) {                            // analogous, wide
                const sp = (0.08 + R() * (0.14 + 0.4 * drift)) * (R() < 0.5 ? 1 : -1);
                hues = [0, sp * 0.25, sp * 0.5, sp * 0.75, sp];
            } else if (scheme === 2) {                            // complementary
                const c = 0.5 + (R() - 0.5) * 0.08;
                hues = [0, 0.04, c - 0.04, c, c + 0.05];
            } else if (scheme === 3) {                            // triad
                hues = [0, 0.33, 0.66, 0.05, 0.38];
            } else if (scheme === 4) {                            // split complement
                hues = [0, 0.03, 0.42, 0.58, 0.06];
            } else if (scheme === 5) {                            // muted + one accent
                hues = [0, 0.02, 0.03, 0.5 + (R() - 0.5) * 0.2, 0.01];
            } else if (scheme === 6) {                            // warm / cool pair
                const w = R() < 0.5 ? 0.08 : -0.08;
                hues = [0, w, 0.45 + w, 0.5, 0.55 + w];
            } else {                                              // tetradic
                hues = [0, 0.25, 0.5, 0.75, 0.12];
            }

            // Lightness order. Mostly a ramp, sometimes deliberately not.
            let order = [0, 1, 2, 3, 4];
            if (twist) order = [0, 3, 1, 4, 2];
            if (R() < 0.3) order.reverse();

            const out = [];
            for (let i = 0; i < 5; i++) {
                const k = order[i] / 4;
                const h = (hb + hues[i] * (1 + 0.6 * drift)) % 1;
                let sat = satHi + (satLo - satHi) * k;
                let lit = loL + (hiL - loL) * k;

                // The accent stop in schemes 5 and 6 stays vivid at mid lightness,
                // which is what stops those rows reading as a plain gradient.
                if ((scheme === 5 && i === 3) || (scheme === 6 && i >= 3)) {
                    sat = Math.min(0.92, s0 * 1.15);
                    lit = 0.38 + R() * 0.3;
                }

                out.push(hsl((h + 1) % 1,
                             Math.min(0.95, Math.max(0.05, sat)),
                             Math.min(0.96, Math.max(0.04, lit))));
            }
            return out;
        }

        // The Gregg Gunn square format: the palette shown as a composition
        // rather than a strip, which is both more compact and a better preview
        // of how the colours actually sit against each other.
        function paletteTile(cols, onClick) {
            const b = document.createElement('button');
            b.className = 'pal-tile';
            b.title = cols.join(' ');
            b.style.background = cols[0];
            const inner = document.createElement('span');
            inner.className = 'pal-inner';
            [cols[4], cols[1], cols[2], cols[3]].forEach(function (c, i) {
                const el = document.createElement('i');
                el.style.background = c;
                el.className = 'r' + i;
                inner.appendChild(el);
            });
            b.appendChild(inner);
            b.__cols = cols;
            b.onclick = onClick;
            return b;
        }

        function applyPalette(cols) {
            params.colorPalette = cols.slice();
            tablesDirty = true;
            setPaletteUI();
            if (!animating) recolour();
        }

        // `silent` marks the starting tile without applying it — on load the
        // palette that ships with the default generation must survive.
        // A random base to explore from, kept off the washed-out extremes where
        // every scheme collapses into the same near-grey.
        function randomPaletteBase() {
            setPaletteBase(hsl(Math.random(), rr(0.42, 0.85), rr(0.28, 0.55)));
        }

        function setPaletteBase(hex, silent) {
            paletteBase = hex;
            const inp = document.getElementById('pb-color');
            if (inp) inp.value = hex;
            const list = document.getElementById('pal-scroll');
            list.innerHTML = '';
            pbRows = 0;
            activeTile = null;
            list.scrollTop = 0;
            growPalettes(24);
            markActivePalette(true, silent);
        }

        function growPalettes(n) {
            if (pbBusy) return;
            pbBusy = true;
            const list = document.getElementById('pal-scroll');
            const frag = document.createDocumentFragment();
            for (let i = 0; i < n; i++) {
                const cols = paletteFrom(paletteBase, pbRows++);
                frag.appendChild(paletteTile(cols, (function (c, el) {
                    return function () { applyPalette(c); };
                })(cols)));
            }
            list.appendChild(frag);
            pbBusy = false;
        }

        // Whatever sits closest to the middle of the scroller is what the
        // reflections are showing. Stopping anywhere is the selection — there is
        // nothing to click, and no wall of palettes to judge at once.
        function markActivePalette(force, silent) {
            const list = document.getElementById('pal-scroll');
            if (!list) return;
            const box = list.getBoundingClientRect();
            const mid = box.top + box.height / 2;

            let best = null, bestD = Infinity;
            const tiles = list.children;
            for (let i = 0; i < tiles.length; i++) {
                const r = tiles[i].getBoundingClientRect();
                if (r.bottom < box.top - 40 || r.top > box.bottom + 40) continue;
                const d = Math.abs(r.top + r.height / 2 - mid);
                if (d < bestD) { bestD = d; best = tiles[i]; }
            }
            if (!best || (best === activeTile && !force)) return;

            if (activeTile) activeTile.classList.remove('active');
            best.classList.add('active');
            activeTile = best;
            if (!silent) applyPalette(best.__cols);
        }

        function schedulePaletteScan() {
            if (scanQueued) return;
            scanQueued = true;
            requestAnimationFrame(function () {
                scanQueued = false;
                markActivePalette(false);
            });
        }

        function setPaletteUI() {
            for (let i = 0; i < 5; i++) {
                document.getElementById('color' + (i + 1)).value = params.colorPalette[i];
                document.getElementById('color' + (i + 1) + '-value').textContent = params.colorPalette[i];
            }
        }

        function applyPreset(name) {
            params.colorPalette = PRESETS[name].slice();
            tablesDirty = true;
            setPaletteUI();
            if (!animating) recolour();
        }

        // ═══════════════════════════════════════════════════════════════════════
        // BREATHING
        //
        // A slow oscillation you can breathe along with. The colour ramp runs
        // forward on the inhale and back on the exhale rather than drifting one
        // way, and the whole field swells and settles with it, so the motion has
        // somewhere to rest instead of scrolling forever.
        // ═══════════════════════════════════════════════════════════════════════

        // [inhale, hold, exhale, hold] in seconds.
        const BREATH_PATTERNS = {
            box:         [4, 4, 4, 4],      // equal — steadying
            calm:        [4, 7, 8, 0],      // long exhale — settling
            deep:        [6, 0, 7, 0],      // no holds — easiest to follow
            progressive: [4, 2, 6, 1]       // lengthens as you go
        };

        let breathT = 0, breathValue = 0, breathStage = '', breathFlow = 0;

        // Spin is distracting at meditation pace, so breathing keeps only a
        // trace of it however high the slider is set.
        const BREATH_SPIN = 0.12;

        function breathCycle() {
            const pat = BREATH_PATTERNS[params.breath];
            if (!pat) return null;
            if (params.breath !== 'progressive') return pat;
            // Stretch up to 1.8x over about five minutes, then hold there.
            const k = 1 + Math.min(0.8, breathT / 320);
            return [pat[0] * k, pat[1] * k, pat[2] * k, pat[3] * k];
        }

        function stepBreath(dt) {
            const pat = breathCycle();
            if (!pat) { breathValue = 0; breathStage = ''; return false; }

            const total = pat[0] + pat[1] + pat[2] + pat[3];
            breathT += dt;
            let t = breathT % total;

            const ease = function (u) { return u * u * (3 - 2 * u); };
            // Slope of that ease, normalised to peak at 1. This is what makes
            // the colour swing smoothly from positive to negative rather than
            // switching direction at the turn.
            const slope = function (u) { return 4 * u * (1 - u); };

            if (t < pat[0]) {
                const u = t / pat[0];
                breathValue = ease(u);
                breathFlow = slope(u);
                breathStage = 'Breathe in';
            } else if (t < pat[0] + pat[1]) {
                breathValue = 1;
                breathFlow = 0;
                breathStage = 'Hold';
            } else if (t < pat[0] + pat[1] + pat[2]) {
                const u = (t - pat[0] - pat[1]) / pat[2];
                breathValue = 1 - ease(u);
                breathFlow = -slope(u);
                breathStage = 'Breathe out';
            } else {
                breathValue = 0;
                breathFlow = 0;
                breathStage = pat[3] > 0.05 ? 'Hold' : 'Breathe in';
            }
            return true;
        }

        // ═══════════════════════════════════════════════════════════════════════
        // BREATH ORB
        //
        // A shell of points rather than a painted ring. Directions are laid out
        // on a Fibonacci sphere, then thinned by noise so the field breaks into
        // filaments and voids instead of an even fog. Brightness and radius are
        // fixed in object space and computed once — only the rotation and the
        // breath change per frame, so drawing is a rotate, a project and a write.
        // ═══════════════════════════════════════════════════════════════════════

        const ORB_POINTS = 14000;

        // Light from the upper left but mostly frontal, and with a high ambient
        // floor. Pushed further off-axis it looks correct and reads wrong: half
        // the shell drops into shadow and the orb seems to only half exist.
        const LX = -0.34, LY = -0.36, LZ = 0.87;

        // Value noise in three dimensions. The previous version sampled the 2D
        // field on projections of the sphere, which is not isotropic — it gave
        // the cloud a strong directional grain and a silhouette like a hill.
        function vnoise3(x, y, z) {
            const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
            const xf = x - xi, yf = y - yi, zf = z - zi;
            const fade = function (t) { return t * t * t * (t * (t * 6 - 15) + 10); };
            const u = fade(xf), v = fade(yf), w = fade(zf);

            const at = function (a, b, c) {
                return perm[(perm[(perm[a & 255] + (b & 255)) & 255] + (c & 255)) & 255] / 127.5 - 1;
            };
            const lerp = function (a, b, t) { return a + (b - a) * t; };

            const x00 = lerp(at(xi, yi, zi),         at(xi + 1, yi, zi),         u);
            const x10 = lerp(at(xi, yi + 1, zi),     at(xi + 1, yi + 1, zi),     u);
            const x01 = lerp(at(xi, yi, zi + 1),     at(xi + 1, yi, zi + 1),     u);
            const x11 = lerp(at(xi, yi + 1, zi + 1), at(xi + 1, yi + 1, zi + 1), u);

            return lerp(lerp(x00, x10, v), lerp(x01, x11, v), w);
        }

        function fbm3(x, y, z, oct) {
            let amp = 0.5, f = 1, sum = 0;
            for (let i = 0; i < oct; i++) {
                sum += amp * vnoise3(x * f, y * f, z * f);
                f *= 2.07;
                amp *= 0.5;
            }
            return sum;
        }
        let orbPts = null;

        function buildOrbPoints() {
            seedNoise(20240719);            // fixed: the orb should not chase the artwork
            const pts = new Float32Array(ORB_POINTS * 4);   // x, y, z, brightness
            const GA = Math.PI * (3 - Math.sqrt(5));
            let n = 0;

            for (let i = 0; i < ORB_POINTS; i++) {
                const t = (i + 0.5) / ORB_POINTS;
                const z = 1 - 2 * t;
                const r = Math.sqrt(Math.max(0, 1 - z * z));
                const a = GA * i;
                let x = Math.cos(a) * r, y = Math.sin(a) * r;

                // Sampled in three dimensions on the direction itself, so the
                // structure is the same whichever way the shell is turned.
                // Frequency matters more than it looks. The direction only spans
                // [-1,1], so sampling at 2.1 put the whole sphere inside about
                // four cells of the noise lattice — one lobe then swallowed an
                // entire side and the silhouette came out a dome rather than a
                // circle. These are high enough that the structure is filaments
                // across the surface, not one blob shaping the outline.
                const coarse = fbm3(x * 9, y * 9, z * 9, 3);
                const fine   = fbm3(x * 22, y * 22, z * 22, 2);
                const d = coarse + fine * 0.4;

                if (d < -0.20) continue;                    // a void
                const b = Math.min(1, (d + 0.20) * 1.7);
                if (b < 0.02) continue;

                // A shell with a little thickness. Razor-thin only ever reads as
                // a rim under an orthographic projection.
                const rad = 0.90 + fine * 0.07 + (rnd() - 0.5) * 0.05;
                pts[n * 4]     = x * rad;
                pts[n * 4 + 1] = y * rad;
                pts[n * 4 + 2] = z * rad;
                pts[n * 4 + 3] = b;
                n++;
            }
            orbPts = pts.subarray(0, n * 4);
            seedNoise(params.seed);         // hand the field's noise back
        }

        function splat(d, S, x, y, v, tr, tg, tb) {
            if (x < 0 || y < 0 || x >= S || y >= S) return;
            const q = (y * S + x) * 4;
            const r = d[q] + v * tr, g = d[q + 1] + v * tg, b2 = d[q + 2] + v * tb;
            d[q]     = r  > 255 ? 255 : r;
            d[q + 1] = g  > 255 ? 255 : g;
            d[q + 2] = b2 > 255 ? 255 : b2;
            d[q + 3] = d[q + 3] + v > 255 ? 255 : d[q + 3] + v;
        }

        // Shared by the breath guide and the welcome. `state` carries each
        // caller's own canvas, spin and gain so the two never share a phase.
        function renderOrb(el, state, gain, spinStep, tilt) {
            if (!el || !orbPts) return;

            // Backing resolution is capped and CSS scales it up to Orb Size:
            // clearing and uploading the buffer dominates the cost, and it grows
            // with the square of the side. Points are soft anyway, so the slight
            // upscale costs nothing visually.
            const S = state.side;
            if (el.width !== S) {
                el.width = S; el.height = S;
                state.ctx = el.getContext('2d');
                state.img = state.ctx.createImageData(S, S);
            }
            if (!state.ctx) { state.ctx = el.getContext('2d'); state.img = state.ctx.createImageData(S, S); }

            const d = state.img.data;
            d.fill(0);

            state.spin += spinStep;
            const cs = Math.cos(state.spin), sn = Math.sin(state.spin);
            const ct = Math.cos(tilt), st = Math.sin(tilt);

            const c = S / 2;
            const R = c * 0.80;      // room for the shell's thickness inside the disc

            // Eight tints, chosen once per frame. Points index into them so the
            // colour is stable per point rather than flickering as it turns.
            const TINTS = [];
            const mode = params.orbTint;
            if (mode === 'palette') {
                for (let i = 0; i < 8; i++) {
                    const col = hexToRgb(params.colorPalette[i % 5]);
                    // Normalised, or dark palette stops would just dim the orb.
                    const mx = Math.max(col[0], col[1], col[2]) || 1;
                    TINTS.push([col[0] / mx, col[1] / mx, col[2] / mx]);
                }
            } else if (mode === 'warm') {
                for (let i = 0; i < 8; i++) TINTS.push([1, 0.74 + (i % 3) * 0.05, 0.46 + (i % 4) * 0.04]);
            } else if (mode === 'cool') {
                for (let i = 0; i < 8; i++) TINTS.push([0.54 + (i % 4) * 0.04, 0.80, 1]);
            } else {
                for (let i = 0; i < 8; i++) TINTS.push([1, 1, 1]);
            }
            const byDepth = mode === 'depth';
            const N = orbPts.length / 4;

            for (let i = 0; i < N; i++) {
                const o = i * 4;
                const x0 = orbPts[o], y0 = orbPts[o + 1], z0 = orbPts[o + 2];

                const x1 = x0 * cs + z0 * sn;          // spin about Y
                const z1 = z0 * cs - x0 * sn;
                const y1 = y0 * ct - z1 * st;          // then a fixed tilt
                const z2 = z1 * ct + y0 * st;

                const px = (c + x1 * R) | 0;
                const py = (c + y1 * R) | 0;
                if (px < 0 || py < 0 || px >= S || py >= S) continue;

                // Depth cue: the far side of the shell reads dimmer, which is
                // what makes a flat scatter of points look like a sphere.
                // Depth cue: the far side reads dimmer, which is what makes a
                // flat scatter of points look like a sphere.
                // Orthographically, a shell bunches at the limb and thins in the
                // middle, which reads as a ring however dense it is. What makes
                // it a ball is light from somewhere other than the camera — a
                // headlight along z flattens it straight back out — plus dimming
                // the far hemisphere the way a solid surface would occlude it.
                const inv = 1 / (Math.sqrt(x1 * x1 + y1 * y1 + z2 * z2) || 1);
                const nx = x1 * inv, ny = y1 * inv, nz = z2 * inv;

                let lam = nx * LX + ny * LY + nz * LZ;
                if (lam < 0) lam = 0;
                const shade = 0.46 + 0.54 * lam;            // a gradient, not a terminator
                const facing = nz > 0 ? 1 : 0.34;           // far side, partly occluded

                let v = orbPts[o + 3] * shade * facing * gain * 430;
                if (v <= 0) continue;
                if (v > 205) v = 205;    // never let a single point reach white

                let tr, tg, tb;
                if (byDepth) {
                    // Warm toward the viewer, cool away — reinforces the volume
                    // the shading already gives.
                    const f = (nz + 1) * 0.5;
                    tr = 0.52 + 0.48 * f;
                    tg = 0.74 + 0.16 * f;
                    tb = 1 - 0.36 * f;
                } else {
                    const t = TINTS[i & 7];
                    tr = t[0]; tg = t[1]; tb = t[2];
                }

                splat(d, S, px, py, v, tr, tg, tb);
                // Only the strongest get one dim neighbour, so the filaments
                // carry without the field welding itself into a solid mass.
                if (v > 120) {
                    const h = v * 0.30;
                    splat(d, S, px + 1, py, h, tr, tg, tb);
                    splat(d, S, px, py + 1, h, tr, tg, tb);
                }
            }

            state.ctx.putImageData(state.img, 0, 0);
        }

        // Backing resolution is capped and CSS scales it up: clearing and
        // uploading the buffer dominates the cost and grows with the square of
        // the side. Points are soft, so the upscale costs nothing visually.
        const breathOrb = { side: 300, spin: 0, ctx: null, img: null };

        function drawOrb() {
            breathOrb.side = Math.max(80, Math.min(300, Math.round(params.orbSize)));
            renderOrb(document.getElementById('breath-ring'), breathOrb,
                      params.orbStrength, 0.0016, 0.38);
        }


        function syncBreathGuide() {
            const guide = document.getElementById('breath-guide');
            const on = params.breath !== 'off' && params.breathGuide;
            if (guide) guide.className = on ? '' : 'off';

            const btn = document.getElementById('breath-guide-toggle');
            if (btn) btn.className = params.breathGuide ? 'sec-btn on' : 'sec-btn';

            const orb = document.getElementById('breath-ring');
            if (orb) orb.style.setProperty('--orb-size', params.orbSize + 'px');

            const lbl = document.getElementById('breath-stage');
            if (lbl) {
                lbl.style.display = params.breathLabel ? '' : 'none';
                lbl.style.fontSize = params.breathLabelSize + 'px';
            }
            const lb = document.getElementById('breath-label-toggle');
            if (lb) lb.className = params.breathLabel ? 'sec-btn on' : 'sec-btn';

            const row = document.getElementById('label-size-row');
            if (row) row.className = params.breathLabel ? 'control-group' : 'control-group off';
        }

        function toggleBreathGuide() {
            params.breathGuide = !params.breathGuide;
            syncBreathGuide();
        }

        function toggleBreathLabel() {
            params.breathLabel = !params.breathLabel;
            syncBreathGuide();
        }

        const ORB_TINTS = ['white', 'palette', 'warm', 'cool', 'depth'];

        function setOrbTint(mode) {
            params.orbTint = mode;
            ORB_TINTS.forEach(function (k) {
                const el = document.getElementById('tint-' + k);
                if (el) el.className = (k === mode) ? 'active' : '';
            });
            drawOrb();
        }

        function setOrbSize(v) {
            params.orbSize = parseInt(v, 10);
            const out = document.getElementById('orbSize-value');
            if (out) out.textContent = v;
            syncBreathGuide();
        }

        function setOrbStrength(v) {
            params.orbStrength = parseFloat(v);
            const out = document.getElementById('orbStrength-value');
            if (out) out.textContent = v;
            syncBreathGuide();
        }

        function setLabelSize(v) {
            params.breathLabelSize = parseInt(v, 10);
            const out = document.getElementById('breathLabelSize-value');
            if (out) out.textContent = v;
            syncBreathGuide();
        }

        function setBreath(mode) {
            params.breath = mode;
            breathT = 0;
            ['off', 'box', 'calm', 'deep', 'progressive'].forEach(function (m) {
                const el = document.getElementById('breath-' + m);
                if (el) el.className = (m === mode) ? 'active' : '';
            });
            syncBreathGuide();
            if (mode === 'off') {
                breathValue = 0;
                if (!needsLoop()) noLoop(); else loop();
                redraw();
            } else {
                loop();
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PER-SECTION LOCK + AUTO
        //
        // Each section can be pinned (Randomize leaves it alone) or set drifting
        // on its own. Continuous sections ease toward a fresh target; the ones
        // that can only step — symmetry, seed, source — wait a random interval
        // and cross-dissolve, so a hard switch still reads as a transition.
        // ═══════════════════════════════════════════════════════════════════════

        const RANGES = {
            folds:   [5, 16, 1],   moire:   [0, 0.6],     mfreq:   [2, 11],
            detune:  [0.7, 2.1],   descent: [1.4, 4.4],   angular: [0.6, 2.2],
            twist:   [-1.2, 1.2],  warp:    [0.4, 2.6],   octaves: [2, 4, 1],
            bands:   [0.6, 1.8],   rings:   [0, 1.6],     shift:   [0, 1],
            seam:    [0, 0.5],     contrast:[0.6, 1.25],  rotation:[0, 359, 1],
            cellSize:[140, 400, 1],
            flow:    [-2.5, 2.5],  spin:    [-1.2, 1.2],  trail:   [0, 0.6],
            imgZoom: [0.25, 1.1],  imgPanX: [0.3, 0.7],   imgPanY: [0.3, 0.7],
            imgAngle:[0, 359, 1],  imgWarp: [0, 0.18],    mix:     [0, 0.4]
        };

        // `every` and `ease` are in beats, so one BPM governs the whole cadence.
        const SECTIONS = {
            symmetry: { step: true,  keys: ['cellSize'], every: [8, 16], ease: [6, 12] },
            seed:     { step: true,  keys: [],           every: [4, 10] },
            // The image controls belong to Source. Leaving them out meant its
            // lock only ever held the plate, while Randomize kept moving the
            // zoom, pan and mix underneath it.
            source:   { step: true,  every: [8, 18], ease: [6, 14],
                        keys: ['imgZoom', 'imgPanX', 'imgPanY', 'imgAngle',
                               'imgWarp', 'mix'] },
            motion:   { keys: ['flow', 'spin', 'trail'], ease: [6, 14] },
            params:   { keys: ['folds', 'moire', 'mfreq', 'detune', 'descent', 'angular',
                               'twist', 'warp', 'octaves', 'bands', 'rings', 'shift',
                               'seam', 'contrast', 'rotation'], ease: [6, 14] },
            colour:   { palette: true, every: [6, 14], ease: [4, 10] }
        };

        // 1 BPM is a one-minute beat, so a Parameters morph can run six minutes.
        function beatMs() { return 60000 / Math.max(1, params.bpm || 30); }

        // BPM sets the pace of everything that moves on its own, not just the
        // section transitions. 60 is the reference the flow and spin sliders
        // were tuned against, so below it the whole piece slows together.
        function motionRate() { return Math.max(1, params.bpm || 30) / 60; }
        function beats(range) {
            return range[0] + Math.random() * (range[1] - range[0]);
        }

        let beatClock = 0, beatLast = 0, breathLast = 0;
        function advanceBeatClock(now) {
            if (!beatLast) { beatLast = now; return; }
            const dt = Math.min(250, now - beatLast);   // ignore tab-away gaps
            beatLast = now;
            beatClock += dt / beatMs();
        }

        const secState = {};
        Object.keys(SECTIONS).forEach(function (k) {
            secState[k] = { lock: false, auto: false, due: 0, target: null, palTarget: null };
        });

        let fadeCv = null, fadeCtx = null, fadeAmt = 0;
        let secUiTick = 0;

        function anySectionAuto() {
            return Object.keys(secState).some(function (k) { return secState[k].auto; });
        }

        function toggleSection(name, mode) {
            const st = secState[name];
            if (mode === 'lock') {
                st.lock = !st.lock;
                if (st.lock) st.auto = false;      // pinned and drifting is a contradiction
            } else {
                st.auto = !st.auto;
                if (st.auto) {
                    st.lock = false;
                    st.due = 0;                    // act on the next frame
                    st.target = null;
                    beatLast = 0;                  // resync the clock
                }
            }
            syncSectionButtons();
            if (anySectionAuto()) loop(); else if (!needsLoop()) noLoop();
        }

        function syncSectionButtons() {
            Object.keys(secState).forEach(function (name) {
                ['lock', 'auto'].forEach(function (mode) {
                    const el = document.getElementById('sec-' + name + '-' + mode);
                    if (el) el.className = secState[name][mode] ? 'sec-btn on' : 'sec-btn';
                });
            });
        }

        function rangeRoll(k) {
            const r = RANGES[k];
            if (!r) return params[k];
            const v = r[0] + Math.random() * (r[1] - r[0]);
            return r[2] === 1 ? Math.round(v) : +v.toFixed(3);
        }

        // Roll just this section, leaving everything else where it is.
        function randomSection(name) {
            const cfg = SECTIONS[name];
            if (!cfg) return;
            beginFade();

            (cfg.keys || []).forEach(function (k) {
                params[k] = rangeRoll(k);
                setSlider(k, params[k]);
            });

            if (name === 'symmetry') {
                const order = ['radial', 'triangle', 'square'];
                setTiling(order[(Math.random() * 3) | 0]);
            } else if (name === 'seed') {
                params.seed = Math.floor(Math.random() * 999999) + 1;
                updateSeedDisplay();
            } else if (name === 'source') {
                if (imageLocked) { scheduleRender(); return; }
                const avail = BASE_PLATES.filter(function (x) { return !x.missing; });
                const b = avail[(Math.random() * avail.length) | 0];
                useBasePlate(b.id, b.name);
                return;                       // useBasePlate already re-renders
            } else if (name === 'colour') {
                randomPaletteBase();                     // a new family to explore
                applyPalette(paletteFrom(paletteBase, (Math.random() * 60) | 0));
            }

            // A drifting section should aim at the new values, not snap back.
            const st = secState[name];
            if (st) { st.target = null; st.palTarget = null; st.palFrom = null; }

            tablesDirty = true;
            scheduleRender();
        }

        // Snapshot the frame so the next one can be dissolved into.
        function beginFade() {
            const cv = document.querySelector('#canvas-wrap canvas');
            if (!cv) return;
            if (!fadeCv) { fadeCv = document.createElement('canvas'); fadeCtx = fadeCv.getContext('2d'); }
            if (fadeCv.width !== cv.width || fadeCv.height !== cv.height) {
                fadeCv.width = cv.width; fadeCv.height = cv.height;
            }
            fadeCtx.clearRect(0, 0, fadeCv.width, fadeCv.height);
            fadeCtx.drawImage(cv, 0, 0);
            fadeAmt = 1;
        }

        // Everything below is interpolated across a beat window rather than
        // stepped by a fixed amount per frame, so the cadence follows BPM and
        // stays the same whatever frame rate the machine manages.
        function retarget(name, st, cfg, now) {
            st.from = {};
            st.target = {};
            (cfg.keys || []).forEach(function (k) {
                st.from[k] = params[k];
                st.target[k] = rangeRoll(k);
            });
            st.t0 = beatClock;
            st.dur = beats(cfg.ease || [6, 14]);
        }

        function stepSections(now) {
            advanceBeatClock(now);
            let touched = false;
            const uiDue = (++secUiTick % 6) === 0;

            Object.keys(SECTIONS).forEach(function (name) {
                const st = secState[name];
                if (!st.auto) return;
                const cfg = SECTIONS[name];

                // ── the ones that can only step ──
                if ((cfg.step || cfg.palette) && beatClock >= st.due) {
                    if (st.due !== 0) beginFade();
                    st.due = beatClock + beats(cfg.every);

                    if (name === 'symmetry') {
                        const order = ['radial', 'triangle', 'square'];
                        const i = order.indexOf(params.tiling);
                        setTiling(order[(i + 1 + ((Math.random() * 2) | 0)) % 3]);
                        touched = true;
                    } else if (name === 'seed') {
                        params.seed = Math.floor(Math.random() * 999999) + 1;
                        updateSeedDisplay();
                        touched = true;
                    } else if (name === 'source') {
                        if (params.source === 'image' && activeBase !== null && !imageLocked) {
                            const avail = BASE_PLATES.filter(function (x) { return !x.missing; });
                            const b = avail[(Math.random() * avail.length) | 0];
                            useBasePlate(b.id, b.name);
                        }
                    } else if (name === 'colour') {
                        st.palFrom = params.colorPalette.slice();
                        st.palTarget = paletteFrom(paletteBase, (Math.random() * 60) | 0);
                        st.palT0 = beatClock;
                        st.palDur = beats(cfg.ease || [4, 10]);
                    }
                }

                // ── continuous keys, eased across the window ──
                if ((cfg.keys || []).length) {
                    if (!st.target || beatClock >= st.t0 + st.dur) retarget(name, st, cfg, now);
                    const u = st.dur > 0 ? Math.min(1, (beatClock - st.t0) / st.dur) : 1;
                    const e = u * u * (3 - 2 * u);
                    cfg.keys.forEach(function (k) {
                        const r = RANGES[k];
                        let v = st.from[k] + (st.target[k] - st.from[k]) * e;
                        if (r && r[2] === 1) v = Math.round(v);
                        if (v === params[k]) return;
                        params[k] = v;
                        if (uiDue) setSlider(k, (r && r[2] === 1) ? v : +v.toFixed(2));
                        touched = true;
                    });
                }

                // ── palette, eased the same way ──
                if (name === 'colour' && st.palTarget && st.palFrom) {
                    const u = st.palDur > 0 ? Math.min(1, (beatClock - st.palT0) / st.palDur) : 1;
                    const e = u * u * (3 - 2 * u);
                    let moved = false;
                    for (let i = 0; i < 5; i++) {
                        const a = hexToRgb(st.palFrom[i]);
                        const b = hexToRgb(st.palTarget[i]);
                        const hex = '#' + [0, 1, 2].map(function (j) {
                            return Math.round(a[j] + (b[j] - a[j]) * e).toString(16).padStart(2, '0');
                        }).join('');
                        if (hex !== params.colorPalette[i]) { params.colorPalette[i] = hex; moved = true; }
                    }
                    if (moved) {
                        tablesDirty = true;
                        if (uiDue) setPaletteUI();
                    }
                    if (u >= 1) { st.palTarget = null; st.palFrom = null; }
                }
            });

            if (touched) { tablesDirty = true; fieldDirty = true; }
            return touched;
        }

        function regenerate() { scheduleRender(); }

        function downloadPNG() {
            saveCanvas('refracted-descent-seed-' + params.seed, 'png');
        }

        // ═══════════════════════════════════════════════════════════════════════
        // SEED + RANDOMISATION
        // ═══════════════════════════════════════════════════════════════════════

        function updateSeedDisplay() {
            document.getElementById('seed-input').value = params.seed;
            refreshShareUI();
        }

        function updateSeed() {
            const input = document.getElementById('seed-input');
            const newSeed = parseInt(input.value);
            if (newSeed && newSeed > 0) {
                params.seed = newSeed;
                scheduleRender();
            } else {
                updateSeedDisplay();
            }
        }

        function previousSeed() {
            params.seed = Math.max(1, params.seed - 1);
            updateSeedDisplay();
            scheduleRender();
        }

        function nextSeed() {
            params.seed = params.seed + 1;
            updateSeedDisplay();
            scheduleRender();
        }

        function rr(a, b) { return a + Math.random() * (b - a); }
        function ri(a, b) { return Math.floor(rr(a, b + 1)); }

        function hsl(h, s, l) {
            // → hex, so randomised palettes stay saturated instead of muddy
            const a = s * Math.min(l, 1 - l);
            const f = function (n) {
                const k = (n + h * 12) % 12;
                const v = l - a * Math.max(-1, Math.min(Math.min(k - 3, 9 - k), 1));
                return Math.round(v * 255).toString(16).padStart(2, '0');
            };
            return '#' + f(0) + f(8) + f(4);
        }

        // A ramp, not a rainbow: one hue family, occasionally a second one
        // opposite it for an accent, ordered dark to light so the scope reads
        // as depth rather than as static.
        function randomPalette() {
            if (Math.random() < 0.5) {
                const keys = Object.keys(PRESETS);
                return PRESETS[keys[ri(0, keys.length - 1)]].slice();
            }

            const base = Math.random();
            const span = rr(0.04, 0.13);          // how far the family drifts
            const dir = Math.random() < 0.5 ? 1 : -1;
            const accent = Math.random() < 0.45;

            const out = [];
            for (let i = 0; i < 5; i++) {
                const k = i / 4;
                let h = base + dir * span * k;
                let sat = rr(0.32, 0.68) * (1 - 0.35 * k);
                if (accent && i === 4) {
                    h = base + 0.5 + rr(-0.04, 0.04);   // one complementary note
                    sat = rr(0.45, 0.7);
                }
                out.push(hsl((h % 1 + 1) % 1, sat, 0.1 + 0.78 * k));
            }
            return out;
        }

        // The Random button moves everything, not just the seed. Ranges are
        // deliberately narrower than the sliders allow — the extremes are worth
        // reaching by hand, but they make for poor dice rolls. An uploaded image
        // is never swapped out from under you; a built-in plate may be.
        function randomSeedAndUpdate() {
            const locked = function (sec) { return secState[sec] && secState[sec].lock; };
            const keepSeed = params.seed, keepTiling = params.tiling;
            const keep = {};
            Object.keys(SECTIONS).forEach(function (name) {
                if (!locked(name)) return;
                (SECTIONS[name].keys || []).forEach(function (k) { keep[k] = params[k]; });
            });
            const keepPalette = locked('colour') ? params.colorPalette.slice() : null;

            params.seed = Math.floor(Math.random() * 999999) + 1;

            params.folds     = ri(5, 16);
            params.moire     = +rr(0, 0.6).toFixed(2);
            params.mfreq     = +rr(2, 11).toFixed(1);
            params.detune    = +rr(0.7, 2.1).toFixed(2);
            params.descent   = +rr(1.4, 4.4).toFixed(1);
            params.angular   = +rr(0.6, 2.2).toFixed(1);
            params.twist     = +rr(-1.2, 1.2).toFixed(2);
            params.warp      = +rr(0.4, 2.6).toFixed(1);
            params.octaves   = ri(2, 4);
            params.bands     = +rr(0.6, 1.8).toFixed(1);
            params.rings     = +rr(0, 1.6).toFixed(1);
            params.shift     = +rr(0, 1).toFixed(2);
            params.seam      = +rr(0, 0.5).toFixed(2);
            params.contrast  = +rr(0.6, 1.25).toFixed(2);
            params.rotation  = ri(0, 359);
            // Image ranges stay gentle — a dice roll should re-frame the source,
            // not obliterate it.
            params.imgZoom   = +rr(0.25, 1.1).toFixed(2);
            params.imgPanX   = +rr(0.3, 0.7).toFixed(2);
            params.imgPanY   = +rr(0.3, 0.7).toFixed(2);
            params.imgAngle  = ri(0, 359);
            params.imgWarp   = +rr(0, 0.18).toFixed(2);
            params.mix       = +rr(0, 0.4).toFixed(2);
            params.cellSize  = ri(140, 400);

            params.colorPalette = randomPalette();
            tablesDirty = true;

            ['folds', 'moire', 'mfreq', 'detune', 'descent', 'angular', 'twist', 'warp',
             'octaves', 'bands', 'rings', 'shift', 'seam', 'contrast', 'rotation',
             'imgZoom', 'imgPanX', 'imgPanY', 'imgAngle', 'imgWarp', 'mix', 'cellSize'].forEach(function (k) {
                setSlider(k, params[k]);
            });
            setPaletteUI();
            refreshSrcRegion();

            // Radial gets the larger share — it's the mode most seeds flatter.
            const roll = Math.random();
            const mode = roll < 0.5 ? 'radial' : (roll < 0.78 ? 'triangle' : 'square');
            if (mode !== params.tiling) {
                setTiling(mode);
            } else {
                params.tiling = mode;
            }

            // Put the pinned sections back.
            Object.keys(keep).forEach(function (k) { params[k] = keep[k]; setSlider(k, keep[k]); });
            if (keepPalette) { params.colorPalette = keepPalette; setPaletteUI(); }
            if (locked('seed')) { params.seed = keepSeed; }
            if (locked('symmetry') && params.tiling !== keepTiling) setTiling(keepTiling);

            animPhase = 0;
            updateSeedDisplay();

            if (locked('source')) { scheduleRender(); return; }

            // Swap plates only if we're on a built-in one and it is not pinned.
            if (params.source === 'image' && activeBase !== null && !imageLocked) {
                const avail = BASE_PLATES.filter(function (x) { return !x.missing; });
                const b = avail[ri(0, avail.length - 1)];
                useBasePlate(b.id, b.name);
                return;
            }
            scheduleRender();
        }

        function resetParameters() {
            const keptSeed = params.seed;
            const keptSource = params.source;
            params = JSON.parse(JSON.stringify(defaultParams));
            tablesDirty = true;
            params.seed = keptSeed;
            params.source = keptSource;
            animPhase = 0;
            spinAngle = 0;
            dragVel = 0;

            ['folds', 'moire', 'mfreq', 'detune', 'descent', 'angular', 'twist', 'warp',
             'octaves', 'bands', 'rings', 'shift', 'seam', 'contrast', 'rotation',
             'flow', 'spin', 'trail', 'bpm', 'imgZoom', 'imgPanX', 'imgPanY', 'imgAngle',
             'imgWarp', 'mix', 'cellSize'].forEach(function (k) {
                setSlider(k, params[k]);
            });
            setPaletteUI();
            refreshSrcRegion();

            updateSeedDisplay();
            setTiling(params.tiling);
        }

        // ═══════════════════════════════════════════════════════════════════════
        // GENERATION ID
        //
        // Every knob that shapes the output, packed into the URL. The same link
        // reproduces the same image — the field is a pure function of these and
        // nothing else. A custom upload is the one thing that cannot travel in
        // a URL; built-in plates ride along as their id.
        // ═══════════════════════════════════════════════════════════════════════

        const SHARE_KEYS = ['tiling', 'source', 'seed', 'cellSize', 'folds', 'moire',
            'mfreq', 'detune', 'descent', 'angular', 'twist', 'warp', 'octaves',
            'bands', 'rings', 'shift', 'seam', 'contrast', 'rotation', 'flow',
            'spin', 'trail', 'imgZoom', 'imgPanX', 'imgPanY', 'imgAngle',
            'imgWarp', 'mix'];

        function b64url(str) {
            return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
        }

        function unb64url(str) {
            const p = str.replace(/-/g, '+').replace(/_/g, '/');
            return atob(p + '==='.slice((p.length + 3) % 4));
        }

        function encodeState() {
            const vals = SHARE_KEYS.map(function (k) { return params[k]; });
            vals.push(params.colorPalette.map(function (c) { return c.slice(1); }).join(''));
            vals.push(activeBase || '');
            return b64url(JSON.stringify(vals));
        }

        function applyState(code) {
            let vals;
            try { vals = JSON.parse(unb64url(code)); } catch (e) { return false; }
            if (!Array.isArray(vals) || vals.length < 4) return false;

            // Links carry however many keys existed when they were made. Read
            // that many and leave anything added since at its default, so older
            // links keep resolving.
            const n = Math.min(SHARE_KEYS.length, vals.length - 2);
            SHARE_KEYS.slice(0, n).forEach(function (k, i) { params[k] = vals[i]; });
            const pal = vals[n];
            if (typeof pal === 'string' && pal.length === 30) {
                params.colorPalette = [0, 1, 2, 3, 4].map(function (i) {
                    return '#' + pal.substr(i * 6, 6);
                });
            }
            tablesDirty = true;

            SHARE_KEYS.forEach(function (k) { setSlider(k, params[k]); });
            setPaletteUI();
            updateSeedDisplay();

            const plate = vals[n + 1];
            if (params.source === 'image' && plate) {
                const b = BASE_PLATES.filter(function (x) { return x.id === plate; })[0];
                if (b) { useBasePlate(b.id, b.name); }
            } else {
                setSource(params.source === 'image' ? 'generated' : params.source);
            }
            setTiling(params.tiling);
            refreshSrcRegion();
            return true;
        }

        // Short, stable, human-quotable label for the current state.
        function generationId() {
            const s = encodeState();
            let h = 2166136261;
            for (let i = 0; i < s.length; i++) {
                h ^= s.charCodeAt(i);
                h = Math.imul(h, 16777619);
            }
            return (h >>> 0).toString(36).toUpperCase().padStart(7, '0');
        }

        function refreshShareUI() {
            const el = document.getElementById('gen-id');
            if (el) el.textContent = generationId();
        }

        function copyLink() {
            const note = document.getElementById('copy-note');
            const done = function (msg) {
                if (!note) return;
                note.textContent = msg;
                setTimeout(function () { note.textContent = ''; }, 3000);
            };
            const put = function (url, label) {
                if (navigator.clipboard && navigator.clipboard.writeText) {
                    navigator.clipboard.writeText(url).then(
                        function () { done(label); },
                        function () { done(url); });
                } else {
                    done(url);
                }
            };

            const state = encodeState();
            const long = location.origin + location.pathname + '#s=' + state;

            // Register the generation and hand back /g/<id>. Standalone there is
            // no endpoint, so the self-contained link is the fallback.
            fetch('/api/share', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ state: state })
            }).then(function (r) {
                if (!r.ok) throw new Error('no share endpoint');
                return r.json();
            }).then(function (res) {
                put(location.origin + res.url, 'Copied ' + res.url);
            }).catch(function () {
                put(long, 'Link copied.');
            });
        }

        // Standalone this fires on load. Mounted into an app the script arrives
        // after load has already gone by, so run immediately in that case.
        function onReady(fn) {
            if (document.readyState === 'complete') setTimeout(fn, 0);
            else window.addEventListener('load', fn);
        }

        onReady(function () {
            updateSeedDisplay();
            setPaletteBase(paletteBase, true);

            // Endless scroll, topped up well before the bottom is reached.
            const list = document.getElementById('pal-scroll');
            list.addEventListener('scroll', function () {
                if (list.scrollTop + list.clientHeight > list.scrollHeight - 300) {
                    growPalettes(15);
                }
                schedulePaletteScan();
            }, { passive: true });

            const m = location.hash.match(/[#&]s=([A-Za-z0-9_-]+)/);
            if (m && applyState(m[1])) {
                // Arriving on a link means arriving at a finished piece.
                enterStudio();
            }
            if (window.__kaleidoscopeSourceUrl) {
                adoptHostedSource(window.__kaleidoscopeSourceUrl);
            }
            refreshShareUI();

            buildOrbPoints();

            // Open in motion. Breathing leads, since it rocks the colour rather
            // than scrolling it and holds spin to a trace. Animate runs too, so
            // switching Breathing off leaves movement rather than a still frame
            // — while breathing is on it owns the flow and the two do not stack.
            setBreath(params.breath);
            if (!animating) toggleAnimate();
        });
    
