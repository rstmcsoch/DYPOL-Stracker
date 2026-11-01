/**
 * Single-key app shortcuts (N, T, R, ?) must never fire while the student is typing or while
 * any dialog, palette or panel is open — otherwise typing "t" into Cmd+K jumps to Tests.
 */
export interface ShortcutEventLike {
  key: string
  target: EventTarget | null
  metaKey?: boolean
  ctrlKey?: boolean
  altKey?: boolean
  repeat?: boolean
  isComposing?: boolean
}

const TYPING_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT'])
const TYPING_ROLES = new Set(['textbox', 'searchbox', 'combobox', 'spinbutton'])
const OVERLAY_SELECTOR = '[role="dialog"], [role="alertdialog"], [aria-modal="true"], dialog[open]'

export function isTypingElement(element: Element | null | undefined): boolean {
  if (!element || typeof (element as HTMLElement).tagName !== 'string') return false
  const html = element as HTMLElement
  if (TYPING_TAGS.has(html.tagName) || html.isContentEditable) return true
  const role = html.getAttribute?.('role')
  return Boolean(role && TYPING_ROLES.has(role))
}

export function shouldIgnoreShortcut(event: ShortcutEventLike, overlayOpen: boolean, doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  if (overlayOpen || event.repeat || event.isComposing) return true
  if (event.metaKey || event.ctrlKey || event.altKey) return true
  const target = event.target instanceof Element ? event.target : null
  if (isTypingElement(target) || isTypingElement(doc?.activeElement ?? null)) return true
  if (target?.closest?.(OVERLAY_SELECTOR)) return true
  if (doc?.querySelector(OVERLAY_SELECTOR)) return true
  return false
}

/** Cmd+K task result target: opens the Planner on that task's week and highlights the task. */
export function plannerTaskHref(task: { id: string; task_date: string }): string {
  return `/planner?date=${encodeURIComponent(task.task_date)}&task=${encodeURIComponent(task.id)}`
}

/** True when any dialog, palette or modal panel is open on the page. */
export function anyDialogOpen(doc: Document | null = typeof document === 'undefined' ? null : document): boolean {
  return Boolean(doc?.querySelector(OVERLAY_SELECTOR))
}
