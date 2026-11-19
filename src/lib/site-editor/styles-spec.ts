/**
 * Whitelisted style properties for editor blocks and Stracker sections, with value checks
 * and the CSS they compile to. No arbitrary CSS: every value is matched against a strict
 * pattern or a fixed option list, so nothing user-supplied can break out of a declaration.
 */

const LEN = '(?:0|-?\\d{1,4}(?:\\.\\d{1,3})?(?:px|rem|em|%|vw|vh|ch))'
const LENGTH = new RegExp(`^${LEN}$`)
const LENGTH_AUTO = new RegExp(`^(?:${LEN}|auto)$`)
const BOX = new RegExp(`^(?:${LEN}|auto)(?: (?:${LEN}|auto)){0,3}$`)
const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const RGB = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(?:,\s*(?:0|1|0?\.\d{1,3})\s*)?\)$/
const UNSAFE_CSS_URL = /["'()\\\r\n;{}\s]/
const isSafeCssUrl = (value: string): boolean => !UNSAFE_CSS_URL.test(value) && /^(?:https:\/\/|\/(?!\/))/.test(value)

/** Theme colours an editor may pick; each maps to an existing homepage CSS variable. */
export const COLOR_TOKENS: Record<string, string> = {
  ink: '--hp-ink', 'ink-soft': '--hp-ink-soft', 'ink-faint': '--hp-ink-faint', paper: '--hp-paper', 'paper-2': '--hp-paper-2',
  card: '--hp-card', line: '--hp-line', 'line-strong': '--hp-line-strong', accent: '--hp-accent-solid', 'accent-text': '--hp-accent-text',
  'on-accent': '--hp-on-accent', yellow: '--hp-yellow', highlight: '--hp-hl', good: '--hp-good',
  blue: '--hp-blue', 'blue-ink': '--hp-blue-ink', mint: '--hp-mint', 'mint-ink': '--hp-mint-ink', orange: '--hp-orange', 'orange-ink': '--hp-orange-ink',
  pink: '--hp-pink', 'pink-ink': '--hp-pink-ink', violet: '--hp-violet', 'violet-ink': '--hp-violet-ink', sky: '--hp-sky', 'sky-ink': '--hp-sky-ink',
  teal: '--hp-teal', 'teal-ink': '--hp-teal-ink', 'yellow-bg': '--hp-yellowbg', 'yellow-ink': '--hp-yellow-ink'
}

export function isColor(value: string): boolean {
  if (value === 'transparent' || value === 'currentColor') return true
  if (value.startsWith('token:')) return Object.prototype.hasOwnProperty.call(COLOR_TOKENS, value.slice(6))
  return HEX.test(value) || RGB.test(value)
}

export function colorCss(value: string): string {
  return value.startsWith('token:') ? `var(${COLOR_TOKENS[value.slice(6)]})` : value
}

type Check = { kind: 'pattern'; re: RegExp } | { kind: 'options'; options: readonly string[] } | { kind: 'color' } | { kind: 'number'; min: number; max: number; int?: boolean } | { kind: 'media' }

export interface StyleProp {
  key: string
  label: string
  group: 'Typography' | 'Colours' | 'Dimensions' | 'Spacing' | 'Appearance' | 'Layout' | 'Visibility'
  check: Check
  /** Turns a validated value into CSS declarations. */
  css: (value: string) => string
}

const plain = (property: string) => (value: string) => `${property}:${value}`
const pattern = (re: RegExp): Check => ({ kind: 'pattern', re })
const options = (...values: string[]): Check => ({ kind: 'options', options: values })

export const SHADOWS: Record<string, string> = {
  none: 'none',
  soft: 'var(--hp-soft-shadow)',
  paper: '0 2px 0 var(--hp-line-strong)',
  hard: '4px 4px 0 var(--hp-hard)',
  lifted: '0 24px 60px -24px rgba(28, 36, 51, .35)'
}

export const GRADIENTS: Record<string, string> = {
  none: 'none',
  sunrise: 'linear-gradient(135deg, var(--hp-yellowbg), var(--hp-pink))',
  mint: 'linear-gradient(135deg, var(--hp-mint), var(--hp-sky))',
  ink: 'linear-gradient(135deg, var(--hp-blue), var(--hp-violet))',
  paper: 'linear-gradient(180deg, var(--hp-paper-2), var(--hp-paper))'
}

export const FONT_FAMILIES: Record<string, string> = { hand: 'var(--hp-hand)', body: 'var(--hp-body)', system: 'system-ui, sans-serif', mono: 'ui-monospace, monospace' }

const FOCUS: Record<string, string> = { center: 'center', top: 'center top', bottom: 'center bottom', left: 'left center', right: 'right center' }

export const STYLE_PROPS: readonly StyleProp[] = [
  { key: 'fontFamily', label: 'Font', group: 'Typography', check: options(...Object.keys(FONT_FAMILIES)), css: value => `--font-public:${FONT_FAMILIES[value]}` },
  { key: 'fontSize', label: 'Font size', group: 'Typography', check: pattern(LENGTH), css: plain('font-size') },
  { key: 'fontWeight', label: 'Weight', group: 'Typography', check: options('300', '400', '500', '600', '700', '800', '900'), css: plain('font-weight') },
  { key: 'lineHeight', label: 'Line height', group: 'Typography', check: { kind: 'number', min: 0.8, max: 3 }, css: plain('line-height') },
  { key: 'letterSpacing', label: 'Letter spacing', group: 'Typography', check: pattern(LENGTH), css: plain('letter-spacing') },
  { key: 'textAlign', label: 'Text align', group: 'Typography', check: options('left', 'center', 'right', 'justify'), css: plain('text-align') },
  { key: 'textDecoration', label: 'Decoration', group: 'Typography', check: options('none', 'underline', 'line-through'), css: plain('text-decoration-line') },
  { key: 'textTransform', label: 'Case', group: 'Typography', check: options('none', 'uppercase', 'lowercase', 'capitalize'), css: plain('text-transform') },
  { key: 'textWrap', label: 'Wrapping', group: 'Typography', check: options('wrap', 'balance', 'pretty', 'nowrap'), css: value => value === 'nowrap' ? 'white-space:nowrap' : `text-wrap:${value}` },
  { key: 'color', label: 'Text colour', group: 'Colours', check: { kind: 'color' }, css: value => `color:${colorCss(value)}` },
  { key: 'background', label: 'Background', group: 'Colours', check: { kind: 'color' }, css: value => `background-color:${colorCss(value)}` },
  { key: 'gradient', label: 'Gradient', group: 'Colours', check: options(...Object.keys(GRADIENTS)), css: value => `background-image:${GRADIENTS[value]}` },
  { key: 'borderColor', label: 'Border colour', group: 'Colours', check: { kind: 'color' }, css: value => `border-color:${colorCss(value)}` },
  { key: 'opacity', label: 'Opacity', group: 'Appearance', check: { kind: 'number', min: 0, max: 1 }, css: plain('opacity') },
  { key: 'width', label: 'Width', group: 'Dimensions', check: pattern(LENGTH_AUTO), css: plain('width') },
  { key: 'maxWidth', label: 'Max width', group: 'Dimensions', check: pattern(LENGTH_AUTO), css: value => `max-width:${value === 'auto' ? 'none' : `min(${value}, 100%)`}` },
  { key: 'minWidth', label: 'Min width', group: 'Dimensions', check: pattern(LENGTH), css: value => `min-width:min(${value}, 100%)` },
  { key: 'height', label: 'Height', group: 'Dimensions', check: pattern(LENGTH_AUTO), css: plain('height') },
  { key: 'minHeight', label: 'Min height', group: 'Dimensions', check: pattern(LENGTH), css: plain('min-height') },
  { key: 'maxHeight', label: 'Max height', group: 'Dimensions', check: pattern(LENGTH_AUTO), css: value => `max-height:${value === 'auto' ? 'none' : value}` },
  { key: 'padding', label: 'Padding', group: 'Spacing', check: pattern(BOX), css: plain('padding') },
  { key: 'margin', label: 'Margin', group: 'Spacing', check: pattern(BOX), css: plain('margin') },
  { key: 'gap', label: 'Gap', group: 'Spacing', check: pattern(LENGTH), css: plain('gap') },
  { key: 'rowGap', label: 'Row gap', group: 'Spacing', check: pattern(LENGTH), css: plain('row-gap') },
  { key: 'columnGap', label: 'Column gap', group: 'Spacing', check: pattern(LENGTH), css: plain('column-gap') },
  { key: 'borderWidth', label: 'Border width', group: 'Appearance', check: pattern(BOX), css: value => `border-width:${value};border-style:var(--sb-border-style, solid)` },
  { key: 'borderStyle', label: 'Border style', group: 'Appearance', check: options('solid', 'dashed', 'dotted', 'none'), css: value => `--sb-border-style:${value};border-style:${value}` },
  { key: 'borderRadius', label: 'Corner radius', group: 'Appearance', check: pattern(BOX), css: plain('border-radius') },
  { key: 'shadow', label: 'Shadow', group: 'Appearance', check: options(...Object.keys(SHADOWS)), css: value => `box-shadow:${SHADOWS[value]}` },
  { key: 'backgroundImage', label: 'Background image', group: 'Appearance', check: { kind: 'media' }, css: value => (isSafeCssUrl(value) ? `background-image:url("${value}")` : '') },
  { key: 'backgroundSize', label: 'Background size', group: 'Appearance', check: options('cover', 'contain', 'auto'), css: plain('background-size') },
  { key: 'backgroundPosition', label: 'Background position', group: 'Appearance', check: options(...Object.keys(FOCUS)), css: value => `background-position:${FOCUS[value]}` },
  { key: 'overflow', label: 'Overflow', group: 'Appearance', check: options('visible', 'hidden', 'auto'), css: value => `overflow:${value === 'auto' ? 'auto' : value}` },
  { key: 'position', label: 'Position', group: 'Appearance', check: options('static', 'relative'), css: plain('position') },
  { key: 'rotate', label: 'Rotation (deg)', group: 'Appearance', check: { kind: 'number', min: -45, max: 45, int: true }, css: value => `rotate:${value}deg` },
  { key: 'direction', label: 'Direction', group: 'Layout', check: options('row', 'column', 'row-reverse', 'column-reverse'), css: value => `display:flex;flex-direction:${value}` },
  { key: 'alignItems', label: 'Align items', group: 'Layout', check: options('start', 'center', 'end', 'stretch'), css: plain('align-items') },
  { key: 'justify', label: 'Justify', group: 'Layout', check: options('start', 'center', 'end', 'space-between', 'space-around'), css: plain('justify-content') },
  { key: 'wrap', label: 'Wrap', group: 'Layout', check: options('wrap', 'nowrap'), css: plain('flex-wrap') },
  { key: 'columns', label: 'Grid columns', group: 'Layout', check: { kind: 'number', min: 1, max: 6, int: true }, css: value => `display:grid;grid-template-columns:repeat(${value}, minmax(0, 1fr))` },
  { key: 'rows', label: 'Grid rows', group: 'Layout', check: { kind: 'number', min: 1, max: 12, int: true }, css: value => `grid-template-rows:repeat(${value}, auto)` },
  { key: 'order', label: 'Order', group: 'Layout', check: { kind: 'number', min: -10, max: 10, int: true }, css: plain('order') },
  { key: 'selfAlign', label: 'Align self', group: 'Layout', check: options('auto', 'start', 'center', 'end', 'stretch'), css: value => `align-self:${value};${value === 'center' ? 'margin-inline:auto' : ''}` },
  { key: 'display', label: 'Visible on this device', group: 'Visibility', check: options('show', 'hide'), css: value => value === 'hide' ? 'display:none !important' : '' }
]

export const STYLE_PROP_MAP: Record<string, StyleProp> = Object.fromEntries(STYLE_PROPS.map(prop => [prop.key, prop]))

/** Editable global tokens: the homepage CSS variables, for light and dark. */
export const DESIGN_TOKENS: ReadonlyArray<{ key: string; label: string; group: string; kind: 'color' | 'length' | 'font' | 'shadow' }> = [
  { key: 'accent-solid', label: 'Primary / accent', group: 'Colours', kind: 'color' },
  { key: 'accent-text', label: 'Accent text', group: 'Colours', kind: 'color' },
  { key: 'yellow', label: 'Highlight yellow', group: 'Colours', kind: 'color' },
  { key: 'paper', label: 'Page background', group: 'Surfaces', kind: 'color' },
  { key: 'paper-2', label: 'Paper surface', group: 'Surfaces', kind: 'color' },
  { key: 'card', label: 'Card surface', group: 'Surfaces', kind: 'color' },
  { key: 'ink', label: 'Text', group: 'Text', kind: 'color' },
  { key: 'ink-soft', label: 'Muted text', group: 'Text', kind: 'color' },
  { key: 'line', label: 'Border', group: 'Borders', kind: 'color' },
  { key: 'line-strong', label: 'Strong border', group: 'Borders', kind: 'color' },
  { key: 'radius', label: 'Corner radius', group: 'Shape', kind: 'length' },
  { key: 'shell', label: 'Container width', group: 'Layout', kind: 'length' },
  { key: 'pad', label: 'Section spacing', group: 'Layout', kind: 'length' }
]

export function checkStyleValue(prop: StyleProp, value: unknown, isMedia: (value: string) => boolean): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 240) return null
  const check = prop.check
  if (check.kind === 'pattern') return check.re.test(value) ? value : null
  if (check.kind === 'options') return check.options.includes(value) ? value : null
  if (check.kind === 'color') return isColor(value) ? value : null
  if (check.kind === 'media') return isMedia(value) && isSafeCssUrl(value) ? value : null
  const number = Number(value)
  if (!/^-?\d+(\.\d+)?$/.test(value) || !Number.isFinite(number) || number < check.min || number > check.max) return null
  if (check.int && !Number.isInteger(number)) return null
  return value
}

export function checkTokenValue(kind: 'color' | 'length' | 'font' | 'shadow', value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null
  if (kind === 'color') return (HEX.test(value) || RGB.test(value)) ? value : null
  if (kind === 'length') return LENGTH.test(value) ? value : null
  return null
}
