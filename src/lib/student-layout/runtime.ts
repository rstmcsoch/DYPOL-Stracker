import { compileStudentLayoutCss } from './compile-css.js'
import { sanitizeStudentLayout, type StudentLayoutDocument } from './validate.js'

/**
 * Loaded on demand (dynamic import) only when a published student layout exists, so
 * students without one never download the registry, validator or CSS compiler.
 */
export function prepareStudentLayout(raw: unknown): { document: StudentLayoutDocument; css: string } | null {
  const document = sanitizeStudentLayout(raw)
  return document ? { document, css: compileStudentLayoutCss(document) } : null
}
