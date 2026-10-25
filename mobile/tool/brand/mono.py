"""Derives the Android 13+ themed-icon (monochrome) layer from the adaptive-icon foreground.
Keeps only the logo's dark ink (tile outline and the S), as an alpha mask: the launcher tints
it with the wallpaper colour. Run after gen.py: python3 mobile/tool/brand/mono.py (Pillow)."""
from PIL import Image
import os
HERE = os.path.dirname(os.path.abspath(__file__))
R = os.path.abspath(os.path.join(HERE, '..', '..', 'android/app/src/main/res'))
for d in ('mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi'):
    src = Image.open(f'{R}/mipmap-{d}/ic_launcher_foreground.png').convert('RGBA')
    out = Image.new('RGBA', src.size, (0, 0, 0, 0))
    px, po = src.load(), out.load()
    for y in range(src.height):
        for x in range(src.width):
            r, g, b, a = px[x, y]
            lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
            ink = max(0.0, min(1.0, (170 - lum) / 90))  # dark ink -> 1, paper -> 0
            if a and ink:
                po[x, y] = (255, 255, 255, int(a * ink))
    out.save(f'{R}/mipmap-{d}/ic_launcher_monochrome.png', optimize=True)
print('done')
