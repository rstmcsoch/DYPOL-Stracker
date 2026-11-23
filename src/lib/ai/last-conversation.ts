/** Persist only the last active Stracker AI conversation id — never message or prompt text. */

export function lastConversationStorageKey(userId: string): string {
  return `stracker:ai:last-conversation:${userId}`
}

export function readLastConversationId(userId: string, storage: Pick<Storage, 'getItem'> = localStorage): string | null {
  if (!userId) return null
  try {
    const raw = storage.getItem(lastConversationStorageKey(userId))
    const id = raw?.trim() ?? ''
    return id || null
  } catch {
    return null
  }
}

export function writeLastConversationId(userId: string, conversationId: string, storage: Pick<Storage, 'setItem'> = localStorage): void {
  if (!userId || !conversationId) return
  try { storage.setItem(lastConversationStorageKey(userId), conversationId) } catch { /* private mode / quota */ }
}

export function clearLastConversationId(userId: string, storage: Pick<Storage, 'removeItem'> = localStorage): void {
  if (!userId) return
  try { storage.removeItem(lastConversationStorageKey(userId)) } catch { /* private mode */ }
}

/**
 * Id to reopen after a reload. If the recent list has loaded and the saved id is
 * no longer in it, return null. An empty or not-yet-loaded list still returns the
 * saved id so the API can be asked once.
 */
export function conversationIdToRestore(
  savedId: string | null,
  conversations: ReadonlyArray<{ id: string }>,
  listKnown: boolean
): string | null {
  if (!savedId) return null
  if (!listKnown || conversations.length === 0) return savedId
  return conversations.some(item => item.id === savedId) ? savedId : null
}
