/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { supabase } from '../lib/supabase'
import { resolveSiteValues, sanitizeStoredOverrides, type SiteOverrides, type SiteValues } from '../lib/site-content/content'
import { SITE_CONTENT_DEFAULTS } from '../lib/site-content/registry'

/**
 * Supplies the published website and user-panel copy to the components that render it.
 *
 * - Visitors and the signed-in notebook read `site_content_published` (the only public read;
 *   drafts are never exposed). Each mount fetches once; there is no per-label request.
 * - The last good published copy is cached in localStorage so a returning visitor sees the
 *   saved wording on the first paint instead of the defaults. The cache is display-only and
 *   is re-validated on every read; a bad or missing cache falls back to the defaults.
 * - Owner preview passes `overrides` explicitly. The provider then never fetches and renders
 *   exactly that draft, so the preview cannot mix published and draft text.
 * - Any failure (no backend, network error, malformed row) keeps the defaults. A missing
 *   value for one key falls back to that key's default.
 */

const CACHE_KEY = 'stracker-site-content-cache-v1'
const DOCUMENT_CACHE_KEY = 'stracker-site-document-cache-v1'

function readCache(): SiteOverrides {
  if (typeof window === 'undefined') return {}
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    return raw ? sanitizeStoredOverrides(JSON.parse(raw)) : {}
  } catch {
    return {}
  }
}

function writeCache(overrides: SiteOverrides) {
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(overrides))
  } catch {
    // Storage may be unavailable (private mode, quota). The live values still apply.
  }
}

function readDocumentCache(): unknown {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(DOCUMENT_CACHE_KEY)
    return raw ? JSON.parse(raw) as unknown : null
  } catch {
    return null
  }
}

function writeDocumentCache(document: unknown) {
  try {
    if (document) window.localStorage.setItem(DOCUMENT_CACHE_KEY, JSON.stringify(document))
    else window.localStorage.removeItem(DOCUMENT_CACHE_KEY)
  } catch {
    // Display-only cache; ignore storage failures.
  }
}

/**
 * Published copy plus the Live Site Editor page document (null when none is published).
 * The document is kept raw here and validated by the page renderer before use. If the
 * document column cannot be read, the copy alone is still returned.
 */
export async function fetchPublishedSite(): Promise<{ overrides: SiteOverrides; document: unknown } | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('site_content_published')
      .select('content, document')
      .eq('id', 1)
      .maybeSingle()
    if (error) {
      const overrides = await fetchPublishedOverrides()
      return overrides === null ? null : { overrides, document: null }
    }
    const row = data as { content?: unknown; document?: unknown } | null
    return { overrides: sanitizeStoredOverrides(row?.content), document: row?.document ?? null }
  } catch {
    return null
  }
}

/**
 * Returns the sanitised published overrides, `{}` when nothing has been published yet, or
 * `null` when the copy could not be read (in which case the caller keeps what it has).
 */
export async function fetchPublishedOverrides(): Promise<SiteOverrides | null> {
  if (!supabase) return null
  try {
    const { data, error } = await supabase
      .from('site_content_published')
      .select('content')
      .eq('id', 1)
      .maybeSingle()
    if (error) return null
    return sanitizeStoredOverrides(data?.content)
  } catch {
    return null
  }
}

const SiteContentContext = createContext<SiteValues>(SITE_CONTENT_DEFAULTS)
/** Raw Live Site Editor document (published, or the draft in owner previews); null = as shipped. */
const SiteDocumentContext = createContext<unknown>(null)
/** True once the published copy has been read (or could not be), so pages can tell "not set" from "not loaded yet". */
const SiteContentSettledContext = createContext<boolean>(true)

export function SiteContentProvider({ children, overrides, document, withDocument = false }: {
  children: ReactNode
  overrides?: SiteOverrides
  /** Owner preview / editor canvas: render exactly this document (never fetched). */
  document?: unknown
  /** Public pages: also read the published page document. The notebook does not need it. */
  withDocument?: boolean
}) {
  const [published, setPublished] = useState<SiteOverrides>(() => (overrides ? {} : readCache()))
  const [publishedDocument, setPublishedDocument] = useState<unknown>(() => (overrides || !withDocument ? null : readDocumentCache()))
  const [settled, setSettled] = useState(Boolean(overrides))

  useEffect(() => {
    if (overrides) return undefined
    let cancelled = false
    if (withDocument) {
      void fetchPublishedSite().then(result => {
        if (cancelled) return
        setSettled(true)
        if (result === null) return
        setPublished(result.overrides)
        writeCache(result.overrides)
        setPublishedDocument(result.document)
        writeDocumentCache(result.document)
      })
    } else {
      void fetchPublishedOverrides().then(result => {
        if (cancelled) return
        setSettled(true)
        if (result === null) return
        setPublished(result)
        writeCache(result)
      })
    }
    return () => { cancelled = true }
  }, [overrides, withDocument])

  const values = useMemo(() => resolveSiteValues(overrides ?? published), [overrides, published])
  const activeDocument = overrides ? (document ?? null) : publishedDocument
  return <SiteContentSettledContext.Provider value={settled || Boolean(overrides)}>
    <SiteContentContext.Provider value={values}>
      <SiteDocumentContext.Provider value={activeDocument}>{children}</SiteDocumentContext.Provider>
    </SiteContentContext.Provider>
  </SiteContentSettledContext.Provider>
}

/** The raw page document for the current provider (null = the page as shipped). */
export function useSiteDocument(): unknown {
  return useContext(SiteDocumentContext)
}

/** Display text for a registered key. Unknown keys render as an empty string, never as the key. */
export function useSiteText(key: string): string {
  const values = useContext(SiteContentContext)
  return values[key] ?? SITE_CONTENT_DEFAULTS[key] ?? ''
}

export function useSiteValues(): SiteValues {
  return useContext(SiteContentContext)
}

/** Whether the published copy has finished loading (always true for previews with explicit overrides). */
export function useSiteContentSettled(): boolean {
  return useContext(SiteContentSettledContext)
}
