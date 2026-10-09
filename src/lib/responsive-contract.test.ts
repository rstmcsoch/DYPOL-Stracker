import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { READING_FONT_OPTIONS } from './fonts'
import { READING_FONTS } from '../types'

const sourceDir = fileURLToPath(new URL('../', import.meta.url))
const stylesDir = `${sourceDir}styles/`
const read = (file: string) => readFileSync(`${stylesDir}${file}`, 'utf8')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = `${directory}/${entry.name}`
    return entry.isDirectory() ? sourceFiles(path) : entry.isFile() ? [path] : []
  })
}

const base = read('base.css')
const responsive = read('responsive.css')
const componentStyles = readdirSync(stylesDir)
  .filter(file => file.endsWith('.css'))
  .map(file => read(file))
  .join('\n')
const entry = readFileSync(new URL('../styles.css', import.meta.url), 'utf8')
const report = readFileSync(new URL('./report.ts', import.meta.url), 'utf8')

/**
 * Deliberate exceptions to the guarded-minimum rule:
 *  · syllabus and chapter rows are table rows, so their columns are sized like a table and
 *    switch structure at the tablet tier instead of reflowing one pixel at a time;
 *  · the heatmap is a 16-week calendar, so its cells must stay square-ish;
 *  · the auth card keeps a comfortable reading width next to the intro column;
 *  · the hero keeps a two-up countdown and streak pair on phones by design;
 *  · the dashboard/board-aside pair keeps its side column until the phone tier, where it
 *    becomes a single column.
 * Their minimums are small enough (or paired with a `minmax(0, …)` neighbour) that they
 * cannot push the page sideways; everything else has to reflow on its own.
 */
const INTENTIONAL_FIXED_GRIDS = [
  '.syllabus-table-head', '.chapter-row', '.heatmap-grid', '.auth-content', '.hero-row',
  '.dashboard-grid'
]

function gridDeclarations(css: string): { selector: string; value: string }[] {
  const found: { selector: string; value: string }[] = []
  for (const line of css.split('\n')) {
    for (const match of line.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = (match[1] ?? '').trim()
      for (const declaration of (match[2] ?? '').split(';')) {
        const value = declaration.trim()
        if (value.startsWith('grid-template-columns')) found.push({ selector, value })
      }
    }
  }
  return found
}

describe('responsive layout contract', () => {
  it('keeps one shared stylesheet entry with no per-device files', () => {
    const files = readdirSync(stylesDir)
    expect(files).toEqual(expect.arrayContaining(['base.css', 'qa.css', 'responsive.css']))
    expect(files.filter(file => /^(mobile|tablet|laptop|desktop)\.css$/.test(file))).toEqual([])
    expect(entry.indexOf("base.css")).toBeLessThan(entry.indexOf("responsive.css"))
  })

  it('constrains the sidebar to the viewport and gives navigation its own scroller', () => {
    const sidebar = /\.sidebar \{([^}]*)\}/.exec(base)?.[1] ?? ''
    expect(sidebar).toContain('height: 100vh; height: 100dvh;')
    expect(sidebar).toContain('overflow: hidden auto;')
    expect(sidebar).toContain('position: sticky;')

    const scroller = /\.sidebar-scroll \{([^}]*)\}/.exec(base)?.[1] ?? ''
    expect(scroller).toContain('overflow: hidden auto;')
    expect(scroller).toContain('min-height:')
    expect(scroller).toContain('flex: 1 1 auto;')

    // Branding and the account block stay outside the scrolling region.
    expect(base).toContain('.sidebar-head { flex: none;')
    expect(/\.sidebar-bottom \{ flex: none;/.test(base)).toBe(true)
  })

  it('never leaves a bare 100vh surface without a dvh companion', () => {
    const viewportHeights = [...base.matchAll(/(?:^|[;{\s])height:\s*100vh;/g)]
    for (const match of viewportHeights) {
      const following = base.slice(match.index ?? 0, (match.index ?? 0) + 80)
      expect(following).toContain('100dvh')
    }
    expect(base).not.toMatch(/min-height:\s*100vh;\}/)
  })

  it('reflows card, KPI, and form grids intrinsically instead of forcing equal columns', () => {
    const intrinsic = [
      '.test-summary-grid', '.analytics-kpi-grid', '.analytics-metric-grid', '.weak-overview-grid',
      '.mistake-card-grid', '.backup-export-grid', '.report-section-grid', '.import-count-grid',
      '.theme-choice-grid', '.syllabus-progress-strip', '.mock-score-grid', '.mock-detail-grid',
      '.test-detail-facts', '.form-grid.two', '.form-grid.three', '.settings-owner-fields',
      '.revision-two-column', '.untested-chip-row', '.focus-context-fields', '.skeleton-card-grid'
    ]
    for (const selector of intrinsic) {
      const escaped = selector.replace(/[.[\]>+]/g, character => `\\${character}`)
      const declaration = new RegExp(`${escaped} \\{[^}]*grid-template-columns: repeat\\(auto-fit, minmax\\(min\\(100%,`)
      expect(declaration.test(base), `${selector} should use auto-fit with a guarded minimum`).toBe(true)
    }
  })

  it('guards every fixed pixel minimum inside a grid track', () => {
    for (const { selector, value } of gridDeclarations(base)) {
      if (INTENTIONAL_FIXED_GRIDS.some(allowed => selector.includes(allowed))) continue
      for (const minimum of value.matchAll(/minmax\(\s*(\d+(?:\.\d+)?)px/g)) {
        throw new Error(`${selector} has an unguarded ${minimum[1]}px track: ${value}`)
      }
    }
  })

  it('wires the adaptive layer to real conditions instead of device names', () => {
    expect(responsive).toContain('@container topline')
    expect(responsive).toContain('@media (pointer: coarse)')
    expect(responsive).toContain('@media (max-height: 760px)')
    expect(responsive).toContain('@media (max-height: 600px)')
    expect(responsive).toContain('@media (orientation: landscape) and (max-height: 480px)')
    expect(responsive).toContain('scroll-margin-block')
    expect(base).toContain('container: topline / inline-size;')
    expect(base).toContain('container: clock / inline-size;')
  })

  it('routes fixed identity and selected content through the centralized role tokens', () => {
    const typography = read('typography.css')
    expect(base).toContain("--font-identity: 'Patrick Hand'")
    expect(base).toContain("--font-default-reading: 'Lexend'")
    expect(base).toContain('--font-body: var(--reading-font-family);')
    expect(base).toContain('--text-primary: var(--ink);')
    expect(base).toContain('--text-muted:')
    expect(base).toContain('--text-accent:')
    expect(typography).toContain('--body-scale')
    for (const role of ['brand', 'display', 'h1', 'h2', 'h3', 'empty', 'metric', 'body', 'nav', 'button', 'input', 'caption', 'overline', 'badge', 'table', 'alert']) {
      expect(typography).toContain(`.type-${role}`)
    }
    expect(base).toContain('body { min-width: 320px;')
    expect(base).toContain('font-family: inherit;')
    expect(base).toContain('#root { min-height: 100vh; min-height: 100dvh; font-family: inherit; }')
    expect(base).toContain('button, input, textarea, select { font: inherit; }')
    expect(base).toContain('option, optgroup, ::file-selector-button { font: inherit; }')
    expect(base).toContain('::placeholder { font: inherit; }')
    expect(responsive).not.toContain('data-font')
    expect(READING_FONTS).toHaveLength(4)
    expect(READING_FONT_OPTIONS.map(option => option.scale)).toEqual([1, 0.95, 0.97, 1])
  })

  it('prevents component CSS from introducing another UI font family', () => {
    // @font-face rules are the one sanctioned place that names a family (fonts.css
    // declares the self-hosted faces); scoped code samples intentionally use monospace.
    // Ordinary interface rules must use a centralized typography token.
    const withoutFontFaces = componentStyles.replace(/@font-face\s*\{[^}]*\}/g, '')
    const withoutCodeSamples = withoutFontFaces.replace(/(?:code,\s*pre,\s*samp,\s*\.mono,\s*\.ai-code-block|\.ai-code-block)\s*\{[^}]*\}/g, '')
    const allowedGlobalFamily = /^(?:inherit|var\(\s*--(?:reading-font-family|font-(?:identity|public|default-reading|ui|body|heading|label|number))\s*\))$/i
    const fontFamilyDeclarations = [...withoutCodeSamples.matchAll(/(?<![-\w])font-family\s*:\s*([^;}]+)/gi)]
    const nonGlobalFamilies = fontFamilyDeclarations
      .map(([, value]) => (value?.trim() ?? '').replace(/\s*!important$/i, ''))
      .filter(value => !allowedGlobalFamily.test(value))
    const fontShorthands = [...withoutCodeSamples.matchAll(/(?<![-\w])font\s*:\s*([^;}]+)/gi)]
    const unscopedShorthands = fontShorthands
      .map(([, value]) => value?.trim() ?? '')
      .filter(value => !/^(?:inherit|initial|unset|revert|revert-layer)$/i.test(value))
      .filter(value => !/\bvar\(\s*--(?:reading-font-family|font-(?:identity|public|default-reading|ui|body|heading|label|number))\b/i.test(value))
    const inlineFontAssignments = sourceFiles(sourceDir)
      .filter(file => /\.tsx?$/.test(file))
      .flatMap(file => [...readFileSync(file, 'utf8').matchAll(/\bfontFamily\s*:\s*([^,}\]]+)/g)])
      .map(([, value]) => value?.trim() ?? '')
    const unapprovedInlineFamilies = inlineFontAssignments.filter(value =>
      value !== 'option.stack' &&
      !/^['"]var\(\s*--(?:reading-font-family|font-(?:identity|public|default-reading|ui|body|heading|label|number))\s*\)['"]$/i.test(value))

    expect(nonGlobalFamilies).toEqual([])
    expect(unscopedShorthands).toEqual([])
    expect(unapprovedInlineFamilies).toEqual([])
    // Only font samples preview candidates; other inline families must use the global token.
    expect(inlineFontAssignments.filter(value => value === 'option.stack')).toHaveLength(2)
  })

  it('keeps exported documents decoupled from the interface font preference', () => {
    expect(report).not.toMatch(/interface_font|data-font|--font-ui|font-body/)
    expect(report).toContain("doc.setFont('helvetica'")
    expect(report).toContain("font: options.font ?? 'Aptos'")
  })
})
