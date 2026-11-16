/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import type { StudentLayoutDocument } from '../lib/student-layout/validate'

/**
 * Published Student Dashboard Editor layout for the signed-in workspace.
 *
 * - With nothing published (or anything invalid/unavailable) the value is null and every
 *   page renders exactly the shipped layout; nothing else is downloaded.
 * - The published row (presentation only, never student data) is read once per session
 *   after first paint and cached in localStorage so the next visit paints it immediately.
 *   The validator and CSS compiler are loaded on demand only when a layout exists.
 * - The editor canvas passes `document` explicitly (synthetic preview): no fetch, no cache.
 */

export interface StudentLayoutValue {
  document: StudentLayoutDocument | null
  /** True only inside the editor canvas: adds selection/lock markers, shows hidden parts. */
  editing: boolean
}

const StudentLayoutContext = createContext<StudentLayoutValue>({ document: null, editing: false })

const CACHE_KEY = 'stracker-student-layout-v1'

interface Cached { version: number; document: unknown }

function readCache(): Cached | null {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Cached
    return typeof parsed?.version === 'number' ? parsed : null
  } catch { return null }
}

function writeCache(value: Cached | null) {
  try {
    if (value) window.localStorage.setItem(CACHE_KEY, JSON.stringify(value))
    else window.localStorage.removeItem(CACHE_KEY)
  } catch { /* display-only cache */ }
}

/** Published layout row; null when none is published or it cannot be read. */
export async function fetchPublishedStudentLayout(): Promise<Cached | null | undefined> {
  if (!supabase) return undefined
  try {
    const { data, error } = await supabase.from('student_layout_published').select('document, version').eq('id', 1).maybeSingle()
    if (error) return undefined
    const row = data as { document?: unknown; version?: unknown } | null
    return row && typeof row.version === 'number' ? { version: row.version, document: row.document ?? null } : null
  } catch { return undefined }
}

/**
 * Installs the compiled layout CSS as a constructed stylesheet: the site's Content Security
 * Policy (`style-src 'self'`) refuses inline <style> elements, but allows constructed sheets.
 */
function useLayoutStyles(css: string) {
  useEffect(() => {
    if (!css || typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return undefined
    const sheet = new CSSStyleSheet()
    try { sheet.replaceSync(css) } catch { return undefined }
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]
    return () => { document.adoptedStyleSheets = document.adoptedStyleSheets.filter(item => item !== sheet) }
  }, [css])
}

export function StudentLayoutProvider({ children, document: preview, css: previewCss, editing = false }: { children: ReactNode; document?: StudentLayoutDocument | null; css?: string; editing?: boolean }) {
  const isPreview = preview !== undefined
  const [state, setState] = useState<{ document: StudentLayoutDocument | null; css: string; version: number }>({ document: null, css: '', version: 0 })

  useEffect(() => {
    if (isPreview || typeof window === 'undefined') return
    let cancelled = false
    const apply = async (cached: Cached | null) => {
      if (!cached?.document) { if (!cancelled) setState({ document: null, css: '', version: cached?.version ?? 0 }); return }
      try {
        const { prepareStudentLayout } = await import('../lib/student-layout/runtime')
        const prepared = prepareStudentLayout(cached.document)
        if (!cancelled) setState(prepared ? { ...prepared, version: cached.version } : { document: null, css: '', version: cached.version })
      } catch { /* keep the shipped layout */ }
    }
    const cached = readCache()
    if (cached) void apply(cached)
    const refresh = async () => {
      const latest = await fetchPublishedStudentLayout()
      if (cancelled || latest === undefined) return
      if ((latest?.version ?? 0) === (cached?.version ?? 0) && Boolean(latest?.document) === Boolean(cached?.document)) return
      writeCache(latest?.document ? latest : null)
      void apply(latest)
    }
    // After first paint, so students never wait for the layout request.
    const hasIdle = typeof window.requestIdleCallback === 'function'
    const handle = hasIdle ? window.requestIdleCallback(() => void refresh(), { timeout: 3000 }) : window.setTimeout(() => void refresh(), 1200)
    return () => {
      cancelled = true
      if (hasIdle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [isPreview])

  const css = isPreview ? (previewCss ?? '') : state.css
  useLayoutStyles(css)
  const value = useMemo<StudentLayoutValue>(() => ({ document: isPreview ? preview ?? null : state.document, editing }), [isPreview, preview, state.document, editing])
  return <StudentLayoutContext.Provider value={value}>{children}</StudentLayoutContext.Provider>
}

export function useStudentLayout(): StudentLayoutValue {
  return useContext(StudentLayoutContext)
}
