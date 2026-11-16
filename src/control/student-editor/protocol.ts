import type { StudentPageId } from '../../lib/student-layout/registry'
import type { StudentLayoutDocument } from '../../lib/student-layout/validate'
import type { PreviewScenarioId } from './fixtures'

/**
 * Messages between the Student Dashboard Editor and its same-origin canvas iframe. Both
 * sides check `event.origin === location.origin` and the expected window. The canvas never
 * fetches layout or student data: it renders the parent's working layout over synthetic data.
 */

export interface StudentCanvasState {
  type: 'sl:state'
  page: StudentPageId
  scenario: PreviewScenarioId
  theme: 'light' | 'dark'
  document: StudentLayoutDocument
  selected: string | null
  mode: 'edit' | 'preview'
  /** Bumped to rebuild the page (scenario reset, inline typing committed). */
  epoch: number
  scrollTo?: string | null
  /** Published Navigation & labels overrides, so the sidebar shows the live labels. */
  siteOverrides?: Record<string, string>
}

export type StudentCanvasMessage =
  | { type: 'sl:ready' }
  | { type: 'sl:select'; id: string | null }
  | { type: 'sl:text'; id: string; key: string; value: string }
  | { type: 'sl:locked'; id: string; key: string }
  | { type: 'sl:page'; page: StudentPageId }
  | { type: 'sl:shortcut'; action: 'undo' | 'redo' | 'escape' | 'save' }
  | { type: 'sl:action'; action: 'up' | 'down' | 'hide' | 'parent' }

export const STUDENT_CANVAS_PATH = '/control-panel/preview/student-canvas'

export function isStudentCanvasMessage(value: unknown): value is StudentCanvasMessage {
  return Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string' && (value as { type: string }).type.startsWith('sl:')
}
