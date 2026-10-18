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

export function SiteContentProvider({ children, overrides }: { children: ReactNode; overrides?: SiteOverrides }) {
  const [published, setPublished] = useState<SiteOverrides>(() => (overrides ? {} : readCache()))

  useEffect(() => {
    if (overrides) return undefined
    let cancelled = false
    void fetchPublishedOverrides().then(result => {
      if (cancelled || result === null) return
      setPublished(result)
      writeCache(result)
    })
    return () => { cancelled = true }
  }, [overrides])

  const values = useMemo(() => resolveSiteValues(overrides ?? published), [overrides, published])
  return <SiteContentContext.Provider value={values}>{children}</SiteContentContext.Provider>
}

/** Display text for a registered key. Unknown keys render as an empty string, never as the key. */
export function useSiteText(key: string): string {
  const values = useContext(SiteContentContext)
  return values[key] ?? SITE_CONTENT_DEFAULTS[key] ?? ''
}

export function useSiteValues(): SiteValues {
  return useContext(SiteContentContext)
}
