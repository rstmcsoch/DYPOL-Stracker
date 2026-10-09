import type { QueuedChange, TableName } from '../../shared/types'

/** Cached mistake photo, stored as a WebP data URL until it is uploaded to `mistake-images`. */
export interface AssetRow {
  id: string
  mistake_id: string
  user_id: string
  data_url: string
  updated_at: string
}

export type QueueRow = QueuedChange & { queueId: number }

/**
 * The on-device cache, a React Native replacement for the website's Dexie (IndexedDB) database.
 * Every operation the sync engine needs is expressed here, so the engine can run unchanged against
 * SQLite on a device and against an in-memory store in tests.
 */
export interface LocalStore {
  listRows(table: TableName, userId: string): Promise<Record<string, unknown>[]>
  getRow(table: TableName, id: string): Promise<Record<string, unknown> | null>
  putRows(table: TableName, rows: Record<string, unknown>[]): Promise<void>
  deleteRow(table: TableName, id: string): Promise<void>
  clearRows(table: TableName, userId: string): Promise<void>

  getAsset(id: string): Promise<AssetRow | null>
  listAssets(userId: string): Promise<AssetRow[]>
  putAsset(asset: AssetRow): Promise<void>
  deleteAsset(id: string): Promise<void>
  clearAssets(userId: string): Promise<void>

  listQueue(userId: string): Promise<QueueRow[]>
  countQueue(userId: string): Promise<number>
  addQueue(change: QueuedChange): Promise<void>
  updateQueue(queueId: number, change: QueuedChange): Promise<void>
  deleteQueue(queueId: number): Promise<void>
  deleteQueueFor(userId: string, table: TableName, id: string): Promise<void>

  transaction<T>(run: () => Promise<T>): Promise<T>
}
