/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { defaultSettings, seedChapters } from '../lib/defaults'
import { assetKey, localDb } from '../lib/database'
import { createId } from '../lib/id'
import { relatedRowsForRemoval } from '../lib/data-relations'
import { supabase, supabaseConfigured } from '../lib/supabase'
import { useAuth } from './AuthContext'
import type {
  AppData, AppSettings, Chapter, DailyTask, Mistake, Profile, QueuedChange, RecordFor,
  Revision, StudySession, TableName, TestChapterLink, TestRecord, TestSubjectScore, WeeklyGoal
} from '../types'

export type SyncState = 'loading' | 'syncing' | 'synced' | 'offline' | 'local' | 'error'
type ImportCollections = Partial<{ [T in TableName]: RecordFor<T>[] }>
interface RelatedUndoEntry { table: TableName; record: Record<string, unknown>; remove: boolean }
interface UndoEntry { table: TableName; record: Record<string, unknown>; related: RelatedUndoEntry[]; expiresAt: number }
interface DataContextValue {
  data: AppData
  loading: boolean
  syncState: SyncState
  pendingCount: number
  syncError: string | null
  refresh: () => Promise<void>
  upsert: <T extends TableName>(table: T, record: RecordFor<T>) => Promise<void>
  upsertMany: <T extends TableName>(table: T, records: RecordFor<T>[]) => Promise<void>
  mergeImportedData: (collections: ImportCollections) => Promise<void>
  remove: <T extends TableName>(table: T, record: RecordFor<T>, options?: { undo?: boolean }) => Promise<void>
  undoDelete: () => Promise<void>
  undoAvailable: boolean
  dismissUndo: () => void
  saveImage: (file: File) => Promise<{ path: string | null; dataUrl: string }>
}

const DataContext = createContext<DataContextValue | null>(null)
const TABLES: TableName[] = [
  'profiles', 'app_settings', 'chapters', 'chapter_revisions', 'tests', 'test_subject_scores',
  'test_chapter_links', 'mistakes', 'daily_tasks', 'weekly_goals', 'study_sessions'
]

const emptyData = (userId: string): AppData => ({
  chapters: [], revisions: [], tests: [], testSubjectScores: [], testChapterLinks: [], mistakes: [],
  tasks: [], goals: [], sessions: [], settings: defaultSettings(userId), profile: null
})

function rowsFor(data: AppData, table: TableName): Record<string, unknown>[] {
  switch (table) {
    case 'profiles': return data.profile ? [data.profile as unknown as Record<string, unknown>] : []
    case 'app_settings': return [data.settings as unknown as Record<string, unknown>]
    case 'chapters': return data.chapters as unknown as Record<string, unknown>[]
    case 'chapter_revisions': return data.revisions as unknown as Record<string, unknown>[]
    case 'tests': return data.tests as unknown as Record<string, unknown>[]
    case 'test_subject_scores': return data.testSubjectScores as unknown as Record<string, unknown>[]
    case 'test_chapter_links': return data.testChapterLinks as unknown as Record<string, unknown>[]
    case 'mistakes': return data.mistakes as unknown as Record<string, unknown>[]
    case 'daily_tasks': return data.tasks as unknown as Record<string, unknown>[]
    case 'weekly_goals': return data.goals as unknown as Record<string, unknown>[]
    case 'study_sessions': return data.sessions as unknown as Record<string, unknown>[]
  }
}

function replaceRows(data: AppData, table: TableName, rows: Record<string, unknown>[]): AppData {
  switch (table) {
    case 'profiles': return { ...data, profile: (rows[0] as unknown as Profile | undefined) ?? null }
    case 'app_settings': return { ...data, settings: (rows[0] as unknown as AppSettings | undefined) ?? data.settings }
    case 'chapters': return { ...data, chapters: rows as unknown as Chapter[] }
    case 'chapter_revisions': return { ...data, revisions: rows as unknown as Revision[] }
    case 'tests': return { ...data, tests: rows as unknown as TestRecord[] }
    case 'test_subject_scores': return { ...data, testSubjectScores: rows as unknown as TestSubjectScore[] }
    case 'test_chapter_links': return { ...data, testChapterLinks: rows as unknown as TestChapterLink[] }
    case 'mistakes': return { ...data, mistakes: rows as unknown as Mistake[] }
    case 'daily_tasks': return { ...data, tasks: rows as unknown as DailyTask[] }
    case 'weekly_goals': return { ...data, goals: rows as unknown as WeeklyGoal[] }
    case 'study_sessions': return { ...data, sessions: rows as unknown as StudySession[] }
  }
}

function updateOne(data: AppData, table: TableName, row: Record<string, unknown>): AppData {
  const current = rowsFor(data, table).filter(item => item.id !== row.id)
  return replaceRows(data, table, [...current, row])
}



async function readLocal(userId: string): Promise<AppData> {
  const byUser = async (table: TableName) => (await localDb.table(table).where('user_id').equals(userId).toArray()) as Record<string, unknown>[]
  const [chapters, revisions, tests, subjectScores, chapterLinks, mistakes, tasks, goals, sessions, settings, profiles, assets] = await Promise.all([
    byUser('chapters'), byUser('chapter_revisions'), byUser('tests'), byUser('test_subject_scores'),
    byUser('test_chapter_links'), byUser('mistakes'), byUser('daily_tasks'), byUser('weekly_goals'),
    byUser('study_sessions'), byUser('app_settings'), byUser('profiles'), localDb.assets.where('user_id').equals(userId).toArray()
  ])
  const localSettings = settings[0] as unknown as AppSettings | undefined
  const enrichedMistakes = mistakes.map(row => {
    const asset = assets.find(item => item.mistake_id === row.id || item.id === assetKey(userId, String(row.id)))
    const dataUrl = (row.image_data as string | null | undefined) ?? asset?.data_url ?? null
    return { ...row, image_data: dataUrl, image_preview: (row.image_preview as string | null | undefined) ?? dataUrl }
  })
  return {
    chapters: chapters as unknown as Chapter[], revisions: revisions as unknown as Revision[], tests: tests as unknown as TestRecord[],
    testSubjectScores: subjectScores as unknown as TestSubjectScore[], testChapterLinks: chapterLinks as unknown as TestChapterLink[],
    mistakes: enrichedMistakes as unknown as Mistake[], tasks: tasks as unknown as DailyTask[], goals: goals as unknown as WeeklyGoal[],
    sessions: sessions as unknown as StudySession[], settings: localSettings ? ({
      ...localSettings, main_exam_date: localSettings.main_exam_date ?? '', advanced_exam_date: localSettings.advanced_exam_date ?? ''
    }) : defaultSettings(userId),
    profile: (profiles[0] as unknown as Profile | undefined) ?? null
  }
}

function isNetworkError(error: unknown): boolean {
  if (!navigator.onLine) return true
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase()
  return message.includes('failed to fetch') || message.includes('network') || message.includes('load failed') || message.includes('timeout')
}

async function clearQueuedChange(userId: string, table: TableName, id: string): Promise<void> {
  await localDb.sync_queue.where('[user_id+table+id]').equals([userId, table, id]).delete()
}

function cleanForCloud(row: Record<string, unknown>): Record<string, unknown> {
  const clean = { ...row }
  if (clean.main_exam_date === '') clean.main_exam_date = null
  if (clean.advanced_exam_date === '') clean.advanced_exam_date = null
  delete clean.image_data
  delete clean.image_preview
  delete clean.image_pending
  delete clean.image_previous_path
  return clean
}

function withOwner(table: TableName, row: Record<string, unknown>, userId: string): Record<string, unknown> {
  const now = new Date().toISOString()
  const record: Record<string, unknown> = { ...row, user_id: userId, updated_at: now }
  if (table === 'profiles' || table === 'app_settings') record.id = userId
  if (!record.created_at) record.created_at = now
  return record
}

async function uploadPendingImage(record: Record<string, unknown>, userId: string): Promise<Record<string, unknown>> {
  if (!supabase || typeof record.image_data !== 'string' || record.image_pending !== true) return record
  const blob = await (await fetch(record.image_data)).blob()
  const path = `${userId}/${createId()}.webp`
  const { error } = await supabase.storage.from('mistake-images').upload(path, blob, { upsert: true, contentType: 'image/webp' })
  if (error) throw error
  return { ...record, image_path: path, image_pending: false }
}

async function retirePreviousMistakeImage(record: Record<string, unknown>): Promise<Record<string, unknown>> {
  const previousPath = typeof record.image_previous_path === 'string' ? record.image_previous_path : ''
  if (previousPath && previousPath !== record.image_path && supabase) {
    const { error } = await supabase.storage.from('mistake-images').remove([previousPath])
    if (error) throw error
  }
  const cleaned = { ...record }
  delete cleaned.image_previous_path
  return cleaned
}

export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id ?? ''
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [pendingCount, setPendingCount] = useState(0)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [undoAvailable, setUndoAvailable] = useState(false)
  const [undoVersion, setUndoVersion] = useState(0)
  const undoRef = useRef<UndoEntry | null>(null)
  const undoTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)

  const query = useQuery({
    queryKey: ['stracker-data', userId], queryFn: () => readLocal(userId), enabled: Boolean(userId),
    staleTime: Infinity, refetchOnWindowFocus: false
  })
  const { data: queryData, refetch: refetchLocal } = query
  const queryDataRef = useRef(queryData)
  useEffect(() => { queryDataRef.current = queryData }, [queryData])
  const setData = useCallback((updater: (data: AppData) => AppData) => {
    const key = ['stracker-data', userId] as const
    const next = updater(queryClient.getQueryData<AppData>(key) ?? emptyData(userId))
    queryDataRef.current = next
    queryClient.setQueryData<AppData>(key, next)
  }, [queryClient, userId])
  const updatePending = useCallback(async () => {
    if (userId) setPendingCount(await localDb.sync_queue.where('user_id').equals(userId).count())
  }, [userId])
  const queueChanges = useCallback(async (changes: Omit<QueuedChange, 'queueId'>[]) => {
    for (const change of changes) {
      await clearQueuedChange(userId, change.table, change.id)
      await localDb.sync_queue.add(change)
    }
    await updatePending()
  }, [userId, updatePending])

  const flushQueue = useCallback(async (): Promise<boolean> => {
    if (!supabase || !userId || !navigator.onLine) return false
    setSyncState('syncing')
    setSyncError(null)
    try {
      const changes = await localDb.sync_queue.where('user_id').equals(userId).sortBy('queued_at')
      for (const change of changes) {
        if (change.operation === 'delete') {
          const { error } = await supabase.from(change.table).delete().eq('id', change.id).eq('user_id', userId)
          if (error) throw error
          if (change.table === 'mistakes') {
            const paths = [change.record?.image_path, change.record?.image_previous_path].filter((path): path is string => typeof path === 'string' && path.length > 0)
            const uniquePaths = [...new Set(paths)]
            if (uniquePaths.length) {
              const { error: storageError } = await supabase.storage.from('mistake-images').remove(uniquePaths)
              if (storageError) throw storageError
            }
          }
        } else if (change.record) {
          const { data: remote, error: readError } = await supabase.from(change.table).select('*').eq('id', change.id).eq('user_id', userId).maybeSingle()
          if (readError) throw readError
          const localTime = String(change.record.updated_at ?? change.queued_at)
          const remoteTime = typeof remote?.updated_at === 'string' ? remote.updated_at : ''
          if (remote && remoteTime > localTime) {
            const normalized = change.table === 'app_settings' ? {
              ...remote, main_exam_date: remote.main_exam_date ?? '', advanced_exam_date: remote.advanced_exam_date ?? ''
            } : remote
            await localDb.table(change.table).put(normalized as object)
            setData(current => updateOne(current, change.table, normalized as Record<string, unknown>))
          } else {
            const prepared = change.table === 'mistakes' ? await uploadPendingImage(change.record, userId) : change.record
            if (prepared !== change.record) {
              change.record = prepared
              await localDb.table(change.table).put(prepared as object)
              if (change.queueId !== undefined) await localDb.sync_queue.put(change)
              setData(current => updateOne(current, change.table, prepared))
            }
            const { error } = await supabase.from(change.table).upsert(cleanForCloud(prepared))
            if (error) throw error
            if (change.table === 'mistakes' && 'image_previous_path' in prepared) {
              const cleaned = await retirePreviousMistakeImage(prepared)
              await localDb.mistakes.put(cleaned as unknown as Mistake)
              setData(current => updateOne(current, 'mistakes', cleaned))
            }
          }
        }
        if (change.queueId !== undefined) await localDb.sync_queue.delete(change.queueId)
      }
      await updatePending()
      setSyncState('synced')
      return true
    } catch (error) {
      const offline = isNetworkError(error)
      setSyncState(offline ? 'offline' : 'error')
      setSyncError(offline ? 'Offline — your changes are safely queued on this device.' : 'Some changes could not sync. Your local copy is safe; retry when ready.')
      return false
    }
  }, [userId, setData, updatePending])

  const refresh = useCallback(async () => {
    if (!userId) return
    const cloud = supabase
    if (!supabaseConfigured || !cloud || user?.isLocal) { setSyncState('local'); return }
    if (!navigator.onLine) {
      setSyncState('offline')
      setSyncError('Offline — showing your previously saved notebook.')
      return
    }
    setSyncState('syncing'); setSyncError(null)
    try {
      const queuedSyncSucceeded = await flushQueue()
      if (!queuedSyncSucceeded) return
      const fetched = await Promise.all(TABLES.map(async table => {
        const { data, error } = await cloud.from(table).select('*').eq('user_id', userId)
        if (error) throw error
        return [table, (data ?? []) as unknown as Record<string, unknown>[]] as const
      }))
      const next = emptyData(userId)
      for (const [table, rawRows] of fetched) {
        let rows = table === 'app_settings' ? rawRows.map(row => ({
          ...row, main_exam_date: row.main_exam_date ?? '', advanced_exam_date: row.advanced_exam_date ?? ''
        })) : rawRows
        if (table === 'mistakes') {
          rows = await Promise.all(rawRows.map(async row => {
            const cached = queryDataRef.current?.mistakes.find(item => item.id === row.id)
            const asset = await localDb.assets.get(assetKey(userId, String(row.id)))
            if (cached?.image_data || asset?.data_url) return { ...row, image_data: cached?.image_data ?? asset?.data_url, image_preview: cached?.image_data ?? asset?.data_url }
            if (typeof row.image_path === 'string' && row.image_path) {
              const { data: signed } = await cloud.storage.from('mistake-images').createSignedUrl(row.image_path, 3600)
              return { ...row, image_preview: signed?.signedUrl ?? null }
            }
            return row
          }))
        }
        await localDb.table(table).where('user_id').equals(userId).delete()
        if (rows.length) await localDb.table(table).bulkPut(rows as object[])
        for (const row of rows) Object.assign(next, updateOne(next, table, row))
      }
      if (!next.profile) {
        next.profile = { id: userId, user_id: userId, display_name: user?.displayName ?? '', email: user?.email ?? '', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }
        const { error } = await cloud.from('profiles').upsert(next.profile)
        if (error) throw error
        await localDb.profiles.put(next.profile)
      }
      const settingsRows = fetched.find(([table]) => table === 'app_settings')?.[1] ?? []
      if (!settingsRows.length) {
        next.settings = defaultSettings(userId, next.profile.display_name)
        const { error } = await cloud.from('app_settings').upsert(cleanForCloud(next.settings as unknown as Record<string, unknown>))
        if (error) throw error
        await localDb.app_settings.put(next.settings)
      }
      if (next.chapters.length === 0) {
        const initial = seedChapters(userId)
        const { error } = await cloud.from('chapters').upsert(initial)
        if (error) throw error
        await localDb.chapters.bulkPut(initial)
        next.chapters = initial
      }
      queryClient.setQueryData<AppData>(['stracker-data', userId], next)
      await updatePending()
      setSyncState('synced'); setSyncError(null)
    } catch (error) {
      const offline = isNetworkError(error)
      setSyncState(offline ? 'offline' : 'error')
      setSyncError(offline ? 'Offline — your changes are safely stored on this device and will sync when you reconnect.' : 'Could not sync with the cloud. Check your Supabase setup and retry.')
    }
  }, [userId, user, flushQueue, queryClient, updatePending])

  const finalizeDeleted = useCallback(async (entry: UndoEntry) => {
    const removedMistakes = [
      ...(entry.table === 'mistakes' ? [entry.record] : []),
      ...entry.related.filter(item => item.table === 'mistakes' && item.remove).map(item => item.record)
    ]
    if (!removedMistakes.length) return
    const cleanup: Omit<QueuedChange, 'queueId'>[] = []
    for (const mistake of removedMistakes) {
      const id = String(mistake.id)
      await localDb.assets.delete(assetKey(userId, id))
      const paths = [mistake.image_path, mistake.image_previous_path].filter((path): path is string => typeof path === 'string' && path.length > 0)
      if (paths.length && supabase && !user?.isLocal) cleanup.push({
        user_id: userId, table: 'mistakes', operation: 'delete', id,
        record: { id, user_id: userId, image_path: paths[0], image_previous_path: paths[1] }, queued_at: new Date().toISOString()
      })
    }
    if (cleanup.length) {
      try { await queueChanges(cleanup); void refresh() }
      catch {
        setSyncState('error')
        setSyncError('A deleted mistake image could not be queued for cleanup. Retry sync when ready.')
      }
    }
  }, [userId, user, queueChanges, refresh])

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const load = async () => {
      const result = await refetchLocal()
      if (cancelled) return
      if (user?.isLocal || !supabaseConfigured) {
        const cached = result.data ?? emptyData(userId)
        const now = new Date().toISOString()
        const profile = cached.profile ?? { id: userId, user_id: userId, display_name: user?.displayName ?? 'Study notebook', email: user?.email ?? '', created_at: now, updated_at: now }
        const settings = cached.settings ?? defaultSettings(userId, profile.display_name)
        const chapters = cached.chapters.length ? cached.chapters : seedChapters(userId)
        await Promise.all([
          localDb.profiles.put(profile), localDb.app_settings.put(settings),
          cached.chapters.length ? Promise.resolve() : localDb.chapters.bulkPut(chapters)
        ])
        queryClient.setQueryData<AppData>(['stracker-data', userId], { ...cached, profile, settings, chapters })
        setSyncState('local')
      } else void refresh()
    }
    void load()
    void updatePending()
    const onOnline = () => { void refresh() }
    const onOffline = () => { setSyncState('offline'); setSyncError('Offline — new edits will be queued on this device.') }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => { cancelled = true; window.removeEventListener('online', onOnline); window.removeEventListener('offline', onOffline) }
  }, [userId, user, refetchLocal, queryClient, refresh, updatePending])

  useEffect(() => {
    if (!undoAvailable) return
    if (undoTimeout.current) clearTimeout(undoTimeout.current)
    undoTimeout.current = setTimeout(() => {
      const expired = undoRef.current
      if (expired) void finalizeDeleted(expired)
      undoRef.current = null; setUndoAvailable(false)
    }, 8000)
    return () => { if (undoTimeout.current) clearTimeout(undoTimeout.current) }
  }, [undoAvailable, undoVersion, userId, finalizeDeleted])

  const upsertMany = useCallback(async <T extends TableName>(table: T, inputs: RecordFor<T>[]) => {
    if (!userId) throw new Error('Sign in to save changes.')
    if (!inputs.length) return
    let records = inputs.map(input => withOwner(table, input as unknown as Record<string, unknown>, userId))
    const localTables = table === 'mistakes' ? [localDb.table(table), localDb.assets] : [localDb.table(table)]
    await localDb.transaction('rw', localTables, async () => {
      await localDb.table(table).bulkPut(records as object[])
      if (table === 'mistakes') {
        await Promise.all(records.map(async record => {
          const id = String(record.id)
          if (typeof record.image_data === 'string' && record.image_data.startsWith('data:image/')) {
            await localDb.assets.put({ id: assetKey(userId, id), mistake_id: id, user_id: userId, data_url: record.image_data, updated_at: new Date().toISOString() })
          } else if (!record.image_path && !record.image_data) await localDb.assets.delete(assetKey(userId, id))
        }))
      }
    })
    setData(current => records.reduce((next, row) => updateOne(next, table, row), current))
    if (supabase && !user?.isLocal && navigator.onLine) {
      try {
        if (table === 'mistakes') {
          records = await Promise.all(records.map(row => uploadPendingImage(row, userId)))
          await localDb.table(table).bulkPut(records as object[])
          setData(current => records.reduce((next, row) => updateOne(next, table, row), current))
        }
        const { error } = await supabase.from(table).upsert(records.map(cleanForCloud))
        if (error) throw error
        if (table === 'mistakes') {
          records = await Promise.all(records.map(retirePreviousMistakeImage))
          await localDb.mistakes.bulkPut(records as unknown as Mistake[])
          setData(current => records.reduce((next, row) => updateOne(next, table, row), current))
        }
        await Promise.all(records.map(record => clearQueuedChange(userId, table, String(record.id))))
      } catch (error) {
        await queueChanges(records.map(record => ({ user_id: userId, table, operation: 'upsert', id: String(record.id), record, queued_at: new Date().toISOString() })))
        const offline = isNetworkError(error)
        setSyncState(offline ? 'offline' : 'error')
        setSyncError(offline ? 'Offline — the edit is saved here and will sync automatically.' : 'The edit is saved locally but could not reach the cloud. Retry sync when ready.')
        if (!offline) throw new Error('Saved on this device; cloud sync failed. Use Retry sync to try again.')
      }
    } else if (supabase && !user?.isLocal) {
      await queueChanges(records.map(record => ({ user_id: userId, table, operation: 'upsert', id: String(record.id), record, queued_at: new Date().toISOString() })))
      setSyncState('offline')
    } else setSyncState('local')
    await updatePending()
  }, [userId, user, setData, queueChanges, updatePending])

  const upsert = useCallback(async <T extends TableName>(table: T, record: RecordFor<T>) => upsertMany(table, [record]), [upsertMany])

  const mergeImportedData = useCallback(async (collections: ImportCollections) => {
    if (!userId) throw new Error('Sign in to import a backup.')
    const recordsByTable = new Map<TableName, Record<string, unknown>[]>()
    let sequence = 0
    for (const table of TABLES) {
      const inputs = collections[table] as RecordFor<typeof table>[] | undefined
      if (!inputs?.length) continue
      recordsByTable.set(table, inputs.map(input => withOwner(table, input as unknown as Record<string, unknown>, userId)))
    }
    const tables = TABLES.filter(table => recordsByTable.has(table))
    const stores = [...tables.map(table => localDb.table(table)), localDb.sync_queue, localDb.assets]
    await localDb.transaction('rw', stores, async () => {
      for (const table of tables) {
        const records = recordsByTable.get(table) ?? []
        await localDb.table(table).bulkPut(records as object[])
        if (table === 'mistakes') {
          for (const record of records) {
            const id = String(record.id)
            if (typeof record.image_data === 'string' && record.image_data.startsWith('data:image/')) {
              await localDb.assets.put({ id: assetKey(userId, id), mistake_id: id, user_id: userId, data_url: record.image_data, updated_at: new Date().toISOString() })
            } else if (!record.image_path && !record.image_data) await localDb.assets.delete(assetKey(userId, id))
          }
        }
        if (supabase && !user?.isLocal) {
          for (const record of records) {
            const id = String(record.id)
            await clearQueuedChange(userId, table, id)
            await localDb.sync_queue.add({
              user_id: userId, table, operation: 'upsert', id, record,
              queued_at: new Date(Date.now() + sequence++).toISOString()
            })
          }
        }
      }
    })
    setData(current => {
      let next = current
      for (const table of tables) {
        next = (recordsByTable.get(table) ?? []).reduce((value, row) => updateOne(value, table, row), next)
      }
      return next
    })
    if (supabase && !user?.isLocal) {
      if (navigator.onLine) { setSyncState('syncing'); setSyncError(null); void refresh() }
      else { setSyncState('offline'); setSyncError('Imported records are safe on this device and will sync when you reconnect.') }
    } else setSyncState('local')
    await updatePending()
  }, [userId, user, setData, refresh, updatePending])

  const remove = useCallback(async <T extends TableName>(table: T, input: RecordFor<T>, options: { undo?: boolean } = {}) => {
    if (!userId) throw new Error('Sign in to remove records.')
    const record: Record<string, unknown> = { ...(input as unknown as Record<string, unknown>), user_id: userId }
    const id = String(record.id)
    const previousData = queryDataRef.current ?? emptyData(userId)
    const relatedChanges = relatedRowsForRemoval(previousData, table, id)
    const entry: UndoEntry = {
      table, record,
      related: relatedChanges.map(change => ({ table: change.table, record: change.record, remove: change.next === null })),
      expiresAt: Date.now() + 8000
    }
    const localTables = [...new Set([localDb.table(table), ...relatedChanges.map(change => localDb.table(change.table)), localDb.sync_queue])]
    await localDb.transaction('rw', localTables, async () => {
      await localDb.table(table).delete(id)
      for (const change of relatedChanges) {
        await clearQueuedChange(userId, change.table, String(change.record.id))
        if (change.next) await localDb.table(change.table).put(change.next as object)
        else await localDb.table(change.table).delete(String(change.record.id))
      }
      await clearQueuedChange(userId, table, id)
    })
    setData(current => {
      let next = replaceRows(current, table, rowsFor(current, table).filter(row => row.id !== id))
      for (const change of relatedChanges) {
        if (change.next) next = updateOne(next, change.table, change.next)
        else next = replaceRows(next, change.table, rowsFor(next, change.table).filter(row => row.id !== change.record.id))
      }
      return next
    })

    if (options.undo !== false) {
      const previousUndo = undoRef.current
      if (previousUndo) void finalizeDeleted(previousUndo)
      if (undoTimeout.current) clearTimeout(undoTimeout.current)
      undoRef.current = entry
      setUndoVersion(version => version + 1)
      setUndoAvailable(true)
    }

    const imageQueueRecord = table === 'mistakes' ? {
      id, user_id: userId, image_path: record.image_path, image_previous_path: record.image_previous_path
    } : undefined
    if (supabase && !user?.isLocal && navigator.onLine) {
      const { error } = await supabase.from(table).delete().eq('id', id).eq('user_id', userId)
      if (error) {
        await queueChanges([{ user_id: userId, table, operation: 'delete', id, record: imageQueueRecord, queued_at: new Date().toISOString() }])
        setSyncState(isNetworkError(error) ? 'offline' : 'error')
        setSyncError(isNetworkError(error) ? 'Offline — deletion will sync when you reconnect.' : 'Deletion is pending sync. Retry when ready.')
      }
    } else if (supabase && !user?.isLocal) {
      await queueChanges([{ user_id: userId, table, operation: 'delete', id, record: imageQueueRecord, queued_at: new Date().toISOString() }])
      setSyncState('offline')
    } else setSyncState('local')

    if (options.undo === false) await finalizeDeleted(entry)
    await updatePending()
  }, [userId, user, setData, queueChanges, updatePending, finalizeDeleted])

  const undoDelete = useCallback(async () => {
    const entry = undoRef.current
    if (!entry || Date.now() > entry.expiresAt) return
    if (undoTimeout.current) clearTimeout(undoTimeout.current)
    undoTimeout.current = null
    undoRef.current = null

    const now = new Date().toISOString()
    const restores: { table: TableName; record: Record<string, unknown> }[] = [
      { table: entry.table, record: { ...entry.record, updated_at: now } },
      ...entry.related.map(item => ({ table: item.table, record: { ...item.record, updated_at: now } }))
    ]
    const localTables = [...new Set([...restores.map(item => localDb.table(item.table)), localDb.sync_queue])]
    try {
      await localDb.transaction('rw', localTables, async () => {
        for (const restore of restores) {
          await clearQueuedChange(userId, restore.table, String(restore.record.id))
          await localDb.table(restore.table).put(restore.record as object)
        }
      })
    } catch (error) {
      entry.expiresAt = Date.now() + 8000
      undoRef.current = entry
      setUndoVersion(version => version + 1)
      setUndoAvailable(true)
      throw error
    }
    setData(current => restores.reduce((next, restore) => updateOne(next, restore.table, restore.record), current))
    setUndoAvailable(false)

    for (const restore of restores) {
      const id = String(restore.record.id)
      if (!supabase || user?.isLocal) continue
      let prepared = restore.record
      if (navigator.onLine) {
        try {
          if (restore.table === 'mistakes') {
            prepared = await uploadPendingImage(prepared, userId)
            if (prepared !== restore.record) {
              await localDb.mistakes.put(prepared as unknown as Mistake)
              setData(current => updateOne(current, 'mistakes', prepared))
            }
          }
          const { error } = await supabase.from(restore.table).upsert(cleanForCloud(prepared))
          if (error) throw error
          if (restore.table === 'mistakes' && 'image_previous_path' in prepared) {
            const cleaned = await retirePreviousMistakeImage(prepared)
            await localDb.mistakes.put(cleaned as unknown as Mistake)
            setData(current => updateOne(current, 'mistakes', cleaned))
          }
        } catch (error) {
          try {
            await queueChanges([{ user_id: userId, table: restore.table, operation: 'upsert', id, record: prepared, queued_at: new Date().toISOString() }])
            setSyncState(isNetworkError(error) ? 'offline' : 'error')
            setSyncError('Undo is restored on this device; cloud sync is queued for retry.')
          } catch {
            setSyncState('error')
            setSyncError('The undo is restored on this device, but could not be queued for cloud sync.')
          }
        }
      } else {
        await queueChanges([{ user_id: userId, table: restore.table, operation: 'upsert', id, record: prepared, queued_at: new Date().toISOString() }])
      }
    }
    await updatePending()
  }, [user, userId, setData, queueChanges, updatePending])

  const dismissUndo = useCallback(() => {
    if (undoTimeout.current) clearTimeout(undoTimeout.current)
    const dismissed = undoRef.current
    if (dismissed) void finalizeDeleted(dismissed)
    undoRef.current = null; setUndoAvailable(false)
  }, [finalizeDeleted])

  const saveImage = useCallback(async (file: File) => {
    if (!userId) throw new Error('Sign in to upload an image.')
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 10 * 1024 * 1024) throw new Error('Choose a JPG, PNG, or WebP image under 10 MB.')
    const dataUrl = await compressImage(file)
    return { path: null, dataUrl }
  }, [userId])

  const data = queryData ?? emptyData(userId)
  const value = useMemo<DataContextValue>(() => ({
    data, loading: query.isLoading, syncState, pendingCount, syncError, refresh,
    upsert, upsertMany, mergeImportedData, remove, undoDelete, undoAvailable, dismissUndo, saveImage
  }), [data, query.isLoading, syncState, pendingCount, syncError, refresh, upsert, upsertMany, mergeImportedData, remove, undoDelete, undoAvailable, dismissUndo, saveImage])
  if (!user) return <>{children}</>
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

async function compressImage(file: File): Promise<string> {
  const source = await new Promise<HTMLImageElement>((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => { URL.revokeObjectURL(url); resolve(image) }
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image could not be opened.')) }
    image.src = url
  })
  const scale = Math.min(1, 1600 / Math.max(source.width, source.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * scale))
  canvas.height = Math.max(1, Math.round(source.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Image compression is unavailable in this browser.')
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/webp', 0.78)
}

export function useData(): DataContextValue {
  const context = useContext(DataContext)
  if (!context) throw new Error('useData must be used inside DataProvider')
  return context
}
