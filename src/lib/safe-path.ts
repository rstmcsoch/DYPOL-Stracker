import { hasControlChars } from './control-chars'

/**
 * In-app path used after login and for assistant "view in Stracker" links.
 * Rejects protocol-relative, backslash, scheme, and encoded slash tricks that
 * some browsers treat as a cross-origin navigation.
 */
export function isSafeAppPath(value: string): boolean {
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return false
  if (value.includes('\\') || value.includes('://') || hasControlChars(value)) return false
  let decoded = value
  try { decoded = decodeURIComponent(value) } catch { return false }
  if (decoded !== value) {
    if (decoded.startsWith('//') || decoded.includes('\\') || decoded.includes('://') || hasControlChars(decoded)) return false
  }
  return true
}

export function safeAppPath(value: string, fallback = '/'): string {
  return isSafeAppPath(value) ? value : fallback
}
