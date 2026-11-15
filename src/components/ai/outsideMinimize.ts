import { useEffect, useRef } from 'react'

/** Pointer movement (px) above which a press counts as a drag, not a click. */
export const OUTSIDE_CLICK_SLOP = 6

/**
 * Things a click on should never minimise the assistant: the assistant itself, its launcher,
 * and other layers that sit above the page (dialogs, sheets, menus, toasts, onboarding).
 */
export const OUTSIDE_MINIMIZE_IGNORE = [
  '.ai-floating-window',
  '.ai-large-workspace',
  '.ai-launcher-wrap',
  '.dialog-backdrop',
  '.onboarding-backdrop',
  '.mobile-sheet-backdrop',
  '.overflow-menu',
  '.toast-stack',
  '.undo-toast',
  '[role="dialog"]',
  '[role="alertdialog"]',
].join(',')

export interface PressStart { x: number; y: number; target: EventTarget | null; button: number }
export interface PressEnd { x: number; y: number; target: EventTarget | null }

function isIgnored(target: EventTarget | null, ignore: string) {
  if (!target || typeof (target as Element).closest !== 'function') return true
  if (!(target as Element).isConnected) return true
  return Boolean((target as Element).closest(ignore))
}

/**
 * True when a completed press (down + up) is a plain click/tap outside the assistant:
 * primary button, barely moved, started and ended outside the ignored layers, and it did not
 * leave a text selection behind.
 */
export function isOutsideClick(start: PressStart | null, end: PressEnd, selectionText = '', ignore = OUTSIDE_MINIMIZE_IGNORE) {
  if (!start || start.button !== 0) return false
  if (Math.hypot(end.x - start.x, end.y - start.y) > OUTSIDE_CLICK_SLOP) return false
  if (selectionText.trim()) return false
  if (isIgnored(start.target, ignore) || isIgnored(end.target, ignore)) return false
  return true
}

/** Calls `onOutside` after a plain click/tap outside the assistant while `active` is true. */
export function useOutsideMinimize(active: boolean, onOutside: () => void, ignore = OUTSIDE_MINIMIZE_IGNORE) {
  const callback = useRef(onOutside)
  useEffect(() => { callback.current = onOutside })
  useEffect(() => {
    if (!active) return
    let start: PressStart | null = null
    let selectionBefore = ''
    const selectionText = () => typeof window.getSelection === 'function' ? window.getSelection()?.toString() ?? '' : ''
    const down = (event: PointerEvent) => {
      start = event.isPrimary !== false ? { x: event.clientX, y: event.clientY, target: event.target, button: event.button } : null
      selectionBefore = selectionText()
    }
    const up = (event: PointerEvent) => {
      if (event.isPrimary === false) return
      const pressed = start
      start = null
      // Only a selection made by this press counts; an old, lingering selection must not block it.
      const now = selectionText()
      const selection = now !== selectionBefore ? now : ''
      if (isOutsideClick(pressed, { x: event.clientX, y: event.clientY, target: event.target }, selection, ignore)) callback.current()
    }
    const cancel = () => { start = null }
    document.addEventListener('pointerdown', down, true)
    document.addEventListener('pointerup', up, true)
    document.addEventListener('pointercancel', cancel, true)
    return () => {
      document.removeEventListener('pointerdown', down, true)
      document.removeEventListener('pointerup', up, true)
      document.removeEventListener('pointercancel', cancel, true)
    }
  }, [active, ignore])
}
