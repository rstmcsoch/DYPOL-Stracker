import { BREAKPOINTS, type BlockStyle, type SiteBlock } from './model.js'
import { DESIGN_TOKENS, STYLE_PROP_MAP } from './styles-spec.js'

/**
 * Compiles validated block styles and design tokens into one stylesheet.
 *
 * Every value reaching here has passed `checkSiteDocument` (strict patterns/option lists),
 * and ids match `^[a-z][a-z0-9-]*$`, so selectors and declarations cannot be escaped.
 * Desktop is the base; tablet and mobile overrides use real `max-width` media queries, so
 * the editor's real-width canvas and a visitor's device apply exactly the same rules.
 */

const SCOPE = '.pub-page'

function declarations(style: BlockStyle | undefined): string {
  if (!style) return ''
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    const prop = STYLE_PROP_MAP[key]
    if (!prop) continue
    const css = prop.css(value)
    if (css) parts.push(css)
  }
  return parts.join(';')
}

function walk(blocks: readonly SiteBlock[], visit: (block: SiteBlock) => void) {
  for (const block of blocks) {
    visit(block)
    if (block.children) walk(block.children, visit)
  }
}

export function compileBlocksCss(blocks: readonly SiteBlock[], tokens?: Record<string, string>): string {
  const base: string[] = []
  const tablet: string[] = []
  const mobile: string[] = []
  walk(blocks, block => {
    const selector = `${SCOPE} [data-sb="${block.id}"][data-sb]`
    const desktop = declarations(block.style)
    if (desktop) base.push(`${selector}{${desktop}}`)
    const t = declarations(block.responsive?.tablet)
    if (t) tablet.push(`${selector}{${t}}`)
    const m = declarations(block.responsive?.mobile)
    if (m) mobile.push(`${selector}{${m}}`)
  })
  const rules = [...base]
  if (tokens) {
    const light: string[] = []
    const dark: string[] = []
    for (const token of DESIGN_TOKENS) {
      const l = tokens[`light:${token.key}`]
      const d = tokens[`dark:${token.key}`]
      if (l) light.push(`--hp-${token.key}:${l}`)
      if (d) dark.push(`--hp-${token.key}:${d}`)
    }
    const themed: string[] = []
    if (light.length) themed.push(`.pub-hp.pub-hp:not([data-public-theme='dark']){${light.join(';')}}`)
    if (dark.length) themed.push(`.pub-hp.pub-hp[data-public-theme='dark']{${dark.join(';')}}`)
    rules.unshift(...themed)
  }
  if (tablet.length) rules.push(`@media (max-width: ${BREAKPOINTS.tablet}px){${tablet.join('')}}`)
  if (mobile.length) rules.push(`@media (max-width: ${BREAKPOINTS.mobile}px){${mobile.join('')}}`)
  return rules.join('\n')
}
