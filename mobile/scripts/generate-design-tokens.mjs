#!/usr/bin/env node
/**
 * Generates `src/theme/design-tokens.generated.ts` from the website's stylesheets.
 *
 * The website is the design source of truth. Its palettes are CSS custom properties
 * with `color-mix()` derivations, which React Native cannot evaluate, so this script
 * resolves them exactly as a browser would:
 *   1. Parse top-level rules in cascade order (base.css → themes.css → typography.css).
 *   2. For each display mode and colour theme, apply every matching declaration in
 *      specificity/source order, so `:root[data-color][data-theme='dark']` beats
 *      `:root[data-theme='dark']`, and so on.
 *   3. Resolve `var(--token)` against the final cascaded map, then evaluate
 *      `color-mix(in srgb, …)` in premultiplied sRGB, as CSS Color 5 specifies.
 *
 * Run `npm run tokens:generate` after changing the website palettes. `npm run tokens:check`
 * fails if the committed output no longer matches the website sources.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const websiteRoot = resolve(here, '../..')
const styleDir = resolve(websiteRoot, 'src/styles')
const typesFile = resolve(websiteRoot, 'src/types/index.ts')
const outFile = resolve(here, '../src/theme/design-tokens.generated.ts')
const CASCADE = ['base.css', 'themes.css', 'typography.css']

const checkOnly = process.argv.includes('--check')

function readSource(name) {
  const path = resolve(styleDir, name)
  if (!existsSync(path)) throw new Error(`Missing website stylesheet: ${path}`)
  return readFileSync(path, 'utf8')
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

/** Walks top-level rules only (at-rules and nested blocks are skipped on purpose). */
function parseTopLevelRules(css, order) {
  const text = stripComments(css)
  const rules = []
  let depth = 0
  let selectorStart = 0
  let bodyStart = -1
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') {
      if (depth === 0) {
        const selector = text.slice(selectorStart, index).trim()
        bodyStart = index + 1
        rules.push({ selector, body: null, order: order * 100000 + rules.length, start: bodyStart })
      }
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        const rule = rules[rules.length - 1]
        rule.body = text.slice(rule.start, index)
        selectorStart = index + 1
      }
    }
  }
  return rules.filter(rule => rule.body !== null && !rule.selector.startsWith('@'))
}

/** Maps a root-only selector to its cascade metadata, or null for non-token rules. */
function describeSelector(selector) {
  const compact = selector.replace(/\s+/g, '')
  const match = /^:root(\[data-color='([a-z0-9-]+)'\])?(\[data-theme='dark'\])?$/.exec(compact)
  if (!match) return null
  const color = match[2] ?? null
  const dark = Boolean(match[3])
  const specificity = 1 + (color ? 1 : 0) + (dark ? 1 : 0)
  return { color, dark, specificity }
}

function parseDeclarations(body) {
  const declarations = []
  let depth = 0
  let current = ''
  for (const char of body) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ';' && depth === 0) {
      declarations.push(current)
      current = ''
    } else current += char
  }
  if (current.trim()) declarations.push(current)
  const parsed = []
  for (const declaration of declarations) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const name = declaration.slice(0, colon).trim()
    if (!name.startsWith('--')) continue
    parsed.push([name.slice(2), declaration.slice(colon + 1).trim()])
  }
  return parsed
}

// ---------------------------------------------------------------- colour maths

const NAMED = { transparent: [0, 0, 0, 0], white: [255, 255, 255, 1], black: [0, 0, 0, 1] }

function parseColor(text) {
  const value = text.trim().toLowerCase()
  if (NAMED[value]) return NAMED[value]
  let match = /^#([0-9a-f]{3,8})$/.exec(value)
  if (match) {
    let hex = match[1]
    if (hex.length === 3 || hex.length === 4) hex = hex.split('').map(char => char + char).join('')
    if (hex.length !== 6 && hex.length !== 8) return null
    const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16))
    const alpha = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    return [...channels, alpha]
  }
  match = /^rgba?\((.*)\)$/.exec(value)
  if (match) {
    const parts = match[1].split(/[\s,/]+/).filter(Boolean)
    if (parts.length < 3) return null
    const channels = parts.slice(0, 3).map(part => Number(part))
    const alphaPart = parts[3]
    const alpha = alphaPart === undefined ? 1 : alphaPart.endsWith('%') ? Number(alphaPart.slice(0, -1)) / 100 : Number(alphaPart)
    if ([...channels, alpha].some(Number.isNaN)) return null
    return [...channels, alpha]
  }
  return null
}

function formatColor([r, g, b, a]) {
  const channels = [r, g, b].map(channel => Math.min(255, Math.max(0, Math.round(channel))))
  if (Math.abs(a - 1) < 1e-9) {
    return `#${channels.map(channel => channel.toString(16).padStart(2, '0')).join('')}`
  }
  const alpha = Math.round(a * 10000) / 10000
  return `rgba(${channels.join(', ')}, ${alpha})`
}

/** color-mix(in srgb, A p%, B q%) with premultiplied interpolation (CSS Color 5). */
function mixColors(argsText) {
  const parts = splitTopLevel(argsText)
  if (parts.length !== 3 || !/^in\s+srgb$/.test(parts[0].trim())) {
    throw new Error(`Unsupported color-mix arguments: ${argsText}`)
  }
  const operands = parts.slice(1).map(part => {
    const percentMatch = /^(.*?)\s+([\d.]+)%$/.exec(part.trim())
    const colorText = percentMatch ? percentMatch[1] : part.trim()
    const percent = percentMatch ? Number(percentMatch[2]) : null
    const color = parseColor(colorText)
    if (!color) throw new Error(`Unsupported colour inside color-mix: ${colorText}`)
    return { color, percent }
  })
  let [first, second] = operands
  let p1 = first.percent
  let p2 = second.percent
  if (p1 === null && p2 === null) { p1 = 50; p2 = 50 }
  else if (p1 === null) p1 = 100 - p2
  else if (p2 === null) p2 = 100 - p1
  const sum = p1 + p2
  const alphaMultiplier = sum < 100 ? sum / 100 : 1
  const f1 = p1 / sum
  const f2 = p2 / sum
  const [r1, g1, b1, a1] = first.color
  const [r2, g2, b2, a2] = second.color
  const alpha = f1 * a1 + f2 * a2
  if (alpha <= 0) return [0, 0, 0, 0]
  const channel = (c1, c2) => (f1 * a1 * c1 + f2 * a2 * c2) / alpha
  return [channel(r1, r2), channel(g1, g2), channel(b1, b2), alpha * alphaMultiplier]
}

function splitTopLevel(text) {
  const parts = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (char === '(') depth += 1
    if (char === ')') depth -= 1
    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else current += char
  }
  parts.push(current)
  return parts
}

/** Finds `name(` ... matching `)` at or after `from`; returns indexes and the inner text. */
function findCall(text, name, from = 0) {
  const start = text.indexOf(`${name}(`, from)
  if (start < 0) return null
  let depth = 0
  for (let index = start + name.length; index < text.length; index += 1) {
    if (text[index] === '(') depth += 1
    if (text[index] === ')') {
      depth -= 1
      if (depth === 0) return { start, end: index + 1, inner: text.slice(start + name.length + 1, index) }
    }
  }
  throw new Error(`Unbalanced ${name}( in: ${text}`)
}

function resolveTokenValue(name, cascade, trail = []) {
  if (trail.includes(name)) throw new Error(`Cyclic token reference: ${[...trail, name].join(' -> ')}`)
  const raw = cascade.get(name)
  if (raw === undefined) return null
  return resolveExpression(raw, cascade, [...trail, name])
}

function resolveExpression(text, cascade, trail) {
  let value = text
  // var(--name) and var(--name, fallback), innermost first.
  for (let call = findCall(value, 'var'); call; call = findCall(value, 'var')) {
    const [nameText, ...fallbackParts] = splitTopLevel(call.inner)
    const name = nameText.trim().replace(/^--/, '')
    const resolved = resolveTokenValue(name, cascade, trail)
    const replacement = resolved ?? (fallbackParts.length ? fallbackParts.join(',').trim() : null)
    if (replacement === null) throw new Error(`Unresolved var(--${name}) in ${text}`)
    value = value.slice(0, call.start) + replacement + value.slice(call.end)
  }
  for (let call = findCall(value, 'color-mix'); call; call = findCall(value, 'color-mix')) {
    const formatted = formatColor(mixColors(call.inner))
    value = value.slice(0, call.start) + formatted + value.slice(call.end)
  }
  return value.trim()
}

// ---------------------------------------------------------------- generation

function themesFromTypes() {
  const source = readFileSync(typesFile, 'utf8')
  const match = /export const COLOR_THEMES = \[([\s\S]*?)\] as const/.exec(source)
  if (!match) throw new Error('COLOR_THEMES not found in src/types/index.ts')
  return [...match[1].matchAll(/'([a-z0-9-]+)'/g)].map(item => item[1])
}

function buildTokens() {
  const rules = []
  const sourceHashes = {}
  CASCADE.forEach((file, order) => {
    const css = readSource(file)
    sourceHashes[file] = createHash('sha256').update(css).digest('hex')
    for (const rule of parseTopLevelRules(css, order)) {
      const meta = describeSelector(rule.selector)
      if (!meta) continue
      rules.push({ ...meta, order: rule.order, declarations: parseDeclarations(rule.body) })
    }
  })
  const themes = themesFromTypes()
  const output = { light: {}, dark: {} }
  for (const mode of ['light', 'dark']) {
    for (const theme of themes) {
      // A rule applies when its mode and palette conditions hold; cascade order is then
      // specificity first, source order second, exactly as the browser sorts them.
      const applicable = rules
        .filter(rule => (!rule.dark || mode === 'dark') && (!rule.color || rule.color === theme))
        .sort((a, b) => a.specificity - b.specificity || a.order - b.order)
      const cascade = new Map()
      for (const rule of applicable) for (const [name, value] of rule.declarations) cascade.set(name, value)
      const tokens = {}
      for (const name of cascade.keys()) {
        const resolved = resolveTokenValue(name, cascade)
        if (resolved === null) continue
        const colour = parseColor(resolved)
        tokens[name] = colour && !/^(var|color-mix)\(/.test(resolved) && /^(#|rgba?\(|transparent|white|black)/i.test(resolved)
          ? formatColor(colour)
          : resolved.replace(/\s+/g, ' ')
      }
      output[mode][theme] = tokens
    }
  }
  return { output, themes, sourceHashes }
}

function render({ output, themes, sourceHashes }) {
  const names = Object.keys(output.light.default).sort()
  const lines = []
  lines.push('/* eslint-disable */')
  lines.push('// GENERATED FILE. Do not edit by hand.')
  lines.push('// Source: website src/styles/{base,themes,typography}.css via mobile/scripts/generate-design-tokens.mjs.')
  lines.push('// Regenerate with `npm run tokens:generate`; `npm run tokens:check` fails on drift.')
  lines.push('')
  lines.push(`export const DESIGN_TOKEN_SOURCE_HASHES = ${JSON.stringify(sourceHashes, null, 2)} as const`)
  lines.push('')
  lines.push(`export const COLOR_THEME_IDS = ${JSON.stringify(themes)} as const`)
  lines.push('')
  lines.push('export type ColorThemeId = (typeof COLOR_THEME_IDS)[number]')
  lines.push('export type DesignTokenName = ' + names.map(name => `'${name}'`).join(' | '))
  lines.push('export type DesignTokenMap = Readonly<Record<DesignTokenName, string>>')
  lines.push('')
  lines.push("/** Token tables keyed by display mode, then by colour theme (`default` is the base palette). */")
  lines.push('export const DESIGN_TOKENS: Readonly<Record<\'light\' | \'dark\', Readonly<Record<ColorThemeId, DesignTokenMap>>>> = {')
  for (const mode of ['light', 'dark']) {
    lines.push(`  ${mode}: {`)
    for (const theme of themes) {
      const tokens = output[mode][theme]
      const missing = names.filter(name => tokens[name] === undefined)
      if (missing.length) throw new Error(`${mode}/${theme} is missing tokens: ${missing.join(', ')}`)
      lines.push(`    '${theme}': {`)
      for (const name of names) lines.push(`      '${name}': ${JSON.stringify(tokens[name])},`)
      lines.push('    },')
    }
    lines.push('  },')
  }
  lines.push('} as const')
  lines.push('')
  return lines.join('\n')
}

const result = buildTokens()
const rendered = render(result)
if (checkOnly) {
  const current = existsSync(outFile) ? readFileSync(outFile, 'utf8') : ''
  if (current !== rendered) {
    console.error('design tokens are out of date. Run `npm run tokens:generate` in mobile/.')
    process.exit(1)
  }
  console.log('design tokens match the website stylesheets.')
} else {
  writeFileSync(outFile, rendered)
  console.log(`wrote ${outFile}`)
}
