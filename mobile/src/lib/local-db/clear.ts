import type { LocalStore } from './types'
import { SYNC_TABLES } from './tables'

/**
 * Removes everything the device holds for one account: cached rows, queued writes, and photos.
 * Used by "delete local data" in Settings. Other accounts on the same device are untouched.
 */
export async function clearLocalUserData(store: LocalStore, userId: string): Promise<void> {
  await store.transaction(async () => {
    for (const table of SYNC_TABLES) await store.clearRows(table, userId)
    await store.clearAssets(userId)
    for (const change of await store.listQueue(userId)) await store.deleteQueue(change.queueId)
  })
}
