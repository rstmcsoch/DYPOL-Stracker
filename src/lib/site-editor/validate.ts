import { validateLink } from '../site-content/content.js'
import { isUploadedMediaUrl } from '../site-content/media.js'
import {
  BLOCK_SPECS, BUILTIN_PROP_SPECS, CHART_COLORS, CHART_KINDS, CHART_LIMITS, TABLE_LIMITS, VALUE_FORMATS, type PropSpec
} from './blocks-spec.js'
import {
  BUILTIN_SECTIONS, SITE_DOCUMENT_SCHEMA_VERSION, SITE_PAGE_IDS, isBuiltinType, resolvePage,
  type BlockStyle, type SiteBlock, type SiteDocument, type SitePageId
} from './model.js'
import { DESIGN_TOKENS, STYLE_PROP_MAP, checkStyleValue, checkTokenValue } from './styles-spec.js'

/**
 * Validation of the Live Site Editor document.
 *
 * `checkSiteDocument` walks the whole document once and returns both a cleaned copy and the
 * list of problems. Owner writes (draft save, publish) are STRICT: any problem rejects the
 * write with a path-level message. Rendering is LENIENT: it uses the cleaned copy, where an
 * invalid prop, style or block is dropped on its own so one bad value can never blank a page.
 *
 * Safety rules enforced here (in addition to React's escaping when rendering):
 *   - only registered block types, props and style properties; no HTML, CSS or script;
 *   - text is plain (angle brackets and control characters rejected); "rich" text is plain
 *     text with **bold**, *italic* and __underline__ markers, parsed into React elements;
 *   - links: public pages, homepage or in-page anchors, mailto with one address, or https;
 *   - media: only objects this site uploaded to its own `homepage-media` bucket;
 *   - ids are unique per page; size, depth and count limits keep documents small.
 */

export const DOCUMENT_LIMITS = { blocksPerPage: 300, depth: 6, bytes: 250_000, nameLength: 60 } as const

const ID = /^[a-z][a-z0-9-]{0,47}$/
const ANCHOR_LINK = /^#[a-z][a-z0-9-]{0,39}$/

export interface DocumentProblem { path: string; message: string }
export interface DocumentCheck { document: SiteDocument; problems: DocumentProblem[] }

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0
    if ((code < 0x20 && code !== 0x0a) || code === 0x7f) return true
  }
  return false
}

const isImage = (value: string) => isUploadedMediaUrl('image', value)

function checkText(value: unknown, max: number, optional: boolean, multiline: boolean): { ok: true; value: string } | { ok: false; message: string } {
  if (typeof value !== 'string') return { ok: false, message: 'Enter text.' }
  let text = value.replace(/\r\n?/g, '\n')
  if (!multiline) text = text.replace(/\s*\n\s*/g, ' ')
  text = text.trim()
  if (!text && !optional) return { ok: false, message: 'This cannot be empty.' }
  if (text.length > max) return { ok: false, message: `Use ${max} characters or fewer.` }
  if (hasControlCharacter(text)) return { ok: false, message: 'Remove hidden control characters.' }
  if (/[<>]/.test(text)) return { ok: false, message: 'Angle brackets (< >) are not allowed. Write plain text.' }
  return { ok: true, value: text }
}

export function checkBlockLink(value: string, optional = false): string | null {
  if (!value) return optional ? null : 'Choose where this goes.'
  if (ANCHOR_LINK.test(value)) return null
  if (/^javascript:|^data:|^vbscript:/i.test(value.trim())) return 'This kind of link is not allowed.'
  return validateLink(value, true)
}

type PropResult = { ok: true; value: unknown } | { ok: false; message: string }

function checkTable(raw: unknown): PropResult {
  if (!isRecord(raw)) return { ok: false, message: 'The table is malformed.' }
  const columns = Array.isArray(raw.columns) ? raw.columns : null
  const rows = Array.isArray(raw.rows) ? raw.rows : null
  if (!columns || columns.length < 1 || columns.length > TABLE_LIMITS.columns) return { ok: false, message: `Use 1–${TABLE_LIMITS.columns} columns.` }
  if (!rows || rows.length > TABLE_LIMITS.rows) return { ok: false, message: `Use up to ${TABLE_LIMITS.rows} rows.` }
  const cleanColumns = []
  for (const column of columns) {
    if (!isRecord(column)) return { ok: false, message: 'A column is malformed.' }
    const label = checkText(column.label ?? '', 80, true, false)
    if (!label.ok) return { ok: false, message: `Column heading: ${label.message}` }
    const align = ['left', 'center', 'right'].includes(String(column.align)) ? String(column.align) : 'left'
    const width = ['auto', 'narrow', 'medium', 'wide'].includes(String(column.width)) ? String(column.width) : 'auto'
    cleanColumns.push({ label: label.value, align, width, hidden: column.hidden === true })
  }
  const cleanRows: string[][] = []
  for (const row of rows) {
    if (!Array.isArray(row)) return { ok: false, message: 'A row is malformed.' }
    const cells: string[] = []
    for (let index = 0; index < cleanColumns.length; index += 1) {
      const cell = checkText(row[index] ?? '', TABLE_LIMITS.cell, true, true)
      if (!cell.ok) return { ok: false, message: `Cell: ${cell.message}` }
      cells.push(cell.value)
    }
    cleanRows.push(cells)
  }
  const caption = checkText(raw.caption ?? '', 160, true, false)
  if (!caption.ok) return { ok: false, message: `Caption: ${caption.message}` }
  const padding = ['sm', 'md', 'lg'].includes(String(raw.padding)) ? String(raw.padding) : 'md'
  return { ok: true, value: { caption: caption.value, header: raw.header !== false, striped: raw.striped === true, bordered: raw.bordered !== false, scroll: raw.scroll !== false, padding, columns: cleanColumns, rows: cleanRows } }
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value
  return typeof number === 'number' && Number.isFinite(number) && Math.abs(number) < 1e12 ? number : null
}

function checkChart(raw: unknown): PropResult {
  if (!isRecord(raw)) return { ok: false, message: 'The chart is malformed.' }
  const kind = (CHART_KINDS as readonly string[]).includes(String(raw.kind)) ? String(raw.kind) : null
  if (!kind) return { ok: false, message: 'Choose a chart type.' }
  const labels = Array.isArray(raw.labels) ? raw.labels : null
  if (!labels || labels.length < 1 || labels.length > CHART_LIMITS.labels) return { ok: false, message: `Use 1–${CHART_LIMITS.labels} data points.` }
  const cleanLabels: string[] = []
  for (const label of labels) {
    const checked = checkText(label, CHART_LIMITS.label, true, false)
    if (!checked.ok) return { ok: false, message: `Label: ${checked.message}` }
    cleanLabels.push(checked.value)
  }
  const series = Array.isArray(raw.series) ? raw.series : null
  if (!series || series.length < 1 || series.length > CHART_LIMITS.series) return { ok: false, message: `Use 1–${CHART_LIMITS.series} series.` }
  const cleanSeries = []
  for (const item of series) {
    if (!isRecord(item) || !Array.isArray(item.values)) return { ok: false, message: 'A series is malformed.' }
    const name = checkText(item.name ?? '', 40, true, false)
    if (!name.ok) return { ok: false, message: `Series name: ${name.message}` }
    const values: number[] = []
    for (let index = 0; index < cleanLabels.length; index += 1) {
      const number = finiteNumber(item.values[index] ?? 0)
      if (number === null) return { ok: false, message: 'Every value must be a number.' }
      values.push(number)
    }
    const color = (CHART_COLORS as readonly string[]).includes(String(item.color)) ? String(item.color) : 'accent'
    cleanSeries.push({ name: name.value, color, values })
  }
  const title = checkText(raw.title ?? '', 120, true, false)
  const xLabel = checkText(raw.xLabel ?? '', 60, true, false)
  const yLabel = checkText(raw.yLabel ?? '', 60, true, false)
  const unit = checkText(raw.unit ?? '', 8, true, false)
  for (const [field, result] of [['Title', title], ['Axis label', xLabel], ['Axis label', yLabel], ['Unit', unit]] as const) {
    if (!result.ok) return { ok: false, message: `${field}: ${result.message}` }
  }
  const height = Math.min(600, Math.max(140, Math.round(finiteNumber(raw.height) ?? 260)))
  const max = finiteNumber(raw.max)
  const format = (VALUE_FORMATS as readonly string[]).includes(String(raw.format)) ? String(raw.format) : 'number'
  return { ok: true, value: {
    kind, labels: cleanLabels, series: cleanSeries, legend: raw.legend !== false, height, format,
    title: title.ok ? title.value : '', xLabel: xLabel.ok ? xLabel.value : '', yLabel: yLabel.ok ? yLabel.value : '', unit: unit.ok ? unit.value : '',
    max: max !== null && max > 0 ? max : 100
  } }
}

export function checkProp(spec: PropSpec, raw: unknown): PropResult {
  switch (spec.k) {
    case 'text': return checkText(raw, spec.max, Boolean(spec.optional), false)
    case 'rich': return checkText(raw, spec.max, Boolean(spec.optional), true)
    case 'link': {
      if (typeof raw !== 'string') return { ok: false, message: 'Choose where this goes.' }
      const value = raw.trim()
      const problem = checkBlockLink(value, Boolean(spec.optional))
      return problem ? { ok: false, message: problem } : { ok: true, value }
    }
    case 'media': {
      if (typeof raw !== 'string') return { ok: false, message: 'Upload a file.' }
      const value = raw.trim()
      if (!value) return spec.optional ? { ok: true, value } : { ok: false, message: 'Upload a file.' }
      return isUploadedMediaUrl(spec.media, value) ? { ok: true, value } : { ok: false, message: 'Use a file uploaded here.' }
    }
    case 'select': return spec.options.includes(String(raw)) ? { ok: true, value: String(raw) } : { ok: false, message: 'Choose one of the options.' }
    case 'number': {
      const number = finiteNumber(raw)
      if (number === null || number < spec.min || number > spec.max) return { ok: false, message: `Use a number from ${spec.min} to ${spec.max}.` }
      if (spec.int && !Number.isInteger(number)) return { ok: false, message: 'Use a whole number.' }
      return { ok: true, value: number }
    }
    case 'bool': return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, message: 'Turn this on or off.' }
    case 'strings': {
      if (!Array.isArray(raw) || raw.length > spec.max) return { ok: false, message: `Use up to ${spec.max} items.` }
      const items: string[] = []
      for (const item of raw) {
        const checked = checkText(item, spec.itemMax, true, false)
        if (!checked.ok) return { ok: false, message: checked.message }
        if (checked.value) items.push(checked.value)
      }
      return { ok: true, value: items }
    }
    case 'list': {
      if (!Array.isArray(raw) || raw.length > spec.max) return { ok: false, message: `Use up to ${spec.max} items.` }
      const items: Array<Record<string, unknown>> = []
      for (const item of raw) {
        if (!isRecord(item)) return { ok: false, message: 'An item is malformed.' }
        const clean: Record<string, unknown> = {}
        for (const [key, itemSpec] of Object.entries(spec.item)) {
          const checked = checkProp(itemSpec, item[key] ?? (itemSpec.k === 'bool' ? false : ''))
          if (!checked.ok) return { ok: false, message: checked.message }
          clean[key] = checked.value
        }
        items.push(clean)
      }
      return { ok: true, value: items }
    }
    case 'table': return checkTable(raw)
    case 'chart': return checkChart(raw)
  }
}

function checkStyle(raw: unknown, path: string, problems: DocumentProblem[]): BlockStyle | undefined {
  if (raw === undefined) return undefined
  if (!isRecord(raw)) { problems.push({ path, message: 'Styles are malformed.' }); return undefined }
  const style: BlockStyle = {}
  for (const [key, value] of Object.entries(raw)) {
    const prop = STYLE_PROP_MAP[key]
    if (!prop) { problems.push({ path: `${path}.${key}`, message: 'This style cannot be edited.' }); continue }
    if (value === '' || value === undefined || value === null) continue
    const checked = checkStyleValue(prop, value, isImage)
    if (checked === null) { problems.push({ path: `${path}.${key}`, message: `${prop.label}: this value is not allowed.` }); continue }
    style[key] = checked
  }
  return Object.keys(style).length ? style : undefined
}

interface WalkState { page: SitePageId; ids: Set<string>; count: number; problems: DocumentProblem[] }

function checkBlock(raw: unknown, path: string, depth: number, state: WalkState): SiteBlock | null {
  const { problems } = state
  if (!isRecord(raw)) { problems.push({ path, message: 'A block is malformed.' }); return null }
  const id = typeof raw.id === 'string' ? raw.id : ''
  const type = typeof raw.type === 'string' ? raw.type : ''
  if (!ID.test(id)) { problems.push({ path, message: 'A block has an invalid id.' }); return null }
  if (state.ids.has(id)) { problems.push({ path, message: `Two blocks share the id “${id}”.` }); return null }
  state.count += 1
  if (state.count > DOCUMENT_LIMITS.blocksPerPage) { problems.push({ path, message: `A page can hold up to ${DOCUMENT_LIMITS.blocksPerPage} blocks.` }); return null }

  const builtin = isBuiltinType(type)
  if (builtin) {
    if (depth > 0 || !BUILTIN_SECTIONS[state.page].some(section => section.id === id && section.type === type)) {
      problems.push({ path, message: 'A Stracker section is in the wrong place.' }); return null
    }
  } else if (!BLOCK_SPECS[type]) {
    problems.push({ path, message: `“${type.slice(0, 40)}” is not a supported block.` }); return null
  }
  state.ids.add(id)

  const block: SiteBlock = { id, type }
  if (raw.name !== undefined) {
    const name = checkText(raw.name, DOCUMENT_LIMITS.nameLength, true, false)
    if (name.ok && name.value) block.name = name.value
    else if (!name.ok) problems.push({ path: `${path}.name`, message: `Layer name: ${name.message}` })
  }
  if (raw.hidden === true) block.hidden = true
  if (raw.locked === true) block.locked = true

  const specs = builtin ? BUILTIN_PROP_SPECS[type] ?? {} : (BLOCK_SPECS[type]?.props ?? {})
  if (raw.props !== undefined) {
    if (!isRecord(raw.props)) problems.push({ path: `${path}.props`, message: 'Properties are malformed.' })
    else {
      const props: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(raw.props)) {
        const spec = specs[key]
        if (!spec) { problems.push({ path: `${path}.props.${key}`, message: 'This property cannot be edited.' }); continue }
        const checked = checkProp(spec, value)
        if (!checked.ok) { problems.push({ path: `${path}.props.${key}`, message: checked.message }); continue }
        props[key] = checked.value
      }
      if (Object.keys(props).length) block.props = props
    }
  }
  const style = checkStyle(raw.style, `${path}.style`, problems)
  if (style) block.style = style
  if (raw.responsive !== undefined) {
    if (!isRecord(raw.responsive)) problems.push({ path: `${path}.responsive`, message: 'Device styles are malformed.' })
    else {
      const responsive: NonNullable<SiteBlock['responsive']> = {}
      for (const [device, value] of Object.entries(raw.responsive)) {
        if (device !== 'tablet' && device !== 'mobile') { problems.push({ path: `${path}.responsive.${device}`, message: 'Unknown device.' }); continue }
        const checked = checkStyle(value, `${path}.responsive.${device}`, problems)
        if (checked) responsive[device] = checked
      }
      if (Object.keys(responsive).length) block.responsive = responsive
    }
  }
  if (raw.children !== undefined) {
    const container = !builtin && Boolean(BLOCK_SPECS[type]?.container)
    if (!container || !Array.isArray(raw.children)) problems.push({ path: `${path}.children`, message: 'This block cannot hold other blocks.' })
    else if (depth + 1 >= DOCUMENT_LIMITS.depth) problems.push({ path: `${path}.children`, message: `Blocks can be nested up to ${DOCUMENT_LIMITS.depth} levels.` })
    else {
      const children = raw.children.map((child, index) => checkBlock(child, `${path}.children[${index}]`, depth + 1, state)).filter((child): child is SiteBlock => Boolean(child))
      block.children = children
    }
  }
  return block
}

/** Validates and cleans a whole document. See the module comment for strict vs lenient use. */
export function checkSiteDocument(raw: unknown): DocumentCheck {
  const problems: DocumentProblem[] = []
  const document: SiteDocument = { schemaVersion: SITE_DOCUMENT_SCHEMA_VERSION, pages: {} }
  if (!isRecord(raw)) return { document, problems: [{ path: 'document', message: 'The page document is malformed.' }] }
  if (raw.schemaVersion !== SITE_DOCUMENT_SCHEMA_VERSION) problems.push({ path: 'schemaVersion', message: 'Unsupported document version.' })
  let bytes = 0
  try { bytes = JSON.stringify(raw).length } catch { bytes = Infinity }
  if (bytes > DOCUMENT_LIMITS.bytes) return { document, problems: [{ path: 'document', message: 'The page document is too large.' }] }

  const pages = isRecord(raw.pages) ? raw.pages : {}
  if (!isRecord(raw.pages)) problems.push({ path: 'pages', message: 'Pages are malformed.' })
  for (const key of Object.keys(pages)) {
    if (!(SITE_PAGE_IDS as readonly string[]).includes(key)) { problems.push({ path: `pages.${key}`, message: 'Unknown page.' }); continue }
    const page = key as SitePageId
    const stored = pages[page]
    if (!isRecord(stored) || !Array.isArray(stored.blocks)) { problems.push({ path: `pages.${page}`, message: 'The page is malformed.' }); continue }
    const state: WalkState = { page, ids: new Set(), count: 0, problems }
    const blocks = stored.blocks.map((block, index) => checkBlock(block, `pages.${page}.blocks[${index}]`, 0, state)).filter((block): block is SiteBlock => Boolean(block))
    // Stracker sections can be hidden or moved, never removed: put back any that are missing.
    document.pages[page] = resolvePage({ pages: { [page]: { blocks } } }, page)
  }

  if (raw.tokens !== undefined) {
    if (!isRecord(raw.tokens)) problems.push({ path: 'tokens', message: 'Design tokens are malformed.' })
    else {
      const tokens: Record<string, string> = {}
      for (const [key, value] of Object.entries(raw.tokens)) {
        const [mode, name] = key.split(':')
        const token = DESIGN_TOKENS.find(item => item.key === name)
        if ((mode !== 'light' && mode !== 'dark') || !token) { problems.push({ path: `tokens.${key}`, message: 'Unknown design token.' }); continue }
        const checked = checkTokenValue(token.kind, value)
        if (checked === null) { problems.push({ path: `tokens.${key}`, message: `${token.label}: this value is not allowed.` }); continue }
        tokens[key] = checked
      }
      if (Object.keys(tokens).length) document.tokens = tokens
    }
  }
  return { document, problems }
}

/** Lenient: the cleaned document, or null when nothing usable is stored. */
export function sanitizeSiteDocument(raw: unknown): SiteDocument | null {
  if (raw === null || raw === undefined) return null
  return checkSiteDocument(raw).document
}

/** Collapses problems into a field → message map for API responses (first 30). */
export function problemsToErrors(problems: DocumentProblem[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const problem of problems.slice(0, 30)) errors[problem.path] = problem.message
  return errors
}
