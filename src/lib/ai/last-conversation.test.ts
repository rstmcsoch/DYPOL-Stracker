import { describe, expect, it } from 'vitest'
import {
  clearLastConversationId, conversationIdToRestore, lastConversationStorageKey,
  readLastConversationId, writeLastConversationId
} from './last-conversation'

function memoryStorage(initial: Record<string, string> = {}): Storage {
  const data = { ...initial }
  return {
    get length() { return Object.keys(data).length },
    clear() { for (const key of Object.keys(data)) delete data[key] },
    getItem(key: string) { return key in data ? data[key]! : null },
    key(index: number) { return Object.keys(data)[index] ?? null },
    removeItem(key: string) { delete data[key] },
    setItem(key: string, value: string) { data[key] = value }
  }
}

describe('last AI conversation id', () => {
  const user = 'user-1'
  const other = 'user-2'
  const chat = 'chat-abc'

  it('stores only the id, keyed per user, and never writes a blank value', () => {
    const storage = memoryStorage()
    writeLastConversationId(user, chat, storage)
    writeLastConversationId(user, '', storage)
    expect(readLastConversationId(user, storage)).toBe(chat)
    expect(storage.getItem(lastConversationStorageKey(user))).toBe(chat)
    expect(readLastConversationId(other, storage)).toBeNull()
    clearLastConversationId(user, storage)
    expect(readLastConversationId(user, storage)).toBeNull()
  })

  it('reopens a saved chat that is still in the list, and skips one that was deleted', () => {
    expect(conversationIdToRestore(chat, [{ id: chat }, { id: 'older' }], true)).toBe(chat)
    expect(conversationIdToRestore(chat, [{ id: 'other' }], true)).toBeNull()
    expect(conversationIdToRestore(chat, [], true)).toBe(chat)
    expect(conversationIdToRestore(chat, [], false)).toBe(chat)
    expect(conversationIdToRestore(null, [{ id: chat }], true)).toBeNull()
  })
})
