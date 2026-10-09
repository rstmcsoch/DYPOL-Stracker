import type { QueuedChange, TableName } from '../../shared/types'
import type { AssetRow, LocalStore, QueueRow } from './types'

/**
 * In-memory LocalStore with the same semantics as the SQLite store. It backs the unit tests of the
 * sync engine, which must run without a device. It is never used by the app at runtime.
 */
export class MemoryLocalStore implements LocalStore {
  private tables = new Map<TableName, Map<string, Record<string, unknown>>>()
  private assets = new Map<string, AssetRow>()
  private queue: QueueRow[] = []
  private nextQueueId = 1

  private table(name: TableName): Map<string, Record<string, unknown>> {
    let table = this.tables.get(name)
    if (!table) {
      table = new Map()
      this.tables.set(name, table)
    }
    return table
  }

  async listRows(table: TableName, userId: string): Promise<Record<string, unknown>[]> {
    return [...this.table(table).values()].filter(row => row.user_id === userId).map(row => structuredClone(row))
  }

  async getRow(table: TableName, id: string): Promise<Record<string, unknown> | null> {
    const row = this.table(table).get(id)
    return row ? structuredClone(row) : null
  }

  async putRows(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
    for (const row of rows) this.table(table).set(String(row.id), structuredClone(row))
  }

  async deleteRow(table: TableName, id: string): Promise<void> {
    this.table(table).delete(id)
  }

  async clearRows(table: TableName, userId: string): Promise<void> {
    for (const [id, row] of this.table(table)) if (row.user_id === userId) this.table(table).delete(id)
  }

  async getAsset(id: string): Promise<AssetRow | null> {
    const asset = this.assets.get(id)
    return asset ? { ...asset } : null
  }

  async listAssets(userId: string): Promise<AssetRow[]> {
    return [...this.assets.values()].filter(asset => asset.user_id === userId).map(asset => ({ ...asset }))
  }

  async putAsset(asset: AssetRow): Promise<void> {
    this.assets.set(asset.id, { ...asset })
  }

  async deleteAsset(id: string): Promise<void> {
    this.assets.delete(id)
  }

  async clearAssets(userId: string): Promise<void> {
    for (const [id, asset] of this.assets) if (asset.user_id === userId) this.assets.delete(id)
  }

  async listQueue(userId: string): Promise<QueueRow[]> {
    return this.queue
      .filter(row => row.user_id === userId)
      .sort((a, b) => a.queued_at.localeCompare(b.queued_at) || a.queueId - b.queueId)
      .map(row => structuredClone(row))
  }

  async countQueue(userId: string): Promise<number> {
    return this.queue.filter(row => row.user_id === userId).length
  }

  async addQueue(change: QueuedChange): Promise<void> {
    this.queue.push({ ...structuredClone(change), queueId: this.nextQueueId++ })
  }

  async updateQueue(queueId: number, change: QueuedChange): Promise<void> {
    const index = this.queue.findIndex(row => row.queueId === queueId)
    if (index >= 0) this.queue[index] = { ...structuredClone(change), queueId }
  }

  async deleteQueue(queueId: number): Promise<void> {
    this.queue = this.queue.filter(row => row.queueId !== queueId)
  }

  async deleteQueueFor(userId: string, table: TableName, id: string): Promise<void> {
    this.queue = this.queue.filter(row => !(row.user_id === userId && row.table === table && row.id === id))
  }

  async transaction<T>(run: () => Promise<T>): Promise<T> {
    return run()
  }
}
