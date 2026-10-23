import re, json
from pathlib import Path

TOKENS = [
 ('bg','--bg'),('paper','--paper'),('paperSoft','--paper-soft'),('paperMuted','--paper-muted'),
 ('ink','--ink'),('inkSoft','--ink-soft'),('muted','--muted'),('line','--line'),('lineStrong','--line-strong'),
 ('accent','--accent'),('accentDark','--accent-dark'),('accentLight','--accent-light'),
 ('textMuted','--text-muted'),('textAccent','--text-accent'),
 ('physics','--subject-physics'),('chemistry','--subject-chemistry'),('maths','--subject-maths'),
 ('physicsBg','--subject-physics-bg'),('chemistryBg','--subject-chemistry-bg'),('mathsBg','--subject-maths-bg'),
 ('red','--red'),('redBg','--red-bg'),('green','--green'),('greenBg','--green-bg'),
 ('orange','--orange'),('orangeBg','--orange-bg'),('blueBg','--blue-bg'),('yellowBg','--yellow-bg'),
 ('chartGrid','--chart-grid'),('ringTrack','--ring-track'),('focusAccent','--focus-accent'),
]

def parse_block(text):
    out = {}
    for key, token in TOKENS:
        m = re.search(re.escape(token) + r':\s*(#[0-9a-fA-F]{3,8})', text)
        if m: out[key] = m.group(1)
    return out

base = Path('src/styles/base.css').read_text()
themes = Path('src/styles/themes.css').read_text()

# Default palette = base :root block, dark = base [data-theme='dark'] block
root_block = base.split(':root {',1)[1].split('\n}',1)[0]
dark_start = base.index(":root[data-theme='dark'] {")
dark_block = base[dark_start:].split('\n}',1)[0]
palettes = {'default': {'light': parse_block(root_block), 'dark': parse_block(dark_block)}}

order = ['default']
for m in re.finditer(r":root\[data-color='([a-z-]+)'\](\[data-theme='dark'\])?\s*\{", themes):
    name, is_dark = m.group(1), bool(m.group(2))
    block = themes[m.end():].split('\n}',1)[0]
    if name not in palettes:
        palettes[name] = {'light': {}, 'dark': {}}
        order.append(name)
    palettes[name]['dark' if is_dark else 'light'] = parse_block(block)

missing = {n: {mode: [k for k in palettes[n][mode] if k not in palettes['default'][mode]] for mode in ('light','dark')} for n in order}
print(json.dumps({'order': order, 'sizes': {n: {m: len(palettes[n][m]) for m in ('light','dark')} for n in order}}, indent=1))

def hexliteral(v):
    return "'" + v + "'"

lines = []
lines.append("// GENERATED from src/styles/base.css + src/styles/themes.css.")
lines.append("// Every palette below is copied from the deployed Stracker stylesheet so the")
lines.append("// Android app uses the same colours as the website. Do not hand-edit: rerun")
lines.append("// mobile/tool/generate_palettes.py against the web sources.")
lines.append("")
lines.append("import 'dart:ui' show Color;")
lines.append("")
lines.append("/// Semantic colour tokens for one palette in one display mode.")
lines.append("class StrackerPalette {")
lines.append("  const StrackerPalette({")
for key,_ in TOKENS:
    lines.append("    required this.%s," % key)
lines.append("  });")
lines.append("")
for key,_ in TOKENS:
    lines.append("  final Color %s;" % key)
lines.append("}")
lines.append("")
lines.append("/// Palette id -> {mode -> palette}.")
lines.append("const Map<String, Map<String, StrackerPalette>> strackerPalettes = {")
for name in order:
    lines.append("  '%s': {" % name)
    for mode in ('light','dark'):
        data = dict(palettes['default'][mode]); data.update(palettes[name][mode])
        lines.append("    '%s': StrackerPalette(" % mode)
        for key,_ in TOKENS:
            v = data.get(key, palettes['default'][mode].get(key, '#000000'))
            lines.append("      %s: Color(0xFF%s)," % (key, v.lstrip('#').upper() if len(v)==7 else v.lstrip('#').upper()))
        lines.append("    ),")
    lines.append("  },")
lines.append("};")
lines.append("")
lines.append("const List<({String id, String label, String description})> strackerPaletteOptions = [")
meta = {
 'default': ('Default', 'The classic Stracker warm paper and chalkboard.'),
 'sunset-blaze': ('Sunset Blaze', 'Coral, burnt orange and deep plum on calm neutrals.'),
 'forest-emerald': ('Forest Emerald', 'Deep emerald and sage for long, calm sessions.'),
 'sandalwood': ('Sandalwood', 'Warm sand, brown and earthy olive accents.'),
 'ocean-deep': ('Ocean Deep', 'Navy, teal and controlled aqua. Quiet and premium.'),
 'sakura-blossom': ('Sakura Blossom', 'Blush, cherry pink and plum with readable ink.'),
 'dracula-midnight': ('Dracula Midnight', 'The official Dracula palette, adapted for study.'),
 'lavender-mist': ('Lavender Mist', 'Muted lavender, violet and cool indigo accents.'),
 'cyberpunk-neon': ('Cyberpunk Neon', 'Deep indigo surfaces with controlled neon accents.'),
}
for name in order:
    label, desc = meta.get(name, (name.title(), 'Stracker palette.'))
    lines.append("  (id: '%s', label: '%s', description: '%s')," % (name, label, desc))
lines.append("];")
Path('mobile/lib/core/theme/palettes.dart').write_text("\n".join(lines) + "\n")
print('wrote', len(lines), 'lines')
