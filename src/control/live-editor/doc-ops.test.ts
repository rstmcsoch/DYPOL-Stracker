import { describe, expect, it } from 'vitest'
import { checkSiteDocument } from '../../lib/site-editor/validate'
import {
  clearStyles, compactDocument, createBlock, deleteBlock, duplicateBlock, findBlock, insertBlock, insertionPoint, moveBlock, moveBy,
  normalizeDocument, pageBlocks, setPath, setProp, setStyle, updateBlock
} from './doc-ops'
import { propSpecAt, stripMarkers } from './registry-map'

const base = () => normalizeDocument(null)

describe('live editor document operations', () => {
  it('starts from the shipped layout and stores nothing until something changes', () => {
    const doc = base()
    expect(pageBlocks(doc, 'home').map(block => block.id)).toContain('home-hero')
    expect(compactDocument(doc)).toBeNull()
  })

  it('adds a block with mobile-first defaults that passes strict validation', () => {
    let doc = base()
    const block = createBlock(doc, 'home', 'columns')
    const point = insertionPoint(doc, 'home', null, block)
    doc = insertBlock(doc, 'home', block, point.parentId, point.index)!
    const located = findBlock(pageBlocks(doc, 'home'), block.id)!
    expect(located.block.children?.length).toBeGreaterThan(0)
    // Home keeps the final call to action last.
    expect(pageBlocks(doc, 'home').at(-1)?.id).toBe('home-final')
    const checked = checkSiteDocument(compactDocument(doc))
    expect(checked.problems).toEqual([])
  })

  it('per-device styles are stored separately and cleared per device', () => {
    let doc = base()
    const block = createBlock(doc, 'about', 'heading')
    doc = insertBlock(doc, 'about', block, null, 0)!
    doc = setStyle(doc, 'about', block.id, 'desktop', 'fontSize', '3rem')
    doc = setStyle(doc, 'about', block.id, 'tablet', 'fontSize', '2.25rem')
    doc = setStyle(doc, 'about', block.id, 'mobile', 'fontSize', '1.75rem')
    doc = setStyle(doc, 'about', block.id, 'mobile', 'display', 'hide')
    let stored = findBlock(pageBlocks(doc, 'about'), block.id)!.block
    expect(stored.style).toEqual({ fontSize: '3rem' })
    expect(stored.responsive).toEqual({ tablet: { fontSize: '2.25rem' }, mobile: { fontSize: '1.75rem', display: 'hide' } })
    expect(checkSiteDocument(compactDocument(doc)).problems).toEqual([])
    doc = setStyle(doc, 'about', block.id, 'tablet', 'fontSize', '')
    doc = clearStyles(doc, 'about', block.id, 'mobile')
    stored = findBlock(pageBlocks(doc, 'about'), block.id)!.block
    expect(stored.responsive).toBeUndefined()
    expect(stored.style).toEqual({ fontSize: '3rem' })
  })

  it('moves blocks within and between containers, never into themselves', () => {
    let doc = base()
    const columns = createBlock(doc, 'terms', 'columns')
    doc = insertBlock(doc, 'terms', columns, null, 0)!
    const text = createBlock(doc, 'terms', 'paragraph')
    doc = insertBlock(doc, 'terms', text, null, 1)!
    const firstColumn = columns.children![0]!
    const moved = moveBlock(doc, 'terms', text.id, firstColumn.id, 0)!
    expect(findBlock(pageBlocks(moved, 'terms'), text.id)!.parentId).toBe(firstColumn.id)
    expect(moveBlock(doc, 'terms', columns.id, firstColumn.id, 0)).toBeNull()
    // Stracker sections stay at the top level.
    expect(moveBlock(doc, 'terms', 'terms-doc', columns.id, 0)).toBeNull()
    const down = moveBy(doc, 'terms', columns.id, 1)!
    expect(pageBlocks(down, 'terms')[1]!.id).toBe(columns.id)
  })

  it('duplicates with new ids and refuses to delete Stracker sections or locked blocks', () => {
    let doc = base()
    const card = createBlock(doc, 'contact', 'card')
    doc = insertBlock(doc, 'contact', card, null, 0)!
    const copy = duplicateBlock(doc, 'contact', card.id)!
    expect(copy.id).not.toBe(card.id)
    expect(pageBlocks(copy.document, 'contact').filter(block => block.type === 'card')).toHaveLength(2)
    expect(deleteBlock(doc, 'contact', 'contact-form')).toBeNull()
    expect(duplicateBlock(doc, 'contact', 'contact-form')).toBeNull()
    const locked = updateBlock(doc, 'contact', card.id, block => ({ ...block, locked: true }))
    expect(deleteBlock(locked, 'contact', card.id)).toBeNull()
    expect(pageBlocks(deleteBlock(doc, 'contact', card.id)!, 'contact').some(block => block.id === card.id)).toBe(false)
  })

  it('a button group only accepts buttons', () => {
    let doc = base()
    const group = createBlock(doc, 'about', 'button-group')
    doc = insertBlock(doc, 'about', group, null, 0)!
    expect(insertBlock(doc, 'about', createBlock(doc, 'about', 'heading'), group.id, 0)).toBeNull()
    expect(insertBlock(doc, 'about', createBlock(doc, 'about', 'button'), group.id, 0)).not.toBeNull()
  })

  it('edits nested prop paths immutably', () => {
    const before = { items: [{ title: 'A' }, { title: 'B' }] }
    const after = setPath(before, 'items.1.title', 'C') as typeof before
    expect(after.items[1]!.title).toBe('C')
    expect(before.items[1]!.title).toBe('B')
    let doc = base()
    const heading = createBlock(doc, 'about', 'heading')
    doc = insertBlock(doc, 'about', heading, null, 0)!
    doc = setProp(doc, 'about', heading.id, 'text', 'Hello')
    expect(findBlock(pageBlocks(doc, 'about'), heading.id)!.block.props!.text).toBe('Hello')
  })

  it('knows which inline-edited props keep formatting', () => {
    const doc = base()
    const exams = pageBlocks(doc, 'home').find(block => block.type === 'stracker.loop')!
    expect(propSpecAt(exams, 'steps.0.body')?.k).toBe('rich')
    expect(propSpecAt(exams, 'steps.0.step')?.k).toBe('text')
    expect(stripMarkers('**Bold** and *it* __u__')).toBe('Bold and it u')
  })
})
