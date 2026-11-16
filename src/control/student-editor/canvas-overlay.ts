import { COMPONENT_MAP } from '../../lib/student-layout/registry'
import type { StudentCanvasMessage, StudentCanvasState } from './protocol'

/**
 * Selection layer for the Student Dashboard Editor canvas. In edit mode clicks select the
 * nearest registered component instead of running its action, double-click edits a static
 * label in place, and data-bound values refuse editing with a visible lock message.
 * In preview mode it stays out of the way so the synthetic page works normally.
 */

export interface StudentOverlay { refresh: (state: StudentCanvasState) => void; detach: () => void }

const LOCK_TEXT = '🔒 Live student data, not editable'

function box(className: string): HTMLDivElement {
  const element = document.createElement('div')
  element.className = className
  element.setAttribute('aria-hidden', 'true')
  document.body.appendChild(element)
  return element
}

function place(element: HTMLElement, target: Element | null) {
  if (!target) { element.style.display = 'none'; return }
  const rect = target.getBoundingClientRect()
  if (!rect.width && !rect.height) { element.style.display = 'none'; return }
  Object.assign(element.style, { display: 'block', transform: `translate(${rect.left}px, ${rect.top}px)`, width: `${rect.width}px`, height: `${rect.height}px` })
}

const find = (id: string | null) => (id ? document.querySelector(`[data-sl="${CSS.escape(id)}"]`) : null)

export function attachStudentOverlay(send: (message: StudentCanvasMessage) => void, current: () => StudentCanvasState | null): StudentOverlay {
  const hover = box('sl-ov sl-ov-hover')
  const selected = box('sl-ov sl-ov-selected')
  const label = box('sl-ov-label')
  const tip = box('sl-ov-tip')
  const toolbar = document.createElement('div')
  toolbar.className = 'sl-ov-toolbar'
  toolbar.setAttribute('role', 'toolbar')
  toolbar.setAttribute('aria-label', 'Selected component')
  const buttons: Array<[StudentCanvasMessage & { type: 'sl:action' }, string, string]> = [
    [{ type: 'sl:action', action: 'parent' }, '↖', 'Select parent'],
    [{ type: 'sl:action', action: 'up' }, '↑', 'Move up'],
    [{ type: 'sl:action', action: 'down' }, '↓', 'Move down'],
    [{ type: 'sl:action', action: 'hide' }, '◐', 'Hide or show']
  ]
  const buttonEls = buttons.map(([message, glyph, title]) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'sl-ov-btn'
    button.textContent = glyph
    button.title = title
    button.setAttribute('aria-label', title)
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); send(message) })
    toolbar.appendChild(button)
    return { button, action: message.action }
  })
  document.body.appendChild(toolbar)
  const badge = document.createElement('div')
  badge.className = 'sl-badge'
  badge.textContent = 'SYNTHETIC STUDENT PREVIEW'
  document.body.appendChild(badge)

  let hoverTarget: Element | null = null
  let editing: HTMLElement | null = null
  let tipTimer = 0
  const editMode = () => current()?.mode === 'edit'

  const showTip = (text: string, target: Element) => {
    const rect = target.getBoundingClientRect()
    tip.textContent = text
    Object.assign(tip.style, { display: 'block', transform: `translate(${Math.max(4, rect.left)}px, ${Math.max(4, rect.top - 32)}px)` })
    window.clearTimeout(tipTimer)
    tipTimer = window.setTimeout(() => { tip.style.display = 'none' }, 2200)
  }

  const refreshBoxes = () => {
    const state = current()
    const edit = state?.mode === 'edit'
    const target = edit ? find(state?.selected ?? null) : null
    place(selected, target)
    place(hover, edit && hoverTarget !== target ? hoverTarget : null)
    if (target) {
      const rect = target.getBoundingClientRect()
      const def = COMPONENT_MAP.get(state!.selected!)
      label.textContent = def?.label ?? state!.selected!
      Object.assign(label.style, { display: 'block', transform: `translate(${Math.max(0, rect.left)}px, ${Math.max(0, rect.top - 22)}px)` })
      const parent = def?.parent ? COMPONENT_MAP.get(def.parent) : null
      const siblings = parent?.children ?? []
      for (const { button, action } of buttonEls) {
        if (action === 'parent') button.disabled = !def?.parent
        else if (action === 'hide') button.disabled = !def || def.caps.required || !def.caps.hideable
        else button.disabled = !def?.caps.reorderable || siblings.length < 2
      }
      const top = rect.top > 56 ? rect.top - 50 : Math.min(window.innerHeight - 50, rect.bottom + 6)
      Object.assign(toolbar.style, { display: 'flex', transform: `translate(${Math.max(4, Math.min(window.innerWidth - 180, rect.right - 176))}px, ${top}px)` })
    } else {
      label.style.display = 'none'
      toolbar.style.display = 'none'
    }
  }

  const commitEdit = (save: boolean) => {
    const element = editing
    if (!element) return
    editing = null
    element.contentEditable = 'false'
    element.classList.remove('sl-editing')
    const [id, key] = (element.getAttribute('data-sl-text') ?? '').split(':')
    const value = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
    if (save && id && key) send({ type: 'sl:text', id, key, value })
    else if (!save) send({ type: 'sl:select', id: id ?? null })
  }

  const onPointerMove = (event: PointerEvent) => {
    if (!editMode() || event.pointerType === 'touch') return
    const target = event.target instanceof Element ? event.target.closest('[data-sl]') : null
    if (target !== hoverTarget) { hoverTarget = target; refreshBoxes() }
  }
  const onClick = (event: MouseEvent) => {
    if (!editMode()) return
    const node = event.target instanceof Element ? event.target : null
    if (!node || toolbar.contains(node)) return
    if (editing && editing.contains(node)) return
    event.preventDefault()
    event.stopPropagation()
    if (editing) commitEdit(true)
    const data = node.closest('[data-sl-data]')
    if (data) showTip(LOCK_TEXT, data)
    const target = node.closest('[data-sl]')
    send({ type: 'sl:select', id: target?.getAttribute('data-sl') ?? null })
  }
  const onDoubleClick = (event: MouseEvent) => {
    if (!editMode()) return
    const node = event.target instanceof Element ? event.target : null
    if (!node) return
    event.preventDefault()
    event.stopPropagation()
    const data = node.closest('[data-sl-data]')
    if (data) {
      const [id, key] = (data.getAttribute('data-sl-data') ?? '').split(':')
      showTip(LOCK_TEXT, data)
      if (id && key) send({ type: 'sl:locked', id, key })
      return
    }
    const text = node.closest('[data-sl-text]')
    if (!(text instanceof HTMLElement) || text.closest('[data-sl-data]')) return
    const [id] = (text.getAttribute('data-sl-text') ?? '').split(':')
    const owner = id ? COMPONENT_MAP.get(id) : null
    if (!owner?.text) return
    editing = text
    text.contentEditable = 'plaintext-only'
    if (text.contentEditable !== 'plaintext-only') text.contentEditable = 'true'
    text.classList.add('sl-editing')
    text.focus()
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (editing) {
      if (event.key === 'Enter') { event.preventDefault(); commitEdit(true) }
      else if (event.key === 'Escape') { event.preventDefault(); commitEdit(false) }
      return
    }
    const typing = event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable="true"]')
    const mod = event.ctrlKey || event.metaKey
    if (mod && event.key.toLowerCase() === 's') { event.preventDefault(); send({ type: 'sl:shortcut', action: 'save' }); return }
    if (typing || !editMode()) return
    if (mod && event.key.toLowerCase() === 'z') { event.preventDefault(); send({ type: 'sl:shortcut', action: event.shiftKey ? 'redo' : 'undo' }) }
    else if (mod && event.key.toLowerCase() === 'y') { event.preventDefault(); send({ type: 'sl:shortcut', action: 'redo' }) }
    else if (event.key === 'Escape') send({ type: 'sl:shortcut', action: 'escape' })
  }
  const onFocusOut = (event: FocusEvent) => { if (editing && event.target === editing) commitEdit(true) }
  const onSubmit = (event: Event) => { if (editMode()) { event.preventDefault(); event.stopPropagation() } }
  const onScroll = () => refreshBoxes()

  document.addEventListener('pointermove', onPointerMove, true)
  document.addEventListener('click', onClick, true)
  document.addEventListener('dblclick', onDoubleClick, true)
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('focusout', onFocusOut, true)
  document.addEventListener('submit', onSubmit, true)
  window.addEventListener('scroll', onScroll, true)
  window.addEventListener('resize', onScroll)
  const own = new Set<Node>([hover, selected, label, tip, toolbar, badge])
  const observer = new MutationObserver(mutations => {
    if (!editing && mutations.some(mutation => !own.has(mutation.target) && !toolbar.contains(mutation.target))) refreshBoxes()
  })
  observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] })

  return {
    refresh: state => {
      if (state.scrollTo) find(state.scrollTo)?.scrollIntoView({ block: 'center' })
      refreshBoxes()
    },
    detach: () => {
      observer.disconnect()
      document.removeEventListener('pointermove', onPointerMove, true)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('dblclick', onDoubleClick, true)
      document.removeEventListener('keydown', onKeyDown, true)
      document.removeEventListener('focusout', onFocusOut, true)
      document.removeEventListener('submit', onSubmit, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onScroll)
      for (const element of [hover, selected, label, tip, toolbar, badge]) element.remove()
    }
  }
}
