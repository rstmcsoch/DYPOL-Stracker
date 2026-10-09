/**
 * Exercises the real SQL in src/lib/local-db/sqlite-store.ts against an in-memory SQLite engine
 * (sql.js). Only the expo-sqlite entry point is replaced by an adapter with the same method names,
 * so the schema migration, JSON round trips, queue ordering, and rollback run exactly as written.
 */
import initSqlJs, { type Database } from 'sql.js'
import { openLocalStore, SQLiteLocalStore } from '../src/lib/local-db/sqlite-store'
import { LOCAL_SCHEMA_VERSION } from '../src/lib/local-db/tables'

let sqlite: Awaited<ReturnType<typeof initSqlJs>>
let database: Database | null = null

class SqlJsAdapter {
  constructor(private readonly db: Database) {}

  async execAsync(sql: string): Promise<void> {
    this.db.exec(sql)
  }

  async runAsync(sql: string, params: unknown[] = []): Promise<void> {
    this.db.run(sql, params as never)
  }

  async getAllAsync<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const statement = this.db.prepare(sql)
    try {
      statement.bind(params as never)
      const rows: T[] = []
      while (statement.step()) rows.push(statement.getAsObject() as T)
      return rows
    } finally {
      statement.free()
    }
  }

  async getFirstAsync<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    return (await this.getAllAsync<T>(sql, params))[0] ?? null
  }

  async withTransactionAsync(task: () => Promise<void>): Promise<void> {
    this.db.exec('BEGIN')
    try {
      await task()
      this.db.exec('COMMIT')
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
}

jest.mock('expo-sqlite', () => ({
  openDatabaseAsync: jest.fn(async () => {
    const adapter = (globalThis as unknown as { __adapter: unknown }).__adapter
    return adapter
  })
}))

beforeAll(async () => {
  sqlite = await initSqlJs()
})

beforeEach(() => {
  database = new sqlite.Database()
  ;(globalThis as unknown as { __adapter: unknown }).__adapter = new SqlJsAdapter(database)
})

afterEach(() => {
  database?.close()
  database = null
})

const USER = 'user-a'
const OTHER = 'user-b'

async function open(): Promise<SQLiteLocalStore> {
  return openLocalStore()
}

describe('on-device cache (SQLite)', () => {
  it('creates the schema once and records the schema version', async () => {
    await open()
    const version = database!.exec('PRAGMA user_version')[0]!.values[0]![0]
    expect(version).toBe(LOCAL_SCHEMA_VERSION)
    const tables = database!.exec("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")[0]!.values.map(row => row[0])
    expect(tables).toEqual(expect.arrayContaining(['chapters', 'mistakes', 'sync_queue', 'assets', 'app_settings', 'profiles']))

    // Reopening must not run the migration again (which would fail on the existing schema).
    await expect(open()).resolves.toBeInstanceOf(SQLiteLocalStore)
  })

  it('round-trips records as JSON and keeps each account separate', async () => {
    const store = await open()
    const row = { id: 'c1', user_id: USER, updated_at: '2026-10-09T00:00:00.000Z', name: 'Vectors', tags: ['a', 'b'], notes: null, nested: { n: 1.5 } }
    await store.putRows('chapters', [row])
    await store.putRows('chapters', [{ id: 'c2', user_id: OTHER, updated_at: '2026-10-09T00:00:00.000Z', name: 'Other' }])

    expect(await store.listRows('chapters', USER)).toEqual([row])
    expect(await store.listRows('chapters', OTHER)).toEqual([expect.objectContaining({ id: 'c2' })])
    expect(await store.getRow('chapters', 'c1')).toEqual(row)
  })

  it('replaces a row with the same id instead of duplicating it', async () => {
    const store = await open()
    await store.putRows('chapters', [{ id: 'c1', user_id: USER, updated_at: '1', name: 'First' }])
    await store.putRows('chapters', [{ id: 'c1', user_id: USER, updated_at: '2', name: 'Second' }])
    const rows = await store.listRows('chapters', USER)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ name: 'Second', updated_at: '2' })
  })

  it('keeps the queue in queued order and collapses entries per record', async () => {
    const store = await open()
    await store.addQueue({ user_id: USER, table: 'chapters', operation: 'upsert', id: 'c2', record: { id: 'c2' }, queued_at: '2026-10-09T02:00:00.000Z' })
    await store.addQueue({ user_id: USER, table: 'chapters', operation: 'upsert', id: 'c1', record: { id: 'c1' }, queued_at: '2026-10-09T01:00:00.000Z' })
    const queue = await store.listQueue(USER)
    expect(queue.map(item => item.id)).toEqual(['c1', 'c2'])
    expect(await store.countQueue(USER)).toBe(2)

    await store.deleteQueueFor(USER, 'chapters', 'c1')
    expect((await store.listQueue(USER)).map(item => item.id)).toEqual(['c2'])
    expect(await store.countQueue(OTHER)).toBe(0)
  })

  it('stores, updates, and deletes queued deletes with their image paths', async () => {
    const store = await open()
    await store.addQueue({ user_id: USER, table: 'mistakes', operation: 'delete', id: 'm1', record: { id: 'm1', image_path: 'p/1.webp' }, queued_at: 'x' })
    const [entry] = await store.listQueue(USER)
    expect(entry).toMatchObject({ operation: 'delete', record: { image_path: 'p/1.webp' } })
    await store.updateQueue(entry!.queueId, { ...entry!, operation: 'upsert', record: { id: 'm1', image_path: 'p/2.webp' } })
    expect((await store.listQueue(USER))[0]).toMatchObject({ operation: 'upsert', record: { image_path: 'p/2.webp' } })
    await store.deleteQueue(entry!.queueId)
    expect(await store.countQueue(USER)).toBe(0)
  })

  it('caches mistake photos per account and clears them on request', async () => {
    const store = await open()
    await store.putAsset({ id: `${USER}:m1`, mistake_id: 'm1', user_id: USER, data_url: 'data:image/webp;base64,AA==', updated_at: 't' })
    expect(await store.getAsset(`${USER}:m1`)).toMatchObject({ mistake_id: 'm1' })
    expect(await store.listAssets(USER)).toHaveLength(1)
    await store.clearAssets(USER)
    expect(await store.listAssets(USER)).toHaveLength(0)
  })

  it('rolls back a failed group of writes, so an interrupted pull never half-replaces the cache', async () => {
    const store = await open()
    await store.putRows('chapters', [{ id: 'keep', user_id: USER, updated_at: 'old', name: 'Original' }])
    await expect(store.transaction(async () => {
      await store.clearRows('chapters', USER)
      await store.putRows('chapters', [{ id: 'new', user_id: USER, updated_at: 'new', name: 'Partial' }])
      throw new Error('network dropped mid-pull')
    })).rejects.toThrow('network dropped mid-pull')

    const rows = await store.listRows('chapters', USER)
    expect(rows.map(row => row.id)).toEqual(['keep'])
    expect(rows[0]).toMatchObject({ name: 'Original' })
  })

  it('allows row writes inside a transaction without nesting transactions', async () => {
    const store = await open()
    await store.transaction(async () => {
      await store.putRows('tests', [{ id: 't1', user_id: USER, updated_at: 'a', title: 'Mock' }])
      await store.putRows('tests', [{ id: 't2', user_id: USER, updated_at: 'a', title: 'Mock 2' }])
    })
    expect(await store.listRows('tests', USER)).toHaveLength(2)
  })

  it('refuses table names outside the synced set, so no SQL can be injected through a table name', async () => {
    const store = await open()
    await expect(store.listRows('chapters; DROP TABLE chapters' as never, USER)).rejects.toThrow(/Unknown table/)
  })
})
