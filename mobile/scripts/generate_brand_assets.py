#!/usr/bin/env python3
"""Generate the Stracker app's bundled fonts, brand artwork, and launcher/splash images.

Single source of truth (read-only):
  public/icons/stracker.svg        brand mark used by the website
  public/assets/fonts/*.woff2      the website's self-hosted font subsets

Outputs (all inside mobile/, committed so EAS builds never need the website):
  assets/fonts/*.ttf                   TrueType faces (Android loads TTF, not WOFF2)
  assets/fonts/LICENSES.txt            OFL notices extracted from the font files
  assets/brand/stracker-mark.svg       outlined vector mark (the "S" is a path)
  assets/brand/stracker-logo.png       512 px transparent logo
  assets/images/icon.png               1024 px launcher icon (full bleed)
  assets/images/android-icon-foreground.png   adaptive-icon foreground (safe zone)
  assets/images/android-icon-monochrome.png   themed-icon silhouette
  assets/images/splash-icon.png        splash logo (centred by Expo)
  assets/images/splash-icon-dark.png   splash logo for dark mode
  src/components/brand/stracker-mark.generated.ts   the mark as SVG source for in-app rendering

Requirements (developer machine only):
  pip install fonttools brotli resvg-py pillow

Usage (from the repository root):
  python3 mobile/scripts/generate_brand_assets.py --font /path/to/Gelasio-Bold.ttf

The "S" is outlined from a bold serif face. The website mark declares Georgia, serif, weight 700.
Pass a Georgia-metric face with --font (Gelasio Bold is metric-compatible with Georgia).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
MOBILE = REPO / "mobile"
WEB_FONTS = REPO / "public" / "assets" / "fonts"
WEB_MARK = REPO / "public" / "icons" / "stracker.svg"
DEFAULT_SERIF_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf"

MARK_INK = "#344237"
CREAM = "#f1ead9"
PAPER = "#f7f4ec"
SPLASH_TEXT = "#566057"

# (output name, web subsets to merge in order)
FONT_FACES: dict[str, list[str]] = {
    "PatrickHand-Regular": ["patrick-hand-latin-400-normal", "patrick-hand-latin-ext-400-normal"],
}
for family, slug in [("Lexend", "lexend"), ("Poppins", "poppins"), ("Sora", "sora"), ("OpenSans", "open-sans")]:
    for weight_name, weight in [("Regular", 400), ("Medium", 500), ("SemiBold", 600), ("Bold", 700)]:
        FONT_FACES[f"{family}-{weight_name}"] = [f"{slug}-latin-{weight}-normal", f"{slug}-latin-ext-{weight}-normal"]



def convert_fonts(out_dir: Path) -> None:
    from fontTools import merge
    from fontTools.ttLib import TTFont

    out_dir.mkdir(parents=True, exist_ok=True)
    notices: dict[str, set[str]] = {}
    tmp = out_dir / ".tmp"
    tmp.mkdir(exist_ok=True)
    for out_name, subsets in FONT_FACES.items():
        ttfs: list[Path] = []
        for subset in subsets:
            font = TTFont(WEB_FONTS / f"{subset}.woff2")
            font.flavor = None
            path = tmp / f"{subset}.ttf"
            font.save(path)
            ttfs.append(path)
            for record in font["name"].names:
                if record.nameID in (0, 13) and record.toUnicode().strip():
                    notices.setdefault(out_name.split("-")[0], set()).add(record.toUnicode().strip())
        if len(ttfs) == 1:
            merged = TTFont(ttfs[0])
        else:
            merged = merge.Merger().merge([str(p) for p in ttfs])
        merged.save(out_dir / f"{out_name}.ttf")
        print(f"font  {out_name}.ttf  ({(out_dir / f'{out_name}.ttf').stat().st_size // 1024} KB)")
    for path in tmp.glob("*.ttf"):
        path.unlink()
    tmp.rmdir()
    lines = [
        "Bundled fonts for the Stracker mobile app",
        "Converted from the website's self-hosted subsets. SIL Open Font License 1.1.",
        "",
    ]
    for family in sorted(notices):
        lines.append(f"== {family}")
        lines.extend(sorted(notices[family]))
        lines.append("")
    (out_dir / "LICENSES.txt").write_text("\n".join(lines), encoding="utf-8")


def outline_glyph(font_path: Path, text: str, x: float, y: float, size: float) -> str:
    """Return an SVG path 'd' for `text` centred on x with its baseline at y."""
    from fontTools.pens.svgPathPen import SVGPathPen
    from fontTools.pens.transformPen import TransformPen
    from fontTools.ttLib import TTFont

    font = TTFont(str(font_path))
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    scale = size / font["head"].unitsPerEm
    names = [cmap[ord(ch)] for ch in text]
    total_advance = sum(hmtx[name][0] for name in names) * scale
    cursor = x - total_advance / 2
    commands: list[str] = []
    for name in names:
        pen = SVGPathPen(glyph_set)
        glyph_set[name].draw(TransformPen(pen, (scale, 0, 0, -scale, cursor, y)))
        commands.append(pen.getCommands())
        cursor += hmtx[name][0] * scale
    return " ".join(part for part in commands if part)


def build_svg_variants(font_path: Path) -> dict[str, str]:
    source = WEB_MARK.read_text(encoding="utf-8")
    text_match = re.search(r"<text[^>]*>S</text>", source)
    if not text_match:
        sys.exit("stracker.svg no longer contains the expected <text>S</text> glyph")
    glyph_d = outline_glyph(font_path, "S", 254, 365, 134)
    outlined = source.replace(text_match.group(0), f'<path d="{glyph_d}" fill="{MARK_INK}"/>')
    open_tag = outlined[: outlined.index(">") + 1]
    body = outlined[len(open_tag): outlined.rindex("</svg>")]
    # Background card: the first <rect x="28" ...> in the source.
    card = re.search(r'<rect x="28"[^>]*/>', body)
    if not card:
        sys.exit("expected background card rect not found in stracker.svg")
    full_bleed = f'{open_tag}<rect width="512" height="512" fill="{CREAM}"/>{body}</svg>'
    foreground_body = body.replace(card.group(0), "", 1)
    # Adaptive-icon foreground: no background (the launcher supplies it), scaled into the safe zone.
    foreground = (
        f'{open_tag}<g transform="translate(256 256) scale(0.6) translate(-256 -256)">'
        f"{foreground_body}</g></svg>"
    )
    return {"mark": outlined, "full_bleed": full_bleed, "foreground": foreground}


def render(svg: str, size_px: int) -> bytes:
    import resvg_py

    return bytes(resvg_py.svg_to_bytes(svg_string=svg, width=size_px, height=size_px, skip_system_fonts=True))


def write_png(path: Path, data: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)


def brand_text_png(font_path: Path, text: str, scale: float) -> bytes:
    import io

    from PIL import Image, ImageDraw, ImageFont

    size_px = int(round(17 * scale))
    tracking = 0.22 * size_px
    font = ImageFont.truetype(str(font_path), size_px)
    width = sum(font.getlength(ch) for ch in text) + tracking * (len(text) - 1)
    pad = int(round(4 * scale))
    height = int(round(size_px * 1.5))
    image = Image.new("RGBA", (int(round(width)) + 2 * pad, height + 2 * pad), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    x = float(pad)
    rgb = tuple(int(SPLASH_TEXT[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    for ch in text:
        draw.text((x, pad), ch, font=font, fill=rgb)
        x += font.getlength(ch) + tracking
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def monochrome(svg: str) -> str:
    """Single-ink silhouette of the adaptive foreground, used for Android 13+ themed icons."""
    return re.sub(r'fill="#[0-9a-fA-F]{6}"', 'fill="#000000"', re.sub(r'stroke="#[0-9a-fA-F]{6}"', 'stroke="#000000"', svg))


def write_ts_module(path: Path, mark: str, foreground: str) -> None:
    lines = [
        "/* GENERATED by mobile/scripts/generate_brand_assets.py from public/icons/stracker.svg. Do not edit. */",
        "",
        f"export const STRACKER_MARK_SVG = {json.dumps(mark)} as const",
        "",
        f"export const STRACKER_FOREGROUND_SVG = {json.dumps(foreground)} as const",
        "",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--font", default=DEFAULT_SERIF_BOLD, help="bold serif TTF used to outline the S")
    parser.add_argument("--skip-fonts", action="store_true", help="do not regenerate bundled fonts")
    args = parser.parse_args()
    font_path = Path(args.font)
    if not font_path.exists():
        sys.exit(f"serif font not found: {font_path}")

    if not args.skip_fonts:
        convert_fonts(MOBILE / "assets" / "fonts")

    variants = build_svg_variants(font_path)
    brand_dir = MOBILE / "assets" / "brand"
    images = MOBILE / "assets" / "images"
    brand_dir.mkdir(parents=True, exist_ok=True)
    images.mkdir(parents=True, exist_ok=True)
    (brand_dir / "stracker-mark.svg").write_text(variants["mark"], encoding="utf-8")
    write_png(brand_dir / "stracker-logo.png", render(variants["mark"], 512))
    write_png(images / "icon.png", render(variants["full_bleed"], 1024))
    write_png(images / "android-icon-foreground.png", render(variants["foreground"], 1024))
    write_png(images / "android-icon-monochrome.png", render(monochrome(variants["foreground"]), 1024))
    write_png(images / "splash-icon.png", render(variants["mark"], 1024))
    write_png(images / "splash-icon-dark.png", render(variants["mark"], 1024))
    write_ts_module(MOBILE / "src" / "components" / "brand" / "stracker-mark.generated.ts", variants["mark"], variants["foreground"])
    print("brand artwork, launcher, adaptive, and splash images written")


if __name__ == "__main__":
    main()
