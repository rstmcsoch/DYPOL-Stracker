import type { ReactNode } from 'react'
import { useStudentLayout } from '../../contexts/StudentLayoutContext'
import { labelTarget } from './label-key'

/**
 * Static wording of a student page (`k` = `<page>:<key>`, generated from literal source text
 * only). Without a published layout it renders the shipped string unchanged; inside the editor
 * canvas it is an inline-editable label. Student data never passes through here.
 */
export function T({ k, children }: { k: string; children: string }): ReactNode {
  const { document, editing } = useStudentLayout()
  if (!document && !editing) return children
  const [id, key] = labelTarget(k)
  const value = document?.components?.[id]?.text?.[key] ?? children
  // Keyed by value: after an in-place edit the span is replaced, so React never reuses edited DOM.
  return editing ? <span key={value} data-sl-text={`${id}:${key}`}>{value}</span> : value
}
