import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { controlFetch, ControlApiError } from '../api'
import { useSensitiveAction } from '../reauth'
import { useReportUnsaved } from '../unsaved'
import { checkStudentLayout, type LayoutProblem, type StudentLayoutDocument } from '../../lib/student-layout/validate'
import { describeChanges } from '../../lib/student-layout/diff'
import { EMPTY_LAYOUT, compactLayout } from './layout-ops'

/**
 * State of the Student Dashboard Editor: the working layout, an in-memory undo/redo history
 * (separate from published versions), debounced autosave to the private draft with a
 * revision check, and publish/restore through the MFA-protected endpoints. The server
 * re-validates every write and refuses anything that tries to set student data.
 */

export interface StudentLayoutVersion { version: number; action: 'publish' | 'restore'; restoredFrom: number | null; note: string | null; createdAt: string; createdByYou: boolean; document: unknown }
export interface StudentLayoutState {
  schemaVersion: number
  draft: { exists: boolean; document: unknown; updatedAt: string | null; updatedByYou: boolean }
  published: { version: number; document: unknown; publishedAt: string | null; publishedByYou: boolean }
  versions: StudentLayoutVersion[]
}
export type SaveStatus = 'loading' | 'saved' | 'unsaved' | 'saving' | 'invalid' | 'error' | 'conflict'
export type PublishStatus = 'idle' | 'publishing' | 'published' | 'failed'

export const STUDENT_LAYOUT_QUERY_KEY = ['control', 'student-layout'] as const
const HISTORY_LIMIT = 120
const AUTOSAVE_MS = 2500
const COALESCE_MS = 1200

const keyOf = (doc: StudentLayoutDocument) => JSON.stringify(compactLayout(doc))
export const readLayout = (raw: unknown): StudentLayoutDocument => (raw ? checkStudentLayout(raw).document ?? EMPTY_LAYOUT : EMPTY_LAYOUT)

export function useStudentEditorState() {
  const queryClient = useQueryClient()
  const runSensitive = useSensitiveAction()
  const query = useQuery({
    queryKey: [...STUDENT_LAYOUT_QUERY_KEY, 'state'],
    queryFn: () => controlFetch<StudentLayoutState>('student-layout-state'),
    staleTime: 15_000,
    refetchOnWindowFocus: false
  })

  const [working, setWorking] = useState<StudentLayoutDocument | null>(null)
  const [past, setPast] = useState<StudentLayoutDocument[]>([])
  const [future, setFuture] = useState<StudentLayoutDocument[]>([])
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

  const adopt = useCallback((state: StudentLayoutState) => {
    const next = readLayout(state.draft.exists ? state.draft.document : state.published.document)
    setWorking(next)
    setPast([])
    setFuture([])
    setSavedKey(keyOf(next))
    setRevision(state.draft.exists ? state.draft.updatedAt : null)
    setSaveStatus('saved')
    setServerErrors({})
  }, [])

  useEffect(() => {
    if (query.data && !loadedOnce.current) { loadedOnce.current = true; adopt(query.data) }
  }, [query.data, adopt])

  const currentKey = useMemo(() => (working ? keyOf(working) : null), [working])
  const dirty = Boolean(working && savedKey !== null && currentKey !== savedKey)
  const problems = useMemo<LayoutProblem[]>(() => (working ? checkStudentLayout(working).problems : []), [working])
  const invalid = problems.length > 0
  useReportUnsaved(dirty)

  const workingRef = useRef<StudentLayoutDocument | null>(null)
  workingRef.current = working

  const update = useCallback((recipe: (current: StudentLayoutDocument) => StudentLayoutDocument | null, coalesce?: string): boolean => {
    const current = workingRef.current
    if (!current) return false
    const next = recipe(current)
    if (!next || next === current) return false
    const now = Date.now()
    const merge = Boolean(coalesce && lastCoalesce.current?.key === coalesce && now - lastCoalesce.current.at < COALESCE_MS)
    lastCoalesce.current = coalesce ? { key: coalesce, at: now } : null
    if (!merge) setPast(stack => [...stack.slice(-(HISTORY_LIMIT - 1)), current])
    setFuture([])
    workingRef.current = next
    setWorking(next)
    return true
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
    if (invalid) { setSaveStatus('invalid'); setSaveMessage('Some settings need attention before the draft can be saved.'); return false }
    saving.current = true
    setSaveStatus('saving')
    const key = keyOf(working)
    try {
      const body: Record<string, unknown> = { document: compactLayout(working) }
      if (!options.force) body.expectedUpdatedAt = revision
      const response = await controlFetch<{ ok: true; updatedAt: string }>('student-layout-draft', { method: 'PUT', body })
      setRevision(response.updatedAt)
      setSavedKey(key)
      setServerErrors({})
      setSaveStatus('saved')
      setSaveMessage(null)
      void queryClient.invalidateQueries({ queryKey: STUDENT_LAYOUT_QUERY_KEY })
      return true
    } catch (error) {
      if (error instanceof ControlApiError && error.code === 'draft_conflict') { setSaveStatus('conflict'); setSaveMessage(error.message) }
      else if (error instanceof ControlApiError && error.fieldErrors) { setServerErrors(error.fieldErrors); setSaveStatus('invalid'); setSaveMessage(error.message) }
      else { setSaveStatus('error'); setSaveMessage(error instanceof Error ? error.message : 'The draft could not be saved. Your edits are still here.') }
      return false
    } finally {
      saving.current = false
    }
  }, [working, invalid, revision, queryClient])

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
    await controlFetch<{ ok: true }>('student-layout-discard', { method: 'POST' })
    await reloadFromServer()
  }, [reloadFromServer])

  const publish = useCallback(async (note: string): Promise<boolean> => {
    setPublishStatus('publishing')
    setPublishMessage(null)
    try {
      if (dirty && !(await save())) throw new Error(saveMessage ?? 'Save the draft first; it could not be saved.')
      const result = await runSensitive(() => controlFetch<{ ok: true; version: number }>('student-layout-publish', { method: 'POST', body: note ? { note } : {} }))
      setPublishStatus('published')
      setPublishMessage(`Version ${result.version} is live for every student workspace.`)
      await reloadFromServer()
      return true
    } catch (error) {
      setPublishStatus('failed')
      setPublishMessage(error instanceof Error ? error.message : 'Publishing failed. Student workspaces are unchanged.')
      void queryClient.invalidateQueries({ queryKey: STUDENT_LAYOUT_QUERY_KEY })
      return false
    }
  }, [dirty, save, saveMessage, runSensitive, reloadFromServer, queryClient])

  const restore = useCallback(async (version: number): Promise<string> => {
    const result = await runSensitive(() => controlFetch<{ ok: true; version: number }>('student-layout-restore', { method: 'POST', body: { version } }))
    await queryClient.invalidateQueries({ queryKey: STUDENT_LAYOUT_QUERY_KEY })
    return `Version ${version} was published again as version ${result.version}.`
  }, [runSensitive, queryClient])

  const published = useMemo(() => readLayout(query.data?.published.document), [query.data])
  const pendingChanges = useMemo(() => (working ? describeChanges(compactLayout(published), compactLayout(working)) : []), [working, published])

  return {
    query, working, update, undo, redo, canUndo: past.length > 0, canRedo: future.length > 0,
    dirty, saveStatus, saveMessage, save, problems, serverErrors, invalid,
    publish, publishStatus, publishMessage, setPublishStatus, discardDraft, reloadFromServer, restore, published, pendingChanges
  }
}

export type StudentEditorApi = ReturnType<typeof useStudentEditorState>
