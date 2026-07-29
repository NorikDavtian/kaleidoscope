"""Renders a winking smiley as raw RGB24 frames on stdout, for ffmpeg to encode.

No imaging libraries are available here, so shapes are drawn as signed-distance
fields and antialiased analytically — one pass per pixel, no supersampling.
"""
import sys, math

W = H = 360
FRAMES = 30
BG   = (18, 19, 26)
SKIN = (232, 168, 124)
INK  = (18, 19, 26)
ACC  = (217, 119, 87)

def smooth(d):
    """Coverage from a signed distance: 1 inside, 0 outside, soft across a pixel."""
    return 0.0 if d > 0.75 else 1.0 if d < -0.75 else 0.5 - d / 1.5

def over(dst, src, a):
    if a <= 0: return dst
    if a >= 1: return src
    return (dst[0] + (src[0] - dst[0]) * a,
            dst[1] + (src[1] - dst[1]) * a,
            dst[2] + (src[2] - dst[2]) * a)

def eye_open(t):
    """1 = open, 0 = shut. One wink per loop, with easing."""
    if t < 0.34 or t > 0.70: return 1.0
    if t < 0.42:  k = (t - 0.34) / 0.08;  return 1.0 - k * k
    if t < 0.56:  return 0.0
    k = (t - 0.56) / 0.14
    return k * k * (3 - 2 * k)

cx, cy = W / 2.0, H / 2.0
rad = min(W, H) * 0.34
sq  = min(W, H) * 0.15

out = sys.stdout.buffer
for f in range(FRAMES):
    t = f / FRAMES
    e = eye_open(t)

    ex, ey = rad * 0.35, rad * 0.27
    erx = rad * 0.16
    ery = erx * (0.16 + 0.84 * e)          # the lid coming down
    grin = 1.0 + 0.10 * (1.0 - e)          # a touch smugger mid-wink

    mr  = rad * 0.52 * grin                # mouth arc radius
    mth = rad * 0.065                      # and its half-thickness
    my  = cy + rad * 0.10

    row = bytearray()
    for y in range(H):
        fy = y + 0.5
        for x in range(W):
            fx = x + 0.5
            c = BG

            # corner accents
            if (fx < sq * 1.6 and fy < sq * 1.6) or (fx > W - sq * 1.6 and fy > H - sq * 1.6):
                if (sq * 0.3 < fx < sq * 1.3 and sq * 0.3 < fy < sq * 1.3) or \
                   (W - sq * 1.3 < fx < W - sq * 0.3 and H - sq * 1.3 < fy < H - sq * 0.3):
                    c = ACC

            dx, dy = fx - cx, fy - cy
            c = over(c, SKIN, smooth(math.hypot(dx, dy) - rad))

            # eyes — left steady, right winking
            for sx, ry in ((-1.0, erx), (1.0, ery)):
                ox = (dx - sx * ex) / erx
                oy = (dy + ey) / ry
                d = (math.hypot(ox, oy) - 1.0) * min(erx, ry)
                c = over(c, INK, smooth(d))

            # mouth: an annulus clipped to the lower half
            mdy = fy - my
            if mdy > -mth:
                d = abs(math.hypot(dx, mdy) - mr) - mth
                if mdy < mth:
                    d = max(d, -mdy + mth * 0.2)   # square off the ends
                c = over(c, INK, smooth(d))

            row.append(int(c[0])); row.append(int(c[1])); row.append(int(c[2]))
    out.write(row)
out.flush()
