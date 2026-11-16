/**
 * In-page view states of the editor canvas: sub-tabs, toggles, expanders, filters and the
 * page's "open" actions. The editor lists them in its "View state" menu so every state of a
 * page can be reached (and then edited) without hunting for the control.
 */

export interface CanvasViewState { key: string; label: string; group: string; active: boolean }

export const NAV_SCOPES = '[data-sl="shell.sidebar"], [data-sl="shell.mobile-nav"], .sidebar, .mobile-drawer, .mobile-nav'
/** Controls that run normally in edit mode (Alt / Shift + click, or "Select only", selects instead). */
export const INTERACTIVE = 'button, [role="tab"], [role="radio"], [role="option"], [role="switch"], [role="checkbox"], [role="button"], summary, select, input, textarea, label'
/** jsdom (tests) has no layout, so every element counts as visible there. */
const NO_LAYOUT = typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent)
const OVERLAY = '.sl-ov, .sl-ov-label, .sl-ov-tip, .sl-ov-toolbar, .sl-badge'

/** Per-record actions (complete a task, mark a year, a chapter's status) are not view states. */
const RECORD_CONTROL = /^(Mark |Complete |Actions for |Status for |Pin |Target year|\d{4} (pending|done))/
const clean = (value: string | null | undefined) => (value ?? '').replace(/\s+/g, ' ').trim().slice(0, 48)
const nameOf = (element: Element) => clean(element.getAttribute('aria-label')) || clean(element.textContent) || clean(element.getAttribute('title'))
const visible = (element: Element) => {
  if (element.closest(`${NAV_SCOPES}, ${OVERLAY}`)) return false
  if ((element as HTMLButtonElement).disabled) return false
  if (NO_LAYOUT) return true
  const rect = element.getBoundingClientRect()
  return rect.width > 0 || rect.height > 0
}

function selectName(select: HTMLSelectElement): string {
  const own = clean(select.getAttribute('aria-label'))
  if (own) return own
  const label = select.closest('label')
  if (label) {
    const span = label.querySelector('span')
    if (span && !span.contains(select)) return clean(span.textContent)
    const copy = label.cloneNode(true) as HTMLElement
    copy.querySelectorAll('select').forEach(node => node.remove())
    if (clean(copy.textContent)) return clean(copy.textContent)
  }
  return 'Choose'
}

interface Entry { state: CanvasViewState; run: () => void }

function entries(root: ParentNode = document): Entry[] {
  const out: Entry[] = []
  const seen = new Set<string>()
  const push = (group: string, label: string, active: boolean, run: () => void) => {
    if (!label || RECORD_CONTROL.test(label)) return
    const key = `${group}|${label}`
    if (seen.has(key)) return
    seen.add(key)
    out.push({ state: { key, label, group, active }, run })
  }
  root.querySelectorAll('[role="tab"]').forEach(tab => {
    if (visible(tab)) push('Tabs', nameOf(tab), tab.getAttribute('aria-selected') === 'true', () => (tab as HTMLElement).click())
  })
  root.querySelectorAll('.focus-mode-selector button, [role="group"] > button[aria-pressed], button[aria-pressed]').forEach(button => {
    if (visible(button)) push('Toggles', nameOf(button), button.getAttribute('aria-pressed') === 'true' || button.classList.contains('active'), () => (button as HTMLElement).click())
  })
  root.querySelectorAll('[aria-expanded], details > summary').forEach(control => {
    if (!visible(control) || control.closest('.mobile-menu-btn')) return
    const open = control.tagName === 'SUMMARY' ? Boolean((control.parentElement as HTMLDetailsElement | null)?.open) : control.getAttribute('aria-expanded') === 'true'
    push('Show / hide', nameOf(control), open, () => (control as HTMLElement).click())
  })
  root.querySelectorAll('.page-header-action button, .page-header-action a[role="button"]').forEach(button => {
    // Exports and downloads are actions, not states of the page.
    if (visible(button) && !/^(Export|Download|Print)/i.test(nameOf(button))) push('Open', nameOf(button), false, () => (button as HTMLElement).click())
  })
  root.querySelectorAll('select').forEach(node => {
    const select = node as HTMLSelectElement
    if (!visible(select) || select.closest('form, [role="dialog"], dialog, tr, li, [role="row"]') || select.options.length > 16) return
    const name = selectName(select)
    if (RECORD_CONTROL.test(name)) return
    for (const option of Array.from(select.options)) {
      if (option.disabled) continue
      push(`Filter · ${name}`, clean(option.text), select.value === option.value, () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set
        setter?.call(select, option.value)
        select.dispatchEvent(new Event('change', { bubbles: true }))
      })
    }
  })
  return out
}

export function collectViewStates(root: ParentNode = document): CanvasViewState[] {
  return entries(root).map(entry => entry.state)
}

/** Runs the control behind a view state; returns false when it is no longer on the page. */
export function activateViewState(key: string, root: ParentNode = document): boolean {
  const entry = entries(root).find(item => item.state.key === key)
  if (!entry) return false
  entry.run()
  return true
}
