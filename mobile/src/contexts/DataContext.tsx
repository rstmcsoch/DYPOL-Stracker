import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AppState, type AppStateStatus } from 'react-native'
import NetInfo from '@react-native-community/netinfo'
import type { AppData, RecordFor, TableName } from '../shared/types'
import { supabase } from '../lib/supabase'
import { getLocalStore } from '../lib/local-db/store-instance'
import { supabaseCloud } from '../lib/sync/cloud'
import { DataEngine, type SyncState } from '../lib/sync/engine'
import { emptyData } from '../lib/sync/helpers'
import { useAuth } from './AuthContext'

type CollectionsInput = Parameters<DataEngine['mergeImportedData']>[0]

export interface DataContextValue {
  data: AppData
  loading: boolean
  syncState: SyncState
  pendingCount: number
  syncError: string | null
  refresh: () => Promise<void>
  upsert: <T extends TableName>(table: T, record: RecordFor<T>) => Promise<void>
  upsertMany: <T extends TableName>(table: T, records: RecordFor<T>[]) => Promise<void>
  mergeImportedData: (collections: CollectionsInput) => Promise<void>
  remove: <T extends TableName>(table: T, record: RecordFor<T>, options?: { undo?: boolean }) => Promise<void>
  undoDelete: () => Promise<void>
  undoAvailable: boolean
  dismissUndo: () => Promise<void>
  /** Erases the owner's cloud and device study data. Needs a connection. */
  resetAccount: () => Promise<void>
}

const DataContext = createContext<DataContextValue | null>(null)

/**
 * React binding for the offline sync engine. The engine owns every read and write of the cache and
 * the cloud; this provider only publishes its state. One engine exists per signed-in account.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? null
  const profileName = user?.displayName || 'Study notebook'
  const profileEmail = user?.email ?? ''
  const [engine, setEngine] = useState<DataEngine | null>(null)
  const [data, setData] = useState<AppData | null>(null)
  const [syncState, setSyncState] = useState<SyncState>('loading')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [undoAvailable, setUndoAvailable] = useState(false)
  const onlineRef = useRef(true)
  const profileRef = useRef({ profileName, profileEmail })
  useEffect(() => {
    profileRef.current = { profileName, profileEmail }
  }, [profileName, profileEmail])

  // Each account starts in the loading state; the reset happens during render when the account changes.
  const [syncUserId, setSyncUserId] = useState(userId)
  if (syncUserId !== userId) {
    setSyncUserId(userId)
    setSyncState('loading')
  }

  useEffect(() => {
    if (!userId || !supabase) return
    let cancelled = false
    let created: DataEngine | null = null
    void (async () => {
      const store = await getLocalStore()
      if (cancelled) return
      const instance = new DataEngine({
        store,
        cloud: supabaseCloud(supabase),
        userId,
        profileDefaults: { displayName: profileRef.current.profileName, email: profileRef.current.profileEmail },
        isOnline: () => onlineRef.current,
        listener: {
          onData: next => { if (!cancelled) setData(next) },
          onSync: (state, error, pending) => {
            if (cancelled) return
            setSyncState(state)
            setSyncError(error)
            setPendingCount(pending)
          },
          onUndo: available => { if (!cancelled) setUndoAvailable(available) }
        }
      })
      created = instance
      setEngine(instance)
      await instance.start()
    })().catch(error => {
      if (!cancelled) {
        setSyncState('error')
        setSyncError(error instanceof Error ? error.message : 'The on-device notebook could not be opened.')
      }
    })
    return () => {
      cancelled = true
      created?.dispose()
      setEngine(null)
      setData(null)
      setUndoAvailable(false)
    }
  }, [userId])

  // Connectivity: a change to online triggers a sync, and going offline is shown immediately.
  useEffect(() => {
    if (!engine) return undefined
    const unsubscribe = NetInfo.addEventListener(state => {
      const online = Boolean(state.isConnected) && state.isInternetReachable !== false
      const previous = onlineRef.current
      onlineRef.current = online
      if (online !== previous) void engine.networkChanged(online)
    })
    return unsubscribe
  }, [engine])

  // Returning to the foreground pulls changes made on another device.
  useEffect(() => {
    if (!engine) return undefined
    const subscription = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active' && onlineRef.current) void engine.refresh()
    })
    return () => subscription.remove()
  }, [engine])

  const requireEngine = useCallback((): DataEngine => {
    if (!engine) throw new Error('Sign in to save changes.')
    return engine
  }, [engine])

  const value = useMemo<DataContextValue>(() => ({
    data: data ?? emptyData(userId ?? ''),
    loading: data === null,
    syncState,
    pendingCount,
    syncError,
    undoAvailable,
    refresh: async () => { if (engine) await engine.refresh() },
    upsert: (table, record) => requireEngine().upsert(table, record),
    upsertMany: (table, records) => requireEngine().upsertMany(table, records),
    mergeImportedData: collections => requireEngine().mergeImportedData(collections),
    remove: (table, record, options) => requireEngine().remove(table, record, options),
    resetAccount: () => requireEngine().resetAccount(),
    undoDelete: () => requireEngine().undoDelete(),
    dismissUndo: () => requireEngine().dismissUndo()
  }), [data, userId, syncState, pendingCount, syncError, undoAvailable, engine, requireEngine])

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>
}

export function useData(): DataContextValue {
  const context = useContext(DataContext)
  if (!context) throw new Error('useData must be used inside DataProvider')
  return context
}
