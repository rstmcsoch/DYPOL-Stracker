"""Vector reconstruction of the Stracker logo (mobile/assets/brand/logo.png, public/icons/icon-512.png).
All geometry is in the 512-unit design space of the master; render() rasterises at any size by
supersampling and *downscaling* only, so no output is ever upscaled from pixels."""
import json, os
import numpy as np
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
BG = (241, 234, 217); PAPER = (255, 253, 247); INK = (52, 66, 55)
RULE = (221, 216, 204); BLUE = (82, 109, 156); RING = (133, 145, 142); STAR = (201, 144, 76)
FRAME = (85, 82, 427, 436)  # outer box, end-exclusive
STAR_PTS = [(399.5, 67), (402.5, 92), (412.5, 89), (409, 98), (435.5, 102), (409, 106), (412.5, 115), (402.5, 112),
            (399.5, 138), (396.5, 112), (386.5, 115), (390, 106), (363.5, 102), (390, 98), (386.5, 89), (396.5, 92)]
S_PATHS = json.load(open(os.path.join(HERE, 's_glyph.json')))  # list of polygons (512-space, subpixel)

MARK_BOX = (85, 67, 439, 448)  # frame + shadow + star, 354 x 381 design units


def render(view, out_w, out_h, ss=8, background=True, radius=42, frame_w=14):
    """Rasterise the design-space rectangle view=(x0, y0, x1, y1) into out_w x out_h pixels."""
    vx0, vy0, vx1, vy1 = view
    k = out_h * ss / float(vy1 - vy0)
    W, H = out_w * ss, out_h * ss
    def P(x, y):
        return ((x - vx0) * k, (y - vy0) * k)
    def R(x0, y0, x1, y1):
        a, b = P(x0, y0); c, d = P(x1, y1)
        return [a, b, c - 1, d - 1]
    im = Image.new('RGBA', (W, H), BG + (255,) if background else (0, 0, 0, 0))
    sh = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    x0, y0, x1, y1 = FRAME
    ImageDraw.Draw(sh).rounded_rectangle(R(x0 + 12, y0 + 12, x1 + 12, y1 + 12), radius=radius * k, fill=(0, 0, 0, 33))
    im.alpha_composite(sh)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(R(x0, y0, x1, y1), radius=radius * k, fill=PAPER, outline=INK, width=max(1, round(frame_w * k)))
    for i in range(5):
        y = 142 + 54 * i
        d.rectangle(R(145, y, 384, y + 8), fill=RULE)
    d.rectangle(R(163, 125, 354, 133), fill=BLUE)
    d.arc(R(135, 117, 164, 170), 180, 360, fill=RING, width=max(1, round(5 * k)))
    d.polygon([P(x, y) for x, y in STAR_PTS], fill=STAR)
    sm = Image.new('L', (W, H), 0)
    ds = ImageDraw.Draw(sm)
    for poly, fill in S_PATHS:
        ds.polygon([P(x, y) for x, y in poly], fill=255 if fill else 0)
    im.paste(INK + (255,), (0, 0), sm)
    return im.resize((out_w, out_h), Image.LANCZOS) if ss > 1 else im


def draw_logo(size, ss=8, background=True, radius=42):
    return render((0, 0, 512, 512), size, size, ss=ss, background=background, radius=radius)


def mark(height_px, ss=8):
    w = round(height_px * (MARK_BOX[2] - MARK_BOX[0]) / (MARK_BOX[3] - MARK_BOX[1]))
    # widen the view so the pixel grid maps exactly onto the requested size
    vw = w * (MARK_BOX[3] - MARK_BOX[1]) / height_px
    cx = (MARK_BOX[0] + MARK_BOX[2]) / 2
    return render((cx - vw / 2, MARK_BOX[1], cx + vw / 2, MARK_BOX[3]), w, height_px, ss=ss, background=False)
