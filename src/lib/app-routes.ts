/**
 * Top-level notebook sections. Anything else under the site (for example /does-not-exist
 * or /mistakes/abc) is an unknown address and gets the in-app "Page not found" view.
 */
export const APP_SECTION_PATHS = [
  '/syllabus', '/tests', '/mistakes', '/retry', '/planner', '/revision', '/analytics', '/weak-areas',
  '/backup', '/settings', '/profile', '/focus', '/practice', '/pyqs', '/backlog', '/mock-analysis',
  '/decks', '/study-now'
] as const

/** True for "/" and the exact notebook section paths (a trailing slash is tolerated). */
export function isKnownAppPath(pathname: string): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  return path === '/' || (APP_SECTION_PATHS as readonly string[]).includes(path)
}
