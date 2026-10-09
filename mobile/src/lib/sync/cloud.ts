import type { SupabaseClient } from '@supabase/supabase-js'
import type { TableName } from '../../shared/types'

/** Bucket that holds mistake photos. The same bucket and object layout as the website. */
export const MISTAKE_IMAGE_BUCKET = 'mistake-images'

/**
 * The remote operations the sync engine performs. The production implementation wraps the Supabase
 * client; tests substitute an in-memory fake with the same contract.
 *
 * Every method throws on error, so the engine's catch blocks decide between "offline, queued" and
 * "error, retry", exactly as the website does.
 */
export interface CloudClient {
  selectAll(table: TableName, userId: string): Promise<Record<string, unknown>[]>
  selectById(table: TableName, id: string, userId: string): Promise<Record<string, unknown> | null>
  upsert(table: TableName, rows: Record<string, unknown>[]): Promise<void>
  remove(table: TableName, id: string, userId: string): Promise<void>
  uploadImage(path: string, bytes: Uint8Array): Promise<void>
  removeImages(paths: string[]): Promise<void>
  signedImageUrl(path: string, expiresInSeconds: number): Promise<string | null>
  /** Every stored photo path for this owner, used by account reset. */
  listImagePaths(userId: string): Promise<string[]>
  /** Deletes every row this owner has in one table. Used only by account reset. */
  deleteOwnerRows(table: TableName, userId: string): Promise<void>
}

export function supabaseCloud(client: SupabaseClient): CloudClient {
  return {
    async selectAll(table, userId) {
      const { data, error } = await client.from(table).select('*').eq('user_id', userId)
      if (error) throw error
      return (data ?? []) as unknown as Record<string, unknown>[]
    },
    async selectById(table, id, userId) {
      const { data, error } = await client.from(table).select('*').eq('id', id).eq('user_id', userId).maybeSingle()
      if (error) throw error
      return (data as unknown as Record<string, unknown> | null) ?? null
    },
    async upsert(table, rows) {
      const { error } = await client.from(table).upsert(rows)
      if (error) throw error
    },
    async remove(table, id, userId) {
      const { error } = await client.from(table).delete().eq('id', id).eq('user_id', userId)
      if (error) throw error
    },
    async uploadImage(path, bytes) {
      const { error } = await client.storage.from(MISTAKE_IMAGE_BUCKET).upload(path, bytes, { upsert: true, contentType: 'image/webp' })
      if (error) throw error
    },
    async removeImages(paths) {
      const { error } = await client.storage.from(MISTAKE_IMAGE_BUCKET).remove(paths)
      if (error) throw error
    },
    async listImagePaths(userId) {
      const paths: string[] = []
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await client.storage.from(MISTAKE_IMAGE_BUCKET).list(userId, { limit: 1000, offset })
        if (error) throw error
        const page = data ?? []
        for (const item of page) if (item.name && item.id) paths.push(`${userId}/${item.name}`)
        if (page.length < 1000) break
      }
      return paths
    },
    async deleteOwnerRows(table, userId) {
      const { error } = await client.from(table).delete().eq('user_id', userId)
      if (error) throw error
    },
    async signedImageUrl(path, expiresInSeconds) {
      const { data } = await client.storage.from(MISTAKE_IMAGE_BUCKET).createSignedUrl(path, expiresInSeconds)
      return data?.signedUrl ?? null
    }
  }
}
