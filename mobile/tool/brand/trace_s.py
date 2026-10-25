"""One-off: traces the 'S' glyph of assets/brand/logo.png into s_glyph.json (pip install potracer)."""
import json, os, numpy as np, potrace
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
src = np.asarray(Image.open(os.path.join(HERE, '..', '..', 'assets/brand/logo.png')).convert('RGB')).astype(float)
X0, Y0, X1, Y1 = 180, 228, 334, 418
crop = src[Y0:Y1, X0:X1]
ink = np.array([52, 66, 55.]); paper = np.array([255, 253, 247.]); rule = np.array([221, 216, 204.])
# ink coverage per pixel against the local background (paper or rule line)
cov = np.zeros(crop.shape[:2])
for bgc in (paper, rule):
    c = ((bgc - crop) / (bgc - ink))[..., 1]  # green channel has the best contrast
    cov = np.maximum(cov, np.clip(c, 0, 1) * (np.abs(crop - (ink + (bgc - ink) * (1 - np.clip(c, 0, 1))[..., None])).max(axis=2) < 25))
U = 8
big = Image.fromarray((cov * 255).astype(np.uint8)).resize((crop.shape[1] * U, crop.shape[0] * U), Image.BICUBIC)
bm = np.asarray(big) > 127
path = potrace.Bitmap(~bm).trace(turdsize=50, alphamax=1.0, opticurve=True, opttolerance=0.2)
polys = []
def bez(p0, p1, p2, p3, n=10):
    return [tuple(((1-t)**3*np.array(p0)+3*(1-t)**2*t*np.array(p1)+3*(1-t)*t*t*np.array(p2)+t**3*np.array(p3)).tolist()) for t in np.linspace(0,1,n)[1:]]
for curve in path:
    pts = []; cur = (curve.start_point.x, curve.start_point.y); pts.append(cur)
    for seg in curve:
        if seg.is_corner:
            pts += [(seg.c.x, seg.c.y), (seg.end_point.x, seg.end_point.y)]
        else:
            pts += bez(cur, (seg.c1.x, seg.c1.y), (seg.c2.x, seg.c2.y), (seg.end_point.x, seg.end_point.y))
        cur = (seg.end_point.x, seg.end_point.y)
    polys.append(([(X0 + x / U, Y0 + y / U) for x, y in pts], True))
json.dump([[[(round(x, 2), round(y, 2)) for x, y in p], f] for p, f in polys], open(os.path.join(HERE, 's_glyph.json'), 'w'))
print(len(polys), [len(p) for p, _ in polys])
