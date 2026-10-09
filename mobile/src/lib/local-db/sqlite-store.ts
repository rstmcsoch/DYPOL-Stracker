import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite'
import type { QueuedChange, TableName } from '../../shared/types'
import { assertSyncTable, LOCAL_SCHEMA_VERSION, SYNC_TABLES } from './tables'
import type { AssetRow, LocalStore, QueueRow } from './types'

/**
 * On-device database for the offline cache, the write queue, and cached mistake photos.
 *
 * Each cloud table is stored as `(id, user_id, updated_at, data)`, where `data` holds the full JSON
 * row. Records keep their Supabase shape exactly, so no field mapping can drift from the website.
 * Indexed `user_id` columns keep per-account reads cheap, and every write is a transaction.
 *
 * Schema changes are versioned with `PRAGMA user_version`. Add a numbered step to MIGRATIONS and
 * bump LOCAL_SCHEMA_VERSION; never edit a step that has already shipped.
 */

const DATABASE_NAME = 'stracker-cache.db'

function tableDdl(table: string): string {
  return `CREATE TABLE IF NOT EXISTS ${table} (
    id TEXT PRIMARY KEY NOT NULL,
    user_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT '',
    data TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_${table}_user ON ${table} (user_id);`
}

const MIGRATIONS: ((db: SQLiteDatabase) => Promise<void>)[] = [
  async db => {
    for (const table of SYNC_TABLES) await db.execAsync(tableDdl(table))
    await db.execAsync(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY NOT NULL,
        mistake_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        data_url TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT ''
      );
      CREATE INDEX IF NOT EXISTS idx_assets_user ON assets (user_id);
      CREATE TABLE IF NOT EXISTS sync_queue (
        queue_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        record_id TEXT NOT NULL,
        record TEXT,
        queued_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_user ON sync_queue (user_id, table_name, record_id);
    `)
  }
]

export async function openLocalStore(): Promise<SQLiteLocalStore> {
  const db = await openDatabaseAsync(DATABASE_NAME)
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = OFF;')
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version')
  let version = row?.user_version ?? 0
  if (version > LOCAL_SCHEMA_VERSION) {
    throw new Error(`The on-device database is from a newer app version (schema ${version}).`)
  }
  for (; version < LOCAL_SCHEMA_VERSION; version += 1) {
    const migrate = MIGRATIONS[version]
    if (!migrate) throw new Error(`Missing migration to schema ${version + 1}`)
    await db.withTransactionAsync(async () => {
      await migrate(db)
      await db.execAsync(`PRAGMA user_version = ${version + 1}`)
    })
  }
  return new SQLiteLocalStore(db)
}

function parseRow(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>
}

export class SQLiteLocalStore implements LocalStore {
  constructor(private readonly db: SQLiteDatabase) {}

  async listRows(table: TableName, userId: string): Promise<Record<string, unknown>[]> {
    assertSyncTable(table)
    const rows = await this.db.getAllAsync<{ data: string }>(`SELECT data FROM ${table} WHERE user_id = ? ORDER BY rowid`, [userId])
    return rows.map(row => parseRow(row.data))
  }

  async getRow(table: TableName, id: string): Promise<Record<string, unknown> | null> {
    assertSyncTable(table)
    const row = await this.db.getFirstAsync<{ data: string }>(`SELECT data FROM ${table} WHERE id = ?`, [id])
    return row ? parseRow(row.data) : null
  }

  /**
   * Batch upsert. It deliberately opens no transaction of its own: SQLite forbids nesting, and the
   * engine calls this inside `transaction()` when a group of writes must succeed or fail together.
   */
  async putRows(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
    assertSyncTable(table)
    for (const row of rows) {
      await this.db.runAsync(
        `INSERT OR REPLACE INTO ${table} (id, user_id, updated_at, data) VALUES (?, ?, ?, ?)`,
        [String(row.id), String(row.user_id ?? ''), String(row.updated_at ?? ''), JSON.stringify(row)]
      )
    }
  }

  async deleteRow(table: TableName, id: string): Promise<void> {
    assertSyncTable(table)
    await this.db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id])
  }

  async clearRows(table: TableName, userId: string): Promise<void> {
    assertSyncTable(table)
    await this.db.runAsync(`DELETE FROM ${table} WHERE user_id = ?`, [userId])
  }

  async getAsset(id: string): Promise<AssetRow | null> {
    return (await this.db.getFirstAsync<AssetRow>('SELECT id, mistake_id, user_id, data_url, updated_at FROM assets WHERE id = ?', [id])) ?? null
  }

  async listAssets(userId: string): Promise<AssetRow[]> {
    return this.db.getAllAsync<AssetRow>('SELECT id, mistake_id, user_id, data_url, updated_at FROM assets WHERE user_id = ?', [userId])
  }

  async putAsset(asset: AssetRow): Promise<void> {
    await this.db.runAsync(
      'INSERT OR REPLACE INTO assets (id, mistake_id, user_id, data_url, updated_at) VALUES (?, ?, ?, ?, ?)',
      [asset.id, asset.mistake_id, asset.user_id, asset.data_url, asset.updated_at]
    )
  }

  async deleteAsset(id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM assets WHERE id = ?', [id])
  }

  async clearAssets(userId: string): Promise<void> {
    await this.db.runAsync('DELETE FROM assets WHERE user_id = ?', [userId])
  }

  async listQueue(userId: string): Promise<QueueRow[]> {
    const rows = await this.db.getAllAsync<{ queue_id: number; user_id: string; table_name: string; operation: string; record_id: string; record: string | null; queued_at: string }>(
      'SELECT queue_id, user_id, table_name, operation, record_id, record, queued_at FROM sync_queue WHERE user_id = ? ORDER BY queued_at, queue_id',
      [userId]
    )
    return rows.map(row => {
      assertSyncTable(row.table_name)
      return {
        queueId: row.queue_id,
        user_id: row.user_id,
        table: row.table_name,
        operation: row.operation === 'delete' ? 'delete' : 'upsert',
        id: row.record_id,
        record: row.record ? parseRow(row.record) : undefined,
        queued_at: row.queued_at
      } satisfies QueueRow
    })
  }

  async countQueue(userId: string): Promise<number> {
    const row = await this.db.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM sync_queue WHERE user_id = ?', [userId])
    return row?.count ?? 0
  }

  async addQueue(change: QueuedChange): Promise<void> {
    await this.db.runAsync(
      'INSERT INTO sync_queue (user_id, table_name, operation, record_id, record, queued_at) VALUES (?, ?, ?, ?, ?, ?)',
      [change.user_id, change.table, change.operation, change.id, change.record ? JSON.stringify(change.record) : null, change.queued_at]
    )
  }

  async updateQueue(queueId: number, change: QueuedChange): Promise<void> {
    await this.db.runAsync(
      'UPDATE sync_queue SET user_id = ?, table_name = ?, operation = ?, record_id = ?, record = ?, queued_at = ? WHERE queue_id = ?',
      [change.user_id, change.table, change.operation, change.id, change.record ? JSON.stringify(change.record) : null, change.queued_at, queueId]
    )
  }

  async deleteQueue(queueId: number): Promise<void> {
    await this.db.runAsync('DELETE FROM sync_queue WHERE queue_id = ?', [queueId])
  }

  async deleteQueueFor(userId: string, table: TableName, id: string): Promise<void> {
    await this.db.runAsync('DELETE FROM sync_queue WHERE user_id = ? AND table_name = ? AND record_id = ?', [userId, table, id])
  }

  async transaction<T>(run: () => Promise<T>): Promise<T> {
    let result: T | undefined
    await this.db.withTransactionAsync(async () => {
      result = await run()
    })
    return result as T
  }
}
