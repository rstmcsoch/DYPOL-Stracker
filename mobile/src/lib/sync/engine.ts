import type { AppData, QueuedChange, RecordFor, TableName } from '../../shared/types'
import { createId } from '../../shared/lib/id'
import { normalizeSettings, defaultExamTracks, defaultSettings, seedChapters } from '../../shared/lib/defaults'
import { relatedRowsForRemoval } from '../../shared/lib/data-relations'
import { validatePersistedRecords, validateUndoRestores } from '../../shared/lib/record-validation'
import { dataUrlToBytes } from '../images'
import type { LocalStore } from '../local-db/types'
import { SYNC_TABLES } from '../local-db/tables'
import { clearLocalUserData } from '../local-db/clear'
import type { CloudClient } from './cloud'
import {
  assetKey, cleanForCloud, emptyData, isNetworkError, queuedUpsert, readLocal, removeOne, replaceRows,
  rowsFor, SIGNED_IMAGE_SECONDS, UNDO_WINDOW_MS, updateOne, withOwner
} from './helpers'

/**
 * Offline-first synchronisation for Stracker, shared by the app and its tests.
 *
 * Model (the same as the website's DataContext):
 * - Every change is written to the on-device cache first, so the UI never waits on the network.
 * - When the cloud is reachable the change is upserted immediately. When it is not, the change is
 *   queued (one queue entry per record, the latest write wins) and flushed on the next sync.
 * - Conflicts are resolved by last-write-wins on `updated_at`: a newer remote row replaces the local
 *   one during a flush, and an older remote row is overwritten by the queued local change.
 * - Pulls rebuild the cache from the cloud. Seeded chapters and exam tracks are written only when the
 *   cloud has none, and their IDs are deterministic (`stableId`), so a repeated seed can never create
 *   a second copy of a chapter.
 * - Deletes are reversible for 8 seconds. The photo cleanup that goes with a delete is deferred until
 *   the undo window closes.
 *
 * Writes are serialised through one mutex, because the SQLite transactions beneath must not overlap.
 */

export type SyncState = 'loading' | 'syncing' | 'synced' | 'offline' | 'local' | 'error'

export interface EngineListener {
  onData(data: AppData): void
  onSync(state: SyncState, error: string | null, pendingCount: number): void
  onUndo(available: boolean): void
}

export interface EngineOptions {
  store: LocalStore
  cloud: CloudClient
  userId: string
  profileDefaults: { displayName: string; email: string }
  listener: EngineListener
  isOnline: () => boolean
  now?: () => string
  newId?: () => string
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

interface RelatedUndoEntry { table: TableName; record: Record<string, unknown>; remove: boolean }
interface UndoEntry { table: TableName; record: Record<string, unknown>; related: RelatedUndoEntry[]; expiresAt: number }
type CollectionsInput = Partial<{ [T in TableName]: RecordFor<T>[] }>

const ONLINE_ONLY_MESSAGE = 'Offline — showing your previously saved notebook.'

/**
 * Children are erased before parents, so foreign-key references never block a delete. Every
 * synced table is included; any table missing from this list is appended so nothing is left behind.
 */
const RESET_DELETE_ORDER: TableName[] = [
  'mistakes', 'test_chapter_links', 'test_subject_scores', 'test_error_logs', 'test_time_entries',
  'chapter_revisions', 'chapter_stages', 'pyq_records', 'practice_sessions', 'study_cards', 'backlog_items',
  'study_sessions', 'daily_tasks', 'weekly_goals', 'tests', 'user_exam_tracks', 'chapters', 'app_settings', 'profiles'
]

export class DataEngine {
  private data: AppData
  private syncState: SyncState = 'loading'
  private syncError: string | null = null
  private pendingCount = 0
  private undo: UndoEntry | null = null
  private undoHandle: unknown = null
  private disposed = false
  private tail: Promise<unknown> = Promise.resolve()
  private readonly now: () => string
  private readonly newId: () => string
  private readonly setTimer: (callback: () => void, ms: number) => unknown
  private readonly clearTimer: (handle: unknown) => void

  constructor(private readonly options: EngineOptions) {
    this.data = emptyData(options.userId)
    this.now = options.now ?? (() => this.now())
    this.newId = options.newId ?? createId
    this.setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms))
    this.clearTimer = options.clearTimer ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  get userId(): string {
    return this.options.userId
  }

  getData(): AppData {
    return this.data
  }

  /** Loads the cache, reports the queue depth, then syncs when the network allows. */
  start(): Promise<void> {
    return this.exclusive(async () => {
      this.data = await readLocal(this.options.store, this.options.userId)
      this.emitData()
      await this.refreshPendingCount()
      await this.refreshInternal()
    })
  }

  dispose(): void {
    this.disposed = true
    if (this.undoHandle !== null) this.clearTimer(this.undoHandle)
    this.undoHandle = null
    this.undo = null
  }

  /** Called by the platform layer when connectivity changes. */
  networkChanged(online: boolean): Promise<void> {
    if (!online) {
      this.setSync('offline', 'Offline — new edits will be queued on this device.')
      return Promise.resolve()
    }
    return this.refresh()
  }

  refresh(): Promise<void> {
    return this.exclusive(() => this.refreshInternal())
  }

  upsert<T extends TableName>(table: T, record: RecordFor<T>): Promise<void> {
    return this.upsertMany(table, [record])
  }

  upsertMany<T extends TableName>(table: T, inputs: RecordFor<T>[]): Promise<void> {
    return this.exclusive(() => this.upsertInternal(table, inputs))
  }

  mergeImportedData(collections: CollectionsInput): Promise<void> {
    return this.exclusive(() => this.mergeInternal(collections))
  }

  remove<T extends TableName>(table: T, input: RecordFor<T>, options: { undo?: boolean } = {}): Promise<void> {
    return this.exclusive(() => this.removeInternal(table, input, options))
  }

  undoDelete(): Promise<void> {
    return this.exclusive(() => this.undoInternal())
  }

  dismissUndo(): Promise<void> {
    return this.exclusive(() => this.expireUndoInternal())
  }

  /**
   * Erases this owner's study data everywhere: cloud rows and mistake photos first, then this device's
   * cache, queue, and photos. The cloud erase runs first and stops at the first failure, so the local
   * copy is never cleared while cloud data may still exist. Needs a connection.
   */
  resetAccount(): Promise<void> {
    return this.exclusive(async () => {
      if (!this.online) {
        throw new Error('Reset needs a connection, so the cloud copy can be erased first. Your data is unchanged.')
      }
      const { cloud, userId, store } = this.options
      const paths = await cloud.listImagePaths(userId)
      if (paths.length) await cloud.removeImages(paths)
      const order = [...RESET_DELETE_ORDER, ...SYNC_TABLES.filter(table => !RESET_DELETE_ORDER.includes(table))]
      for (const table of order) await cloud.deleteOwnerRows(table, userId)
      await clearLocalUserData(store, userId)
      this.clearUndoTimer()
      this.undo = null
      this.data = emptyData(userId)
      this.emitData()
      this.options.listener.onUndo(false)
    })
  }

  // ------------------------------------------------------------------ internals

  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.tail.then(task, task)
    this.tail = run.catch(() => undefined)
    return run
  }

  private get online(): boolean {
    return this.options.isOnline()
  }

  private emitData(): void {
    if (!this.disposed) this.options.listener.onData(this.data)
  }

  private setData(update: (current: AppData) => AppData): void {
    this.data = update(this.data)
    this.emitData()
  }

  private setSync(state: SyncState, error: string | null): void {
    this.syncState = state
    this.syncError = error
    if (!this.disposed) this.options.listener.onSync(state, error, this.pendingCount)
  }

  private async refreshPendingCount(): Promise<void> {
    this.pendingCount = await this.options.store.countQueue(this.options.userId)
  }

  private async updatePending(): Promise<void> {
    await this.refreshPendingCount()
    if (!this.disposed) this.options.listener.onSync(this.syncState, this.syncError, this.pendingCount)
  }

  private async queueChanges(changes: Omit<QueuedChange, 'queueId'>[]): Promise<void> {
    for (const change of changes) {
      await this.options.store.deleteQueueFor(this.options.userId, change.table, change.id)
      await this.options.store.addQueue(change)
    }
    await this.updatePending()
  }

  private async flushInternal(): Promise<boolean> {
    const { store, cloud, userId } = this.options
    if (!this.online) return false
    this.setSync('syncing', null)
    try {
      const changes = await store.listQueue(userId)
      for (const change of changes) {
        if (change.operation === 'delete') {
          await cloud.remove(change.table, change.id, userId)
          if (change.table === 'mistakes') {
            const paths = [change.record?.image_path, change.record?.image_previous_path]
              .filter((path): path is string => typeof path === 'string' && path.length > 0)
            const unique = [...new Set(paths)]
            if (unique.length) await cloud.removeImages(unique)
          }
        } else if (change.record) {
          const remote = await cloud.selectById(change.table, change.id, userId)
          const localTime = String(change.record.updated_at ?? change.queued_at)
          const remoteTime = typeof remote?.updated_at === 'string' ? remote.updated_at : ''
          if (remote && remoteTime > localTime) {
            // Last-write-wins: the newer remote row replaces the queued local change.
            const normalized = (change.table === 'app_settings' ? normalizeSettings(remote, userId) : remote) as unknown as Record<string, unknown>
            await store.putRows(change.table, [normalized])
            this.setData(current => updateOne(current, change.table, normalized))
          } else {
            const prepared = change.table === 'mistakes' ? await this.uploadPendingImage(change.record) : change.record
            if (prepared !== change.record) {
              change.record = prepared
              await store.putRows(change.table, [prepared])
              if (change.queueId !== undefined) await store.updateQueue(change.queueId, change)
              this.setData(current => updateOne(current, change.table, prepared))
            }
            await cloud.upsert(change.table, [cleanForCloud(prepared)])
            if (change.table === 'mistakes' && 'image_previous_path' in prepared) {
              const cleaned = await this.retirePreviousImage(prepared)
              await store.putRows('mistakes', [cleaned])
              this.setData(current => updateOne(current, 'mistakes', cleaned))
            }
          }
        }
        if (change.queueId !== undefined) await store.deleteQueue(change.queueId)
      }
      await this.updatePending()
      this.setSync('synced', null)
      return true
    } catch (error) {
      const offline = isNetworkError(error, this.online)
      this.setSync(offline ? 'offline' : 'error', offline
        ? 'Offline — your changes are safely queued on this device.'
        : 'Some changes could not sync. Your local copy is safe; retry when ready.')
      return false
    }
  }

  private async refreshInternal(): Promise<void> {
    const { store, cloud, userId } = this.options
    if (!this.online) {
      this.setSync('offline', ONLINE_ONLY_MESSAGE)
      return
    }
    this.setSync('syncing', null)
    try {
      const flushed = await this.flushInternal()
      if (!flushed) return

      const fetched = await Promise.all(SYNC_TABLES.map(async table => {
        const rows = await cloud.selectAll(table, userId)
        return [table, rows] as const
      }))

      const prepared: [TableName, Record<string, unknown>[]][] = []
      for (const [table, rawRows] of fetched) {
        let rows = table === 'app_settings' ? rawRows.map(row => normalizeSettings(row, userId) as unknown as Record<string, unknown>) : rawRows
        if (table === 'mistakes') {
          rows = await Promise.all(rawRows.map(async row => {
            const cached = this.data.mistakes.find(item => item.id === row.id)
            const asset = await store.getAsset(assetKey(userId, String(row.id)))
            const localPhoto = cached?.image_data ?? asset?.data_url
            if (localPhoto) return { ...row, image_data: localPhoto, image_preview: localPhoto }
            if (typeof row.image_path === 'string' && row.image_path) {
              const signed = await cloud.signedImageUrl(row.image_path, SIGNED_IMAGE_SECONDS)
              return { ...row, image_preview: signed }
            }
            return row
          }))
        }
        prepared.push([table, rows])
      }

      const next = emptyData(userId)
      let nextData: AppData = next
      for (const [table, rows] of prepared) nextData = replaceRows(nextData, table, rows)
      // The profile row is created on first sign-in, when the trigger has not produced one.
      if (!nextData.profile) {
        const now = this.now()
        const profile = {
          id: userId, user_id: userId,
          display_name: this.options.profileDefaults.displayName,
          email: this.options.profileDefaults.email,
          created_at: now, updated_at: now
        }
        await cloud.upsert('profiles', [profile])
        nextData = { ...nextData, profile: profile as unknown as AppData['profile'] }
      }
      const settingsRows = fetched.find(([table]) => table === 'app_settings')?.[1] ?? []
      if (!settingsRows.length) {
        const settings = defaultSettings(userId, nextData.profile?.display_name ?? '')
        await cloud.upsert('app_settings', [cleanForCloud(settings as unknown as Record<string, unknown>)])
        nextData = { ...nextData, settings }
      }
      if (nextData.chapters.length === 0) {
        const initial = seedChapters(userId)
        await cloud.upsert('chapters', initial as unknown as Record<string, unknown>[])
        nextData = { ...nextData, chapters: initial }
      }
      if (nextData.examTracks.length === 0) {
        const tracks = defaultExamTracks(userId)
        await cloud.upsert('user_exam_tracks', tracks as unknown as Record<string, unknown>[])
        nextData = { ...nextData, examTracks: tracks }
      }

      // Local rewrite happens last and in one transaction, so an interrupted pull never leaves the
      // cache half-replaced.
      await store.transaction(async () => {
        for (const table of SYNC_TABLES) {
          await store.clearRows(table, userId)
          const rows = rowsFor(nextData, table) as Record<string, unknown>[]
          if (rows.length) await store.putRows(table, rows)
        }
      })
      this.data = nextData
      this.emitData()
      await this.updatePending()
      this.setSync('synced', null)
    } catch (error) {
      const offline = isNetworkError(error, this.online)
      this.setSync(offline ? 'offline' : 'error', offline
        ? 'Offline — your changes are safely stored on this device and will sync when you reconnect.'
        : 'Could not sync with the cloud. Check your Supabase setup and retry.')
    }
  }

  private async upsertInternal<T extends TableName>(table: T, inputs: RecordFor<T>[]): Promise<void> {
    const { store, cloud, userId } = this.options
    if (!inputs.length) return
    const now = this.now()
    let records = inputs.map(input => withOwner(table, input as unknown as Record<string, unknown>, userId, now))
    validatePersistedRecords(table, records)

    await store.transaction(async () => {
      await store.putRows(table, records)
      if (table === 'mistakes') {
        for (const record of records) {
          const id = String(record.id)
          if (typeof record.image_data === 'string' && record.image_data.startsWith('data:image/')) {
            await store.putAsset({ id: assetKey(userId, id), mistake_id: id, user_id: userId, data_url: record.image_data, updated_at: now })
          } else if (!record.image_path && !record.image_data) {
            await store.deleteAsset(assetKey(userId, id))
          }
        }
      }
    })
    this.setData(current => records.reduce((next, row) => updateOne(next, table, row), current))

    if (this.online) {
      try {
        if (table === 'mistakes') {
          records = await Promise.all(records.map(row => this.uploadPendingImage(row)))
          await store.putRows(table, records)
          this.setData(current => records.reduce((next, row) => updateOne(next, table, row), current))
        }
        await cloud.upsert(table, records.map(cleanForCloud))
        if (table === 'mistakes') {
          records = await Promise.all(records.map(row => this.retirePreviousImage(row)))
          await store.putRows(table, records)
          this.setData(current => records.reduce((next, row) => updateOne(next, table, row), current))
        }
        for (const record of records) await store.deleteQueueFor(userId, table, String(record.id))
      } catch (error) {
        await this.queueChanges(records.map(record => queuedUpsert(userId, table, String(record.id), record, this.now())))
        const offline = isNetworkError(error, this.online)
        this.setSync(offline ? 'offline' : 'error', offline
          ? 'Offline — the edit is saved here and will sync automatically.'
          : 'The edit is saved locally but could not reach the cloud. Retry sync when ready.')
        if (!offline) throw new Error('Saved on this device; cloud sync failed. Use Retry sync to try again.')
      }
    } else {
      await this.queueChanges(records.map(record => queuedUpsert(userId, table, String(record.id), record, this.now())))
      this.setSync('offline', 'Offline — the edit is saved here and will sync automatically.')
    }
    await this.updatePending()
  }

  private async mergeInternal(collections: CollectionsInput): Promise<void> {
    const { store, userId } = this.options
    const now = this.now()
    const recordsByTable = new Map<TableName, Record<string, unknown>[]>()
    for (const table of SYNC_TABLES) {
      const inputs = collections[table] as RecordFor<typeof table>[] | undefined
      if (!inputs?.length) continue
      recordsByTable.set(table, inputs.map(input => withOwner(table, input as unknown as Record<string, unknown>, userId, now)))
    }
    const tables = SYNC_TABLES.filter(table => recordsByTable.has(table))
    for (const table of tables) validatePersistedRecords(table, recordsByTable.get(table) ?? [])

    let sequence = 0
    const queued: Omit<QueuedChange, 'queueId'>[] = []
    await store.transaction(async () => {
      for (const table of tables) {
        const records = recordsByTable.get(table) ?? []
        await store.putRows(table, records)
        if (table === 'mistakes') {
          for (const record of records) {
            const id = String(record.id)
            if (typeof record.image_data === 'string' && record.image_data.startsWith('data:image/')) {
              await store.putAsset({ id: assetKey(userId, id), mistake_id: id, user_id: userId, data_url: record.image_data, updated_at: now })
            } else if (!record.image_path && !record.image_data) {
              await store.deleteAsset(assetKey(userId, id))
            }
          }
        }
        for (const record of records) {
          const id = String(record.id)
          await store.deleteQueueFor(userId, table, id)
          // Sequence offsets keep the imported rows in import order when they are flushed.
          queued.push({ user_id: userId, table, operation: 'upsert', id, record, queued_at: new Date(Date.now() + sequence++).toISOString() })
        }
      }
      for (const change of queued) await store.addQueue(change)
    })
    this.setData(current => {
      let next = current
      for (const table of tables) {
        next = (recordsByTable.get(table) ?? []).reduce((value, row) => updateOne(value, table, row), next)
      }
      return next
    })
    if (this.online) {
      this.setSync('syncing', null)
      // Not awaited: the refresh queues behind this mutation on the same lock.
      void this.refresh()
    } else {
      this.setSync('offline', 'Imported records are safe on this device and will sync when you reconnect.')
    }
    await this.updatePending()
  }

  private async removeInternal<T extends TableName>(table: T, input: RecordFor<T>, options: { undo?: boolean }): Promise<void> {
    const { store, cloud, userId } = this.options
    const record: Record<string, unknown> = { ...(input as unknown as Record<string, unknown>), user_id: userId }
    const id = String(record.id)
    const relatedChanges = relatedRowsForRemoval(this.data, table, id)
    if (options.undo !== false) {
      validateUndoRestores([
        { table, record },
        ...relatedChanges.map(change => ({ table: change.table, record: change.record }))
      ])
    }
    const entry: UndoEntry = {
      table,
      record,
      related: relatedChanges.map(change => ({ table: change.table, record: change.record, remove: change.next === null })),
      expiresAt: Date.now() + UNDO_WINDOW_MS
    }
    await store.transaction(async () => {
      await store.deleteRow(table, id)
      for (const change of relatedChanges) {
        await store.deleteQueueFor(userId, change.table, String(change.record.id))
        if (change.next) await store.putRows(change.table, [change.next])
        else await store.deleteRow(change.table, String(change.record.id))
      }
      await store.deleteQueueFor(userId, table, id)
    })
    this.setData(current => {
      let next = removeOne(current, table, id)
      for (const change of relatedChanges) {
        if (change.next) next = updateOne(next, change.table, change.next)
        else next = removeOne(next, change.table, String(change.record.id))
      }
      return next
    })

    if (options.undo !== false) {
      const previous = this.undo
      if (previous) await this.finalizeDeleted(previous)
      this.clearUndoTimer()
      this.undo = entry
      this.options.listener.onUndo(true)
      this.undoHandle = this.setTimer(() => { void this.exclusive(() => this.expireUndoInternal()) }, UNDO_WINDOW_MS)
    }

    const imageQueueRecord = table === 'mistakes'
      ? { id, user_id: userId, image_path: record.image_path, image_previous_path: record.image_previous_path }
      : undefined
    if (this.online) {
      try {
        await cloud.remove(table, id, userId)
      } catch (error) {
        const offline = isNetworkError(error, this.online)
        await this.queueChanges([{ user_id: userId, table, operation: 'delete', id, record: imageQueueRecord, queued_at: this.now() }])
        this.setSync(offline ? 'offline' : 'error', offline
          ? 'Offline — deletion will sync when you reconnect.'
          : 'Deletion is pending sync. Retry when ready.')
      }
    } else {
      await this.queueChanges([{ user_id: userId, table, operation: 'delete', id, record: imageQueueRecord, queued_at: this.now() }])
      this.setSync('offline', 'Offline — deletion will sync when you reconnect.')
    }

    if (options.undo === false) await this.finalizeDeleted(entry)
    await this.updatePending()
  }

  private async undoInternal(): Promise<void> {
    const { store, cloud, userId } = this.options
    const entry = this.undo
    if (!entry || Date.now() > entry.expiresAt) return
    this.clearUndoTimer()
    this.undo = null

    const now = this.now()
    const restores: { table: TableName; record: Record<string, unknown> }[] = [
      { table: entry.table, record: { ...entry.record, updated_at: now } },
      ...entry.related.map(item => ({ table: item.table, record: { ...item.record, updated_at: now } }))
    ]
    try {
      await store.transaction(async () => {
        for (const restore of restores) {
          await store.deleteQueueFor(userId, restore.table, String(restore.record.id))
          await store.putRows(restore.table, [restore.record])
        }
      })
    } catch (error) {
      this.undo = { ...entry, expiresAt: Date.now() + UNDO_WINDOW_MS }
      this.options.listener.onUndo(true)
      throw error
    }
    this.setData(current => restores.reduce((next, restore) => updateOne(next, restore.table, restore.record), current))
    this.options.listener.onUndo(false)

    for (const restore of restores) {
      const id = String(restore.record.id)
      let prepared = restore.record
      if (this.online) {
        try {
          if (restore.table === 'mistakes') {
            prepared = await this.uploadPendingImage(prepared)
            if (prepared !== restore.record) {
              await store.putRows('mistakes', [prepared])
              this.setData(current => updateOne(current, 'mistakes', prepared))
            }
          }
          await cloud.upsert(restore.table, [cleanForCloud(prepared)])
          if (restore.table === 'mistakes' && 'image_previous_path' in prepared) {
            const cleaned = await this.retirePreviousImage(prepared)
            await store.putRows('mistakes', [cleaned])
            this.setData(current => updateOne(current, 'mistakes', cleaned))
          }
        } catch (error) {
          try {
            await this.queueChanges([{ user_id: userId, table: restore.table, operation: 'upsert', id, record: prepared, queued_at: this.now() }])
            const offline = isNetworkError(error, this.online)
            this.setSync(offline ? 'offline' : 'error', 'Undo is restored on this device; cloud sync is queued for retry.')
          } catch {
            this.setSync('error', 'The undo is restored on this device, but could not be queued for cloud sync.')
          }
        }
      } else {
        await this.queueChanges([{ user_id: userId, table: restore.table, operation: 'upsert', id, record: prepared, queued_at: this.now() }])
      }
    }
    await this.updatePending()
  }

  private async expireUndoInternal(): Promise<void> {
    this.clearUndoTimer()
    const expired = this.undo
    this.undo = null
    this.options.listener.onUndo(false)
    if (expired) await this.finalizeDeleted(expired)
  }

  /** Deferred cleanup for a delete that will not be undone: remove deleted photos from the bucket. */
  private async finalizeDeleted(entry: UndoEntry): Promise<void> {
    const { store, userId } = this.options
    const removedMistakes = [
      ...(entry.table === 'mistakes' ? [entry.record] : []),
      ...entry.related.filter(item => item.table === 'mistakes' && item.remove).map(item => item.record)
    ]
    if (!removedMistakes.length) return
    const cleanup: Omit<QueuedChange, 'queueId'>[] = []
    for (const mistake of removedMistakes) {
      const id = String(mistake.id)
      await store.deleteAsset(assetKey(userId, id))
      const paths = [mistake.image_path, mistake.image_previous_path]
        .filter((path): path is string => typeof path === 'string' && path.length > 0)
      if (paths.length) {
        cleanup.push({
          user_id: userId, table: 'mistakes', operation: 'delete', id,
          record: { id, user_id: userId, image_path: paths[0], image_previous_path: paths[1] }, queued_at: this.now()
        })
      }
    }
    if (!cleanup.length) return
    try {
      await this.queueChanges(cleanup)
      void this.refresh()
    } catch {
      this.setSync('error', 'A deleted mistake image could not be queued for cleanup. Retry sync when ready.')
    }
  }

  private clearUndoTimer(): void {
    if (this.undoHandle !== null) this.clearTimer(this.undoHandle)
    this.undoHandle = null
  }

  private async uploadPendingImage(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (typeof record.image_data !== 'string' || record.image_pending !== true) return record
    const path = `${this.options.userId}/${this.newId()}.webp`
    await this.options.cloud.uploadImage(path, dataUrlToBytes(record.image_data))
    return { ...record, image_path: path, image_pending: false }
  }

  private async retirePreviousImage(record: Record<string, unknown>): Promise<Record<string, unknown>> {
    const previousPath = typeof record.image_previous_path === 'string' ? record.image_previous_path : ''
    if (previousPath && previousPath !== record.image_path) {
      await this.options.cloud.removeImages([previousPath])
    }
    const cleaned = { ...record }
    delete cleaned.image_previous_path
    return cleaned
  }
}

/** Builds an engine with the cache loaded from the store (used by the React provider and tests). */
export async function createEngine(options: EngineOptions): Promise<DataEngine> {
  const engine = new DataEngine(options)
  await engine.start()
  return engine
}
