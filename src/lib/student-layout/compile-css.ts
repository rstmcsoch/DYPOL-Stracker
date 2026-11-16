import { STUDENT_STYLE_MAP, STUDENT_TOKENS } from './style-spec.js'
import type { StudentLayoutDocument, StyleMap } from './validate.js'

/**
 * Compiles a validated student layout into one stylesheet. Every value has passed
 * checkStudentLayout (strict patterns / option lists) and every id is a registry id, so
 * selectors and declarations cannot be escaped. Desktop is the base; tablet (≤1024px) and
 * phone (≤640px) overrides use real media queries, so the editor canvas and a student's
 * device apply the same rules.
 */

export const STUDENT_BREAKPOINTS = { tablet: 1024, mobile: 640 } as const

function declarations(style: StyleMap | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    const css = STUDENT_STYLE_MAP[key]?.css(value)
    if (css) parts.push(css)
  }
  return parts.join(';')
}

const ID = /^[a-z][a-z0-9.-]*$/

export function compileStudentLayoutCss(document: StudentLayoutDocument | null): string {
  if (!document) return ''
  const base: string[] = []
  const tablet: string[] = []
  const mobile: string[] = []
  for (const [id, config] of Object.entries(document.components ?? {})) {
    if (!ID.test(id)) continue
    const selector = `.app-shell [data-sl="${id}"][data-sl][data-sl], .app-shell[data-sl="${id}"][data-sl][data-sl]`
    const d = declarations(config.style)
    if (d) base.push(`${selector}{${d}}`)
    const t = declarations(config.responsive?.tablet)
    if (t) tablet.push(`${selector}{${t}}`)
    const m = declarations(config.responsive?.mobile)
    if (m) mobile.push(`${selector}{${m}}`)
  }
  const rules: string[] = []
  const tokens = document.tokens ?? {}
  const light: string[] = []
  const dark: string[] = []
  const shape: string[] = []
  for (const token of STUDENT_TOKENS) {
    if (token.themed) {
      if (tokens[`light:${token.key}`]) light.push(`${token.variable}:${tokens[`light:${token.key}`]}`)
      if (tokens[`dark:${token.key}`]) dark.push(`${token.variable}:${tokens[`dark:${token.key}`]}`)
    } else if (tokens[token.key]) shape.push(`${token.variable}:${tokens[token.key]}`)
  }
  // Colour tokens only reach the default palette: a student's own colour theme wins.
  if (light.length) rules.push(`:root:not([data-color]):not([data-theme='dark']){${light.join(';')}}`)
  if (dark.length) rules.push(`:root:not([data-color])[data-theme='dark']{${dark.join(';')}}`)
  if (shape.length) rules.push(`:root:root{${shape.join(';')}}`)
  rules.push(...base)
  if (tablet.length) rules.push(`@media (max-width: ${STUDENT_BREAKPOINTS.tablet}px){${tablet.join('')}}`)
  if (mobile.length) rules.push(`@media (max-width: ${STUDENT_BREAKPOINTS.mobile}px){${mobile.join('')}}`)
  return rules.join('\n')
}
