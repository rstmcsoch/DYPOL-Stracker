import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { controlFetch, ControlApiError } from '../api'
import { useSensitiveAction } from '../reauth'
import { useReportUnsaved } from '../unsaved'
import { APPEARANCE_QUERY_KEY, type AppearanceState } from '../appearance/ContentEditor'
import { fieldDefinition } from '../../lib/site-content/registry'
import { diffSiteValues, overridesFromValues, resolveSiteValues, validateFieldValue, type SiteValues } from '../../lib/site-content/content'
import type { SiteDocument } from '../../lib/site-editor/model'
import { checkSiteDocument, type DocumentProblem } from '../../lib/site-editor/validate'
import { compactDocument, normalizeDocument } from './doc-ops'

/**
 * State of the Live Site Editor: the working copy (registry text + page document), an
 * undo/redo history kept in memory (separate from published versions), debounced autosave
 * to the existing private draft with a revision check, and publish through the existing
 * MFA-protected endpoint. The server re-validates and re-authorises every write.
 */

export interface Working { values: SiteValues; document: SiteDocument }
export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'invalid' | 'error' | 'conflict'
export type PublishStatus = 'idle' | 'publishing' | 'published' | 'failed'

const HISTORY_LIMIT = 120
const AUTOSAVE_MS = 2500
const COALESCE_MS = 1200

function snapshotKey(working: Working): string {
  return JSON.stringify([overridesFromValues(working.values), compactDocument(working.document)])
}

function initialWorking(state: AppearanceState): Working {
  const overrides = state.draft.exists ? state.draft.overrides : state.published.overrides
  const raw = state.draft.exists ? state.draft.document : state.published.document
  const document = raw ? checkSiteDocument(raw).document : null
  return { values: resolveSiteValues(overrides), document: normalizeDocument(document) }
}

export function useEditorState() {
  const queryClient = useQueryClient()
  const runSensitive = useSensitiveAction()
  const query = useQuery({
    queryKey: [...APPEARANCE_QUERY_KEY, 'state'],
    queryFn: () => controlFetch<AppearanceState>('appearance-state'),
    staleTime: 15_000,
    refetchOnWindowFocus: false
  })

  const [working, setWorking] = useState<Working | null>(null)
  const [past, setPast] = useState<Working[]>([])
  const [future, setFuture] = useState<Working[]>([])
  const [savedKey, setSavedKey] = useState<string | null>(null)
  const [revision, setRevision] = useState<string | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('loading')
  const [saveMessage, setSaveMessage] = useState<string | null>(null)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [publishStatus, setPublishStatus] = useState<PublishStatus>('idle')
  const [publishMessage, setPublishMessage] = useState<string | null>(null)
  const lastCoalesce = useRef<{ key: string; at: number } | null>(null)
  const saving = useRef(false)
  const loadedOnce = useRef(false)

  // First load (and explicit reloads) take the server state as the working copy.
  const adopt = useCallback((state: AppearanceState) => {
    const next = initialWorking(state)
    setWorking(next)
    setPast([])
    setFuture([])
    setSavedKey(snapshotKey(next))
    setRevision(state.draft.exists ? state.draft.updatedAt : null)
    setSaveStatus('saved')
    setServerErrors({})
  }, [])

  useEffect(() => {
    if (query.data && !loadedOnce.current) {
      loadedOnce.current = true
      adopt(query.data)
    }
  }, [query.data, adopt])

  const currentKey = useMemo(() => (working ? snapshotKey(working) : null), [working])
  const dirty = Boolean(working && savedKey !== null && currentKey !== savedKey)

  const problems = useMemo<DocumentProblem[]>(() => (working ? checkSiteDocument(compactDocument(working.document) ?? { schemaVersion: 1, pages: {} }).problems : []), [working])
  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {}
    if (!working) return errors
    const saved = query.data ? resolveSiteValues(query.data.draft.exists ? query.data.draft.overrides : query.data.published.overrides) : {}
    for (const [key, value] of Object.entries(working.values)) {
      if (saved[key] === value) continue
      const definition = fieldDefinition(key)
      if (!definition) continue
      const checked = validateFieldValue(definition, value)
      if (!checked.ok) errors[key] = checked.message
    }
    return errors
  }, [working, query.data])
  const invalid = problems.length > 0 || Object.keys(fieldErrors).length > 0

  useReportUnsaved(dirty)

  // The latest working copy, updated synchronously so rapid edits chain correctly.
  const workingRef = useRef<Working | null>(null)
  workingRef.current = working

  /** Applies an edit. Same-`coalesce` edits in quick succession (typing) share one undo step. */
  const update = useCallback((recipe: (current: Working) => Working | null, coalesce?: string) => {
    const current = workingRef.current
    if (!current) return
    const next = recipe(current)
    if (!next || next === current) return
    const now = Date.now()
    const merge = Boolean(coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < COALESCE_MS)
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null
    if (!merge) setPast(stack => [...stack.slice(-(HISTORY_LIMIT - 1)), current])
    setFuture([])
    workingRef.current = next
    setWorking(next)
  }, [])

  const undo = useCallback(() => {
    const current = workingRef.current
    if (!past.length || !current) return
    lastCoalesce.current = null
    const previous = past[past.length - 1]!
    setPast(past.slice(0, -1))
    setFuture([current, ...future].slice(0, HISTORY_LIMIT))
    workingRef.current = previous
    setWorking(previous)
  }, [past, future])

  const redo = useCallback(() => {
    const current = workingRef.current
    if (!future.length || !current) return
    lastCoalesce.current = null
    const next = future[0]!
    setFuture(future.slice(1))
    setPast([...past, current].slice(-HISTORY_LIMIT))
    workingRef.current = next
    setWorking(next)
  }, [past, future])

  const save = useCallback(async (options: { force?: boolean } = {}): Promise<boolean> => {
    if (!working || saving.current) return false
    if (invalid) { setSaveStatus('invalid'); setSaveMessage('Some fields need attention before the draft can be saved.'); return false }
    saving.current = true
    setSaveStatus('saving')
    const key = snapshotKey(working)
    try {
      const body: Record<string, unknown> = { overrides: overridesFromValues(working.values), document: compactDocument(working.document) }
      if (!options.force) body.expectedUpdatedAt = revision
      const response = await controlFetch<{ ok: true; updatedAt: string }>('appearance-draft', { method: 'PUT', body })
      setRevision(response.updatedAt)
      setSavedKey(key)
      setServerErrors({})
      setSaveStatus('saved')
      setSaveMessage(null)
      void queryClient.invalidateQueries({ queryKey: APPEARANCE_QUERY_KEY })
      return true
    } catch (error) {
      if (error instanceof ControlApiError && error.code === 'draft_conflict') {
        setSaveStatus('conflict')
        setSaveMessage(error.message)
      } else if (error instanceof ControlApiError && error.fieldErrors) {
        setServerErrors(error.fieldErrors)
        setSaveStatus('invalid')
        setSaveMessage(error.message)
      } else {
        setSaveStatus('error')
        setSaveMessage(error instanceof Error ? error.message : 'The draft could not be saved. Check your connection; your edits are still here.')
      }
      return false
    } finally {
      saving.current = false
    }
  }, [working, invalid, revision, queryClient])

  // Status follows the working copy; autosave after a quiet moment (never publishes).
  useEffect(() => {
    if (!working || saveStatus === 'loading' || saveStatus === 'saving' || saveStatus === 'conflict') return undefined
    if (!dirty) { if (saveStatus !== 'saved' && saveStatus !== 'error') setSaveStatus('saved'); return undefined }
    if (invalid) { setSaveStatus('invalid'); return undefined }
    if (saveStatus === 'saved' || saveStatus === 'invalid') setSaveStatus('unsaved')
    const timer = window.setTimeout(() => { void save() }, saveStatus === 'error' ? AUTOSAVE_MS * 4 : AUTOSAVE_MS)
    return () => window.clearTimeout(timer)
  }, [working, dirty, invalid, saveStatus, save])

  const reloadFromServer = useCallback(async () => {
    const fresh = await query.refetch()
    if (fresh.data) adopt(fresh.data)
  }, [query, adopt])

  const discardDraft = useCallback(async () => {
    await controlFetch<{ ok: true }>('appearance-discard', { method: 'POST' })
    await reloadFromServer()
  }, [reloadFromServer])

  const publish = useCallback(async (note: string): Promise<boolean> => {
    setPublishStatus('publishing')
    setPublishMessage(null)
    try {
      if (dirty && !(await save())) throw new Error(saveMessage ?? 'Save the draft first; it could not be saved.')
      const result = await runSensitive(() => controlFetch<{ ok: true; version: number; changed: number }>('appearance-publish', { method: 'POST', body: { note } }))
      setPublishStatus('published')
      setPublishMessage(`Version ${result.version} is live.`)
      await reloadFromServer()
      return true
    } catch (error) {
      setPublishStatus('failed')
      setPublishMessage(error instanceof Error ? error.message : 'Publishing failed. The live site is unchanged.')
      void queryClient.invalidateQueries({ queryKey: APPEARANCE_QUERY_KEY })
      return false
    }
  }, [dirty, save, saveMessage, runSensitive, reloadFromServer, queryClient])

  const publishedValues = useMemo(() => resolveSiteValues(query.data?.published.overrides), [query.data])
  const pendingText = useMemo(() => (working ? diffSiteValues(publishedValues, working.values) : []), [working, publishedValues])
  const layoutChanged = useMemo(() => {
    if (!working || !query.data) return false
    const live = query.data.published.document ? checkSiteDocument(query.data.published.document).document : null
    return JSON.stringify(compactDocument(working.document)) !== JSON.stringify(compactDocument(normalizeDocument(live)))
  }, [working, query.data])

  return {
    query, working, update, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0,
    dirty, saveStatus, saveMessage, save, problems, fieldErrors, serverErrors, invalid,
    publish, publishStatus, publishMessage, setPublishStatus, discardDraft, reloadFromServer,
    publishedValues, pendingText, layoutChanged
  }
}

export type EditorApi = ReturnType<typeof useEditorState>
