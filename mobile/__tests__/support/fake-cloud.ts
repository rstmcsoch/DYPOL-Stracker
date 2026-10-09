import type { CloudClient } from '../../src/lib/sync/cloud'
import type { TableName } from '../../src/shared/types'

/**
 * In-memory stand-in for the Supabase project. It follows the same contract as the real adapter:
 * rows are scoped by user_id, every operation throws when the "network" is down, and the bucket is a
 * map of path → bytes.
 */
export class FakeCloud implements CloudClient {
  readonly tables = new Map<TableName, Map<string, Record<string, unknown>>>()
  readonly bucket = new Map<string, Uint8Array>()
  online = true
  operations: string[] = []

  private table(name: TableName): Map<string, Record<string, unknown>> {
    let table = this.tables.get(name)
    if (!table) {
      table = new Map()
      this.tables.set(name, table)
    }
    return table
  }

  rows(name: TableName): Record<string, unknown>[] {
    return [...this.table(name).values()].map(row => structuredClone(row))
  }

  seedRow(name: TableName, row: Record<string, unknown>): void {
    this.table(name).set(String(row.id), structuredClone(row))
  }

  private guard(operation: string): void {
    this.operations.push(operation)
    if (!this.online) throw new Error('Network request failed')
  }

  async selectAll(table: TableName, userId: string): Promise<Record<string, unknown>[]> {
    this.guard(`select:${table}`)
    return this.rows(table).filter(row => row.user_id === userId)
  }

  async selectById(table: TableName, id: string, userId: string): Promise<Record<string, unknown> | null> {
    this.guard(`selectById:${table}`)
    const row = this.table(table).get(id)
    return row && row.user_id === userId ? structuredClone(row) : null
  }

  async upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void> {
    this.guard(`upsert:${table}`)
    for (const row of rows) this.table(table).set(String(row.id), structuredClone(row))
  }

  async remove(table: TableName, id: string, userId: string): Promise<void> {
    this.guard(`remove:${table}`)
    const row = this.table(table).get(id)
    if (row && row.user_id === userId) this.table(table).delete(id)
  }

  async uploadImage(path: string, bytes: Uint8Array): Promise<void> {
    this.guard('uploadImage')
    this.bucket.set(path, bytes)
  }

  async removeImages(paths: string[]): Promise<void> {
    this.guard('removeImages')
    for (const path of paths) this.bucket.delete(path)
  }

  async listImagePaths(userId: string): Promise<string[]> {
    this.guard('listImagePaths')
    return [...this.bucket.keys()].filter(path => path.startsWith(`${userId}/`))
  }

  async deleteOwnerRows(table: TableName, userId: string): Promise<void> {
    this.guard(`deleteOwnerRows:${table}`)
    const rows = this.table(table)
    for (const [id, row] of rows) if (row.user_id === userId) rows.delete(id)
  }

  async signedImageUrl(path: string): Promise<string | null> {
    this.guard('signedImageUrl')
    return `https://signed.example/${path}`
  }
}
