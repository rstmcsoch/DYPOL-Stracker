import { COMPONENT_MAP, type ComponentDef } from '../../lib/student-layout/registry'
import type { Device } from './layout-ops'

export const DEVICE_LABELS: Record<Device, string> = { desktop: 'Desktop', tablet: 'Tablet (≤1024px)', mobile: 'Phone (≤640px)' }
/** Shown wherever a live student value appears in the editor. */
export const LOCKED_TEXT = 'Live student data, not editable'

export function componentChain(id: string): ComponentDef[] {
  const out: ComponentDef[] = []
  let current = COMPONENT_MAP.get(id)
  while (current) { out.unshift(current); current = current.parent ? COMPONENT_MAP.get(current.parent) : undefined }
  return out
}
