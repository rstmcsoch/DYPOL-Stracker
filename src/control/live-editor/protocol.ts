import type { SiteDocument, SitePageId } from '../../lib/site-editor/model'
import type { SiteOverrides } from '../../lib/site-content/content'

/**
 * Messages between the editor workspace and its same-origin canvas iframe. Both sides check
 * `event.origin === location.origin` and the expected window before acting, and the canvas
 * never fetches draft data itself: it only renders what its parent editor sends.
 */

export type Selection =
  | { kind: 'block'; id: string }
  | { kind: 'region'; id: 'header' | 'footer' }

export interface CanvasState {
  type: 'se:state'
  page: SitePageId
  overrides: SiteOverrides
  document: SiteDocument
  selected: Selection | null
  mode: 'edit' | 'preview'
  /** Bumped when the canvas should rebuild the page from scratch (e.g. after inline typing). */
  epoch: number
  scrollTo?: string | null
}

export type CanvasMessage =
  | { type: 'se:ready' }
  | { type: 'se:select'; selection: Selection | null; key?: string; prop?: string }
  | { type: 'se:text'; selection: Selection; key?: string; prop?: string; value: string }
  | { type: 'se:page'; page: SitePageId }
  | { type: 'se:shortcut'; action: 'undo' | 'redo' | 'delete' | 'duplicate' | 'escape' | 'save' }
  | { type: 'se:action'; action: 'up' | 'down' | 'duplicate' | 'hide' | 'delete' | 'parent' }

export const CANVAS_PATH = '/control-panel/preview/canvas'

export function isCanvasMessage(value: unknown): value is CanvasMessage {
  return Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string' && (value as { type: string }).type.startsWith('se:')
}
