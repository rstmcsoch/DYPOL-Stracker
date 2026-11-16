import { BLOCK_SPECS } from '../../lib/site-editor/blocks-spec'
import { BUILTIN_SECTIONS, isBuiltinType, type SiteBlock } from '../../lib/site-editor/model'
import type { CanvasMessage, CanvasState, Selection } from './protocol'

/**
 * Selection and inline-editing layer inside the canvas iframe. It uses a handful of
 * delegated listeners on the document (no per-element listeners), draws its outlines and
 * the contextual toolbar in fixed-position elements outside the page, and edits text in
 * place with contentEditable. Edits are sent to the editor, which owns the real state and
 * re-renders the page; the DOM is never treated as the source of truth.
 */

type Send = (message: CanvasMessage) => void

const MARKS: Record<string, string> = { STRONG: '**', B: '**', EM: '*', I: '*', U: '__' }

/** DOM text → plain text with the rich-text markers (**, *, __) and line breaks. */
export function serializeEditable(root: Node): string {
  let out = ''
  root.childNodes.forEach(node => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ''; return }
    if (!(node instanceof HTMLElement)) return
    if (node.tagName === 'BR') { out += '\n'; return }
    if (node.getAttribute('aria-hidden') === 'true' || node.tagName === 'svg') return
    const inner = serializeEditable(node)
    const mark = MARKS[node.tagName]
    if (mark && inner.trim()) { out += `${mark}${inner}${mark}`; return }
    if (node.tagName === 'DIV' || node.tagName === 'P') { out += (out && !out.endsWith('\n') ? '\n' : '') + inner; return }
    out += inner
  })
  return out
}

function findInTree(blocks: readonly SiteBlock[], id: string): SiteBlock | null {
  for (const block of blocks) {
    if (block.id === id) return block
    const hit = block.children ? findInTree(block.children, id) : null
    if (hit) return hit
  }
  return null
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag)
  node.className = className
  if (text) node.textContent = text
  return node
}

export interface CanvasOverlay { detach: () => void; refresh: (state: CanvasState) => void }

export function attachCanvasOverlay(send: Send, getState: () => CanvasState | null): CanvasOverlay {
  const hover = el('div', 'se-ov se-ov-hover')
  const selected = el('div', 'se-ov se-ov-selected')
  const label = el('div', 'se-ov-label')
  const toolbar = el('div', 'se-ov-toolbar')
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Selected element')
  document.body.append(hover, selected, label, toolbar)

  let editing: { node: HTMLElement; selection: Selection; key?: string; prop?: string; original: string } | null = null
  let hoverTarget: HTMLElement | null = null
  let frame = 0

  const state = () => getState()
  const editMode = () => state()?.mode === 'edit'

  const targetFor = (selection: Selection | null): HTMLElement | null => {
    if (!selection) return null
    const selector = selection.kind === 'block' ? `[data-sb="${CSS.escape(selection.id)}"]` : `[data-se-region="${selection.id}"]`
    return document.querySelector<HTMLElement>(selector)
  }

  const place = (box: HTMLElement, target: HTMLElement | null) => {
    if (!target) { box.style.display = 'none'; return null }
    const rect = target.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) { box.style.display = 'none'; return null }
    box.style.display = 'block'
    box.style.transform = `translate(${Math.round(rect.left)}px, ${Math.round(rect.top)}px)`
    box.style.width = `${Math.round(rect.width)}px`
    box.style.height = `${Math.round(rect.height)}px`
    return rect
  }

  const blockFor = (selection: Selection | null): SiteBlock | null => {
    const current = state()
    if (!current || selection?.kind !== 'block') return null
    return findInTree(current.document.pages[current.page]?.blocks ?? [], selection.id)
  }

  const buildToolbar = (selection: Selection | null) => {
    toolbar.replaceChildren()
    if (!selection || !editMode()) { toolbar.style.display = 'none'; return }
    const block = blockFor(selection)
    const builtin = block ? isBuiltinType(block.type) : true
    const actions: Array<[CanvasMessage & { type: 'se:action' } extends { action: infer A } ? A : never, string, string]> = []
    if (selection.kind === 'block') {
      actions.push(['parent', '⤴', 'Select parent'], ['up', '↑', 'Move up'], ['down', '↓', 'Move down'])
      if (!builtin) actions.push(['duplicate', '⧉', 'Duplicate'])
      actions.push(['hide', '◌', 'Hide'])
      if (!builtin && !block?.locked) actions.push(['delete', '🗑', 'Delete'])
    }
    for (const [action, icon, name] of actions) {
      const button = el('button', 'se-ov-btn', icon)
      button.type = 'button'
      button.title = name
      button.setAttribute('aria-label', name)
      button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); send({ type: 'se:action', action }) })
      toolbar.append(button)
    }
    toolbar.style.display = actions.length ? 'flex' : 'none'
  }

  const layout = () => {
    frame = 0
    const current = state()
    const selection = current?.selected ?? null
    const rect = place(selected, editMode() ? targetFor(selection) : null)
    place(hover, editMode() && hoverTarget && hoverTarget !== targetFor(selection) ? hoverTarget : null)
    if (rect && selection) {
      const block = blockFor(selection)
      label.textContent = selection.kind === 'region' ? (selection.id === 'header' ? 'Header' : 'Footer') : (block?.name || (block && (BLOCK_SPECS[block.type]?.label ?? BUILTIN_SECTIONS[getState()?.page ?? 'home'].find(section => section.id === block.id)?.label)) || block?.type || '')
      label.style.display = 'block'
      const top = rect.top > 30 ? rect.top - 26 : rect.top + 4
      label.style.transform = `translate(${Math.max(4, Math.round(rect.left))}px, ${Math.round(top)}px)`
      if (toolbar.style.display !== 'none') {
        const width = toolbar.offsetWidth || 220
        const left = Math.min(window.innerWidth - width - 6, Math.max(6, rect.right - width))
        const below = rect.bottom + 48 < window.innerHeight
        const y = rect.top > 52 && !(rect.top > window.innerHeight - 60) ? rect.top - 46 : below ? rect.bottom + 6 : Math.max(6, rect.top + 6)
        toolbar.style.transform = `translate(${Math.round(left)}px, ${Math.round(y)}px)`
      }
    } else {
      label.style.display = 'none'
      toolbar.style.display = 'none'
    }
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(layout) }

  const resolveTarget = (target: EventTarget | null) => {
    if (!(target instanceof Element)) return null
    const blockEl = target.closest<HTMLElement>('[data-sb]')
    const regionEl = target.closest<HTMLElement>('[data-se-region]')
    const textEl = target.closest<HTMLElement>('[data-se-key], [data-se-prop]')
    let selection: Selection | null = null
    let node: HTMLElement | null = null
    if (blockEl && (!regionEl || regionEl.contains(blockEl))) { selection = { kind: 'block', id: blockEl.dataset.sb! }; node = blockEl }
    else if (regionEl) { selection = { kind: 'region', id: regionEl.dataset.seRegion as 'header' | 'footer' }; node = regionEl }
    if (!selection || !node) return null
    const textInside = textEl && node.contains(textEl) && textEl.closest('[data-sb], [data-se-region]') === node ? textEl : null
    return { selection, node, textEl: textInside, key: textInside?.dataset.seKey, prop: textInside?.dataset.seProp }
  }

  const sameSelection = (a: Selection | null, b: Selection | null) => Boolean(a && b && a.kind === b.kind && a.id === b.id)

  const startEditing = (node: HTMLElement, selection: Selection, key?: string, prop?: string) => {
    if (editing) return
    const block = blockFor(selection)
    if (block?.locked) return
    editing = { node, selection, key, prop, original: serializeEditable(node) }
    node.contentEditable = 'true'
    node.classList.add('se-editing')
    node.focus()
    const range = document.createRange()
    range.selectNodeContents(node)
    const sel = window.getSelection()
    sel?.removeAllRanges()
    sel?.addRange(range)
  }

  const finishEditing = (commit: boolean) => {
    if (!editing) return
    const { node, selection, key, prop, original } = editing
    editing = null
    node.contentEditable = 'false'
    node.removeAttribute('contenteditable')
    node.classList.remove('se-editing')
    const value = commit ? serializeEditable(node) : original
    send({ type: 'se:text', selection, key, prop, value })
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!editMode() || event.pointerType === 'touch') return
    const hit = resolveTarget(event.target)
    hoverTarget = hit?.node ?? null
    schedule()
  }

  const onClick = (event: MouseEvent) => {
    const target = event.target as Element | null
    if (target?.closest('.se-ov-toolbar')) return
    if (!editMode()) {
      const anchor = target?.closest('a')
      const href = anchor?.getAttribute('href') ?? ''
      const pages: Record<string, 'home' | 'privacy' | 'terms' | 'about' | 'contact'> = { '/': 'home', '/privacy': 'privacy', '/terms': 'terms', '/about': 'about', '/contact': 'contact' }
      if (anchor && pages[href.split('#')[0] ?? '']) { event.preventDefault(); send({ type: 'se:page', page: pages[href.split('#')[0]!]! }) }
      else if (anchor && href.startsWith('/')) { event.preventDefault(); window.open(href, '_blank', 'noopener') }
      return
    }
    if (editing && editing.node.contains(target)) return
    event.preventDefault()
    event.stopPropagation()
    if (editing) finishEditing(true)
    const hit = resolveTarget(target)
    const current = state()
    if (hit && hit.textEl && sameSelection(current?.selected ?? null, hit.selection)) {
      startEditing(hit.textEl, hit.selection, hit.key, hit.prop)
      return
    }
    send({ type: 'se:select', selection: hit?.selection ?? null, key: hit?.key, prop: hit?.prop })
  }

  const onDoubleClick = (event: MouseEvent) => {
    if (!editMode()) return
    const hit = resolveTarget(event.target)
    if (hit?.textEl) { event.preventDefault(); startEditing(hit.textEl, hit.selection, hit.key, hit.prop) }
  }

  const onKeyDown = (event: KeyboardEvent) => {
    if (editing) {
      if (event.key === 'Escape') { event.preventDefault(); finishEditing(false) }
      else if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); finishEditing(true) }
      return
    }
    if (!editMode()) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key.toLowerCase()
    if (mod && key === 'z') { event.preventDefault(); send({ type: 'se:shortcut', action: event.shiftKey ? 'redo' : 'undo' }) }
    else if (mod && key === 'y') { event.preventDefault(); send({ type: 'se:shortcut', action: 'redo' }) }
    else if (mod && key === 's') { event.preventDefault(); send({ type: 'se:shortcut', action: 'save' }) }
    else if (mod && key === 'd') { event.preventDefault(); send({ type: 'se:shortcut', action: 'duplicate' }) }
    else if (key === 'delete' || key === 'backspace') { event.preventDefault(); send({ type: 'se:shortcut', action: 'delete' }) }
    else if (key === 'escape') send({ type: 'se:shortcut', action: 'escape' })
    else if (key === 'enter') {
      const current = state()
      const node = targetFor(current?.selected ?? null)
      const text = node?.matches('[data-se-key], [data-se-prop]') ? node : node?.querySelector<HTMLElement>('[data-se-key], [data-se-prop]')
      if (text && current?.selected) { event.preventDefault(); startEditing(text, current.selected, text.dataset.seKey, text.dataset.seProp) }
    }
  }

  const onPaste = (event: ClipboardEvent) => {
    if (!editing) return
    event.preventDefault()
    const text = event.clipboardData?.getData('text/plain') ?? ''
    document.execCommand('insertText', false, text.replace(/[<>]/g, ''))
  }

  const onBlur = (event: FocusEvent) => {
    if (editing && event.target === editing.node) finishEditing(true)
  }

  const blockForm = (event: Event) => { if (editMode()) event.preventDefault() }

  document.addEventListener('pointermove', onPointerMove, { passive: true })
  document.addEventListener('click', onClick, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('paste', onPaste, true)
  document.addEventListener('focusout', onBlur, true)
  document.addEventListener('submit', blockForm, true)
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  window.addEventListener('resize', schedule)
  const observer = new ResizeObserver(schedule)
  observer.observe(document.body)

  const detach = () => {
    document.removeEventListener('pointermove', onPointerMove)
    document.removeEventListener('click', onClick, true)
    document.removeEventListener('dblclick', onDoubleClick, true)
    document.removeEventListener('keydown', onKeyDown, true)
    document.removeEventListener('paste', onPaste, true)
    document.removeEventListener('focusout', onBlur, true)
    document.removeEventListener('submit', blockForm, true)
    window.removeEventListener('scroll', schedule, { capture: true })
    window.removeEventListener('resize', schedule)
    observer.disconnect()
    if (frame) cancelAnimationFrame(frame)
    hover.remove(); selected.remove(); label.remove(); toolbar.remove()
  }

  const refresh = (next: CanvasState) => {
    if (editing && !document.contains(editing.node)) editing = null
    buildToolbar(next.selected)
    schedule()
    if (next.scrollTo) {
      const target = targetFor(next.selected)
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    }
  }

  return { detach, refresh }
}

export { type Selection }
