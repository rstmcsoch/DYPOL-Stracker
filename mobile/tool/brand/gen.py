"""Regenerates the Android splash/launcher bitmaps and assets/brand/logo-mark.png from the vector
reconstruction in vec.py. Run from anywhere: python3 mobile/tool/brand/gen.py (needs Pillow)."""
from PIL import Image, ImageDraw, ImageFont
import os, sys
HERE=os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
MOBILE=os.path.abspath(os.path.join(HERE,'..','..'))
R=os.path.join(MOBILE,'android/app/src/main/res')
A=os.path.join(MOBILE,'assets/brand')
from vec import mark as vector_mark
dens={'mdpi':1,'hdpi':1.5,'xhdpi':2,'xxhdpi':3,'xxxhdpi':4}
def place(canvas_dp, mark_h_dp, s):
    c=int(round(canvas_dp*s)); h=int(round(mark_h_dp*s))
    im=Image.new('RGBA',(c,c),(0,0,0,0))
    m=vector_mark(h)  # rendered from vector geometry at exactly h px, never resampled up
    w=m.width
    im.alpha_composite(m,((c-w)//2,(c-h)//2))
    return im
# Splash icon (Android 12+: 288dp canvas, no icon background, content inside the 192dp circle;
# pre-12 launch_background centres the same bitmap).
for d,s in dens.items():
    os.makedirs(f'{R}/drawable-{d}',exist_ok=True)
    place(288,128,s).save(f'{R}/drawable-{d}/splash_logo.png',optimize=True)
# Fallback drawable/splash_logo.png (mdpi)
place(288,128,1).save(f'{R}/drawable/splash_logo.png',optimize=True)
# Adaptive icon foreground: 108dp canvas, mark 56dp tall inside the 66dp safe zone.
for d,s in dens.items():
    place(108,48,s).save(f'{R}/mipmap-{d}/ic_launcher_foreground.png',optimize=True)
# Branding text "DYPOL LABS" 200x80dp, light and dark ink.
font_path=os.path.join(MOBILE,'assets/fonts/Lexend-SemiBold.ttf')
def brand(s, color):
    W,H=int(200*s),int(80*s)
    im=Image.new('RGBA',(W,H),(0,0,0,0))
    f=ImageFont.truetype(font_path,int(round(13*s)))
    text='DYPOL LABS'; sp=3.2*s
    widths=[f.getlength(ch) for ch in text]
    total=sum(widths)+sp*(len(text)-1)
    x=(W-total)/2
    d=ImageDraw.Draw(im)
    asc,desc=f.getmetrics()
    y=(H-(asc+desc))/2
    for ch,wd in zip(text,widths):
        d.text((x,y),ch,font=f,fill=color); x+=wd+sp
    return im
for d,s in dens.items():
    os.makedirs(f'{R}/drawable-{d}',exist_ok=True); os.makedirs(f'{R}/drawable-night-{d}',exist_ok=True)
    brand(s,(77,90,80,255)).save(f'{R}/drawable-{d}/splash_branding.png',optimize=True)
    brand(s,(196,203,192,255)).save(f'{R}/drawable-night-{d}/splash_branding.png',optimize=True)
# Flutter splash asset: the bare mark at 4x of its 128 dp display height.
vector_mark(512).save(f'{A}/logo-mark.png',optimize=True)  # 4x of 128 dp
print('done')
