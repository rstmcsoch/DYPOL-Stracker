/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { controlFetch, ControlApiError } from '../api'
import { useSensitiveAction } from '../reauth'
import { useReportUnsaved } from '../unsaved'
import { SITE_CONTENT_FIELDS, fieldDefinition, type FieldDefinition } from '../../lib/site-content/registry'
import {
  diffSiteValues, overridesFromValues, resolveSiteValues, validateFieldValue,
  type ContentChange, type SiteOverrides, type SiteValues
} from '../../lib/site-content/content'

/** Server contract for GET /api/control/appearance-state (see api/_lib/control-routes/appearance.ts). */
export interface AppearanceState {
  schemaVersion: number
  draft: { exists: boolean; overrides: SiteOverrides; updatedAt: string | null; updatedByYou: boolean }
  published: { version: number; overrides: SiteOverrides; publishedAt: string | null; publishedByYou: boolean }
  versions: Array<{
    version: number
    action: 'publish' | 'restore'
    restoredFrom: number | null
    note: string | null
    createdAt: string
    createdByYou: boolean
    overrides: SiteOverrides
  }>
}

export type ActionResult = { ok: true; message: string } | { ok: false; message: string; fieldErrors?: Record<string, string> }

export const APPEARANCE_QUERY_KEY = ['control', 'appearance'] as const

export interface ContentEditorValue {
  state: AppearanceState | undefined
  loading: boolean
  loadError: Error | null
  reload: () => void
  /** The saved draft (or the published copy when no draft exists), as display values. */
  savedValues: SiteValues
  /** The live copy, as display values. */
  publishedValues: SiteValues
  draftExists: boolean
  /** Display values including unsaved local edits: what the editor shows. */
  values: SiteValues
  /** Keys with local edits that differ from the saved draft. */
  dirtyKeys: string[]
  /** Validation messages for local edits (client check; the server checks again). */
  errors: Record<string, string>
  setValue: (key: string, value: string) => void
  resetToDefault: (key: string) => void
  revertEdits: () => void
  /** Changes that are saved as draft but not yet published. */
  draftChanges: ContentChange[]
  saving: boolean
  save: () => Promise<ActionResult>
  discardDraft: () => Promise<ActionResult>
  publish: (note: string) => Promise<ActionResult>
  restore: (version: number, note: string) => Promise<ActionResult>
  busy: boolean
}

const ContentEditorContext = createContext<ContentEditorValue | null>(null)

/** Converts an API failure into a plain message, keeping server-provided field errors. */
function failure(error: unknown): ActionResult {
  if (error instanceof ControlApiError) return { ok: false, message: error.message, fieldErrors: error.fieldErrors ?? undefined }
  return { ok: false, message: 'The change could not be completed. Check your connection and try again.' }
}

/**
 * Owns the Appearance editor state for the whole section, so edits survive moving between
 * its tabs. Saved state always comes from the server; local edits stay in memory until saved
 * or reverted. Nothing here decides who may publish: every write is re-checked by the API.
 */
export function ContentEditorProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const runSensitive = useSensitiveAction()
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)

  const query = useQuery({
    queryKey: [...APPEARANCE_QUERY_KEY, 'state'],
    queryFn: () => controlFetch<AppearanceState>('appearance-state'),
    staleTime: 15_000
  })
  const state = query.data

  const publishedValues = useMemo(() => resolveSiteValues(state?.published.overrides), [state])
  const draftExists = Boolean(state?.draft.exists)
  const savedValues = useMemo(
    () => resolveSiteValues(draftExists ? state?.draft.overrides : state?.published.overrides),
    [state, draftExists]
  )

  const values = useMemo<SiteValues>(() => ({ ...savedValues, ...edits }), [savedValues, edits])

  const dirtyKeys = useMemo(
    () => Object.keys(edits).filter(key => edits[key] !== savedValues[key]),
    [edits, savedValues]
  )

  const errors = useMemo(() => {
    const result: Record<string, string> = {}
    for (const key of dirtyKeys) {
      const definition = fieldDefinition(key)
      if (!definition) continue
      const checked = validateFieldValue(definition, edits[key])
      if (!checked.ok) result[key] = checked.message
    }
    return result
  }, [dirtyKeys, edits])

  const draftChanges = useMemo(() => diffSiteValues(publishedValues, savedValues), [publishedValues, savedValues])

  useReportUnsaved(dirtyKeys.length > 0)

  const refreshAll = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: APPEARANCE_QUERY_KEY })
  }, [queryClient])

  const setValue = useCallback((key: string, value: string) => {
    setEdits(current => ({ ...current, [key]: value }))
  }, [])

  const resetToDefault = useCallback((key: string) => {
    const definition: FieldDefinition | undefined = fieldDefinition(key)
    if (definition) setEdits(current => ({ ...current, [key]: definition.defaultValue }))
  }, [])

  const revertEdits = useCallback(() => setEdits({}), [])

  const save = useCallback(async (): Promise<ActionResult> => {
    if (Object.keys(errors).length > 0) {
      return { ok: false, message: 'Fix the highlighted fields before saving.', fieldErrors: errors }
    }
    setBusy(true)
    try {
      const overrides = overridesFromValues(values)
      const response = await controlFetch<{ ok: true; fieldsChanged: number }>('appearance-draft', { method: 'PUT', body: { overrides } })
      setEdits({})
      await refreshAll()
      return { ok: true, message: `Draft saved (${response.fieldsChanged} customised ${response.fieldsChanged === 1 ? 'field' : 'fields'}). The live site is unchanged until you publish.` }
    } catch (error) {
      await refreshAll()
      return failure(error)
    } finally {
      setBusy(false)
    }
  }, [errors, values, refreshAll])

  const discardDraft = useCallback(async (): Promise<ActionResult> => {
    setBusy(true)
    try {
      await controlFetch<{ ok: true }>('appearance-discard', { method: 'POST' })
      setEdits({})
      await refreshAll()
      return { ok: true, message: 'Unpublished changes discarded. The live copy is shown again.' }
    } catch (error) {
      return failure(error)
    } finally {
      setBusy(false)
    }
  }, [refreshAll])

  const publish = useCallback(async (note: string): Promise<ActionResult> => {
    setBusy(true)
    try {
      const result = await runSensitive(() => controlFetch<{ ok: true; version: number; changed: number }>('appearance-publish', { method: 'POST', body: { note } }))
      await refreshAll()
      return { ok: true, message: `Published version ${result.version}: ${result.changed} ${result.changed === 1 ? 'change' : 'changes'} are now live.` }
    } catch (error) {
      await refreshAll()
      return failure(error)
    } finally {
      setBusy(false)
    }
  }, [runSensitive, refreshAll])

  const restore = useCallback(async (version: number, note: string): Promise<ActionResult> => {
    setBusy(true)
    try {
      const result = await runSensitive(() => controlFetch<{ ok: true; version: number; restored: number }>('appearance-restore', { method: 'POST', body: { version, note } }))
      setEdits({})
      await refreshAll()
      return { ok: true, message: `Version ${result.restored} is live again as version ${result.version}. User accounts and study data were not changed.` }
    } catch (error) {
      await refreshAll()
      return failure(error)
    } finally {
      setBusy(false)
    }
  }, [runSensitive, refreshAll])

  const value = useMemo<ContentEditorValue>(() => ({
    state,
    loading: query.isPending,
    loadError: query.error,
    reload: () => void query.refetch(),
    savedValues,
    publishedValues,
    draftExists,
    values,
    dirtyKeys,
    errors,
    setValue,
    resetToDefault,
    revertEdits,
    draftChanges,
    saving: busy,
    save,
    discardDraft,
    publish,
    restore,
    busy
  }), [state, query, savedValues, publishedValues, draftExists, values, dirtyKeys, errors, setValue, resetToDefault, revertEdits, draftChanges, busy, save, discardDraft, publish, restore])

  return <ContentEditorContext.Provider value={value}>{children}</ContentEditorContext.Provider>
}

export function useContentEditor(): ContentEditorValue {
  const value = useContext(ContentEditorContext)
  if (!value) throw new Error('useContentEditor must be used inside ContentEditorProvider')
  return value
}

/** Editable fields for one area, in registry order. */
export function fieldsForArea(area: 'public' | 'user'): FieldDefinition[] {
  return SITE_CONTENT_FIELDS.filter(definition => definition.area === area)
}
