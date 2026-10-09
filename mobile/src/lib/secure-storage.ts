/**
 * Session storage for supabase-js backed by the Android Keystore through expo-secure-store.
 *
 * SecureStore caps the size of each value (2 KB on some Android versions, counted in bytes), and a
 * Supabase session with its refresh token can exceed that. Values are therefore split into numbered
 * chunks with a small manifest entry, and reassembled on read. Nothing is written to plain storage.
 */
import * as SecureStore from 'expo-secure-store'

/** Characters per chunk. A UTF-8 character is at most 3 bytes, so 500 characters stays below 2 KB. */
const CHUNK_CHARACTERS = 500
const MANIFEST_SUFFIX = '.chunks'

function chunkText(value: string): string[] {
  const pieces: string[] = []
  for (let index = 0; index < value.length; index += CHUNK_CHARACTERS) {
    pieces.push(value.slice(index, index + CHUNK_CHARACTERS))
  }
  return pieces
}

async function deleteQuietly(key: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(key)
  } catch {
    // Deleting an absent key is not an error for the session logic.
  }
}

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const manifest = await SecureStore.getItemAsync(`${key}${MANIFEST_SUFFIX}`)
    if (manifest === null) return SecureStore.getItemAsync(key)
    const count = Number(manifest)
    if (!Number.isInteger(count) || count < 1) return null
    const parts: string[] = []
    for (let index = 0; index < count; index += 1) {
      const part = await SecureStore.getItemAsync(`${key}.${index}`)
      if (part === null) return null
      parts.push(part)
    }
    return parts.join('')
  },

  async setItem(key: string, value: string): Promise<void> {
    await this.removeItem(key)
    if (value.length <= CHUNK_CHARACTERS) {
      await SecureStore.setItemAsync(key, value)
      return
    }
    const pieces = chunkText(value)
    for (let index = 0; index < pieces.length; index += 1) {
      await SecureStore.setItemAsync(`${key}.${index}`, pieces[index] ?? '')
    }
    await SecureStore.setItemAsync(`${key}${MANIFEST_SUFFIX}`, String(pieces.length))
  },

  async removeItem(key: string): Promise<void> {
    const manifest = await SecureStore.getItemAsync(`${key}${MANIFEST_SUFFIX}`)
    if (manifest !== null) {
      const count = Number(manifest)
      if (Number.isInteger(count) && count > 0) {
        for (let index = 0; index < count; index += 1) await deleteQuietly(`${key}.${index}`)
      }
    }
    await deleteQuietly(`${key}${MANIFEST_SUFFIX}`)
    await deleteQuietly(key)
  }
}
