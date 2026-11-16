import { STYLE_PROPS, checkStyleValue, type StyleProp } from '../site-editor/styles-spec.js'

/**
 * Style properties the Student Dashboard Editor may set. Structural properties (size,
 * spacing, typography, layout, borders, visibility per device) reuse the public editor's
 * strict value checks; colours use the student app's own CSS variables, so a student's
 * chosen colour palette and light/night mode keep applying.
 */

const HEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/
const LENGTH = /^(?:0|\d{1,4}(?:\.\d{1,3})?(?:px|rem|em|%))$/

/** Theme colours an admin may pick for a component; each maps to a student-app variable. */
export const STUDENT_COLOR_TOKENS: Record<string, string> = {
  ink: '--ink', 'ink-soft': '--ink-soft', muted: '--muted', paper: '--paper', 'paper-soft': '--paper-soft', 'paper-muted': '--paper-muted',
  bg: '--bg', line: '--line', 'line-strong': '--line-strong', accent: '--accent', 'accent-dark': '--accent-dark', 'accent-light': '--accent-light',
  physics: '--subject-physics', chemistry: '--subject-chemistry', maths: '--subject-maths', red: '--red', green: '--green', orange: '--orange',
  'red-bg': '--red-bg', 'green-bg': '--green-bg', 'orange-bg': '--orange-bg', 'blue-bg': '--blue-bg', 'yellow-bg': '--yellow-bg'
}

export const STUDENT_SHADOWS: Record<string, string> = { none: 'none', soft: 'var(--shadow)', float: 'var(--shadow-float)' }

function isStudentColor(value: string): boolean {
  if (value === 'transparent' || value === 'currentColor') return true
  if (value.startsWith('token:')) return Object.prototype.hasOwnProperty.call(STUDENT_COLOR_TOKENS, value.slice(6))
  return HEX.test(value)
}
function colorCss(value: string): string {
  return value.startsWith('token:') ? `var(${STUDENT_COLOR_TOKENS[value.slice(6)]})` : value
}

const color = (key: string, label: string, property: string): StyleProp => ({ key, label, group: 'Colours', check: { kind: 'color' }, css: value => `${property}:${colorCss(value)}` })

/** Excluded: public-site fonts/gradients/shadows/media, rotation and `order` (order is structural). */
const EXCLUDED = new Set(['fontFamily', 'color', 'background', 'gradient', 'borderColor', 'shadow', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'rotate', 'order', 'position'])

export const STUDENT_STYLE_PROPS: readonly StyleProp[] = [
  ...STYLE_PROPS.filter(prop => !EXCLUDED.has(prop.key)),
  color('color', 'Text colour', 'color'),
  color('background', 'Background', 'background-color'),
  color('borderColor', 'Border colour', 'border-color'),
  { key: 'shadow', label: 'Shadow', group: 'Appearance', check: { kind: 'options', options: Object.keys(STUDENT_SHADOWS) }, css: value => `box-shadow:${STUDENT_SHADOWS[value]}` }
]
export const STUDENT_STYLE_MAP: Record<string, StyleProp> = Object.fromEntries(STUDENT_STYLE_PROPS.map(prop => [prop.key, prop]))

export function checkStudentStyle(key: string, value: unknown): string | null {
  const prop = STUDENT_STYLE_MAP[key]
  if (!prop) return null
  if (prop.check.kind === 'color') return typeof value === 'string' && value.length <= 40 && isStudentColor(value) ? value : null
  return checkStyleValue(prop, value, () => false)
}

/**
 * Global presentation tokens. Colour tokens apply only to the default palette (students
 * who picked their own colour theme keep it), separately for light and night mode.
 * Shape tokens apply to everyone and never touch fonts, so the Reading font and the
 * Patrick Hand identity font stay as they are.
 */
export const STUDENT_TOKENS: ReadonlyArray<{ key: string; label: string; group: string; kind: 'color' | 'length'; variable: string; themed: boolean }> = [
  { key: 'bg', label: 'Page background', group: 'Surfaces', kind: 'color', variable: '--bg', themed: true },
  { key: 'paper', label: 'Main surface', group: 'Surfaces', kind: 'color', variable: '--paper', themed: true },
  { key: 'paper-soft', label: 'Secondary surface', group: 'Surfaces', kind: 'color', variable: '--paper-soft', themed: true },
  { key: 'ink', label: 'Primary text', group: 'Text', kind: 'color', variable: '--ink', themed: true },
  { key: 'ink-soft', label: 'Secondary text', group: 'Text', kind: 'color', variable: '--ink-soft', themed: true },
  { key: 'muted', label: 'Muted text', group: 'Text', kind: 'color', variable: '--muted', themed: true },
  { key: 'accent', label: 'Accent', group: 'Accent', kind: 'color', variable: '--accent', themed: true },
  { key: 'accent-dark', label: 'Accent (strong)', group: 'Accent', kind: 'color', variable: '--accent-dark', themed: true },
  { key: 'yellow-bg', label: 'Highlight', group: 'Accent', kind: 'color', variable: '--yellow-bg', themed: true },
  { key: 'line', label: 'Border', group: 'Borders', kind: 'color', variable: '--line', themed: true },
  { key: 'line-strong', label: 'Divider', group: 'Borders', kind: 'color', variable: '--line-strong', themed: true },
  { key: 'radius', label: 'Card radius', group: 'Shape', kind: 'length', variable: '--radius', themed: false }
]
export const STUDENT_TOKEN_MAP = new Map(STUDENT_TOKENS.map(token => [token.key, token]))

/** Token keys are `light:<key>` / `dark:<key>` for colours and `<key>` for shape tokens. */
export function checkStudentToken(key: string, value: unknown): string | null {
  const match = /^(?:(light|dark):)?([a-z][a-z-]*)$/.exec(key)
  if (!match) return null
  const token = STUDENT_TOKEN_MAP.get(match[2] ?? '')
  if (!token || Boolean(match[1]) !== token.themed || typeof value !== 'string' || value.length > 40) return null
  if (token.kind === 'color') return HEX.test(value) ? value : null
  return LENGTH.test(value) ? value : null
}
