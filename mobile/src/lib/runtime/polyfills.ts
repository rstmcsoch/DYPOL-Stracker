/**
 * Runtime globals that must exist before any Stracker module runs.
 *
 * - `crypto.getRandomValues` / `randomUUID` come from expo-crypto (a platform CSPRNG). The shared
 *   `createId()` falls back to Math.random when these are missing, which would make record IDs
 *   guessable, so the polyfill is installed first.
 * - react-native-url-polyfill completes the WHATWG URL implementation that supabase-js needs.
 */
import { getRandomValues, randomUUID } from 'expo-crypto'
import 'react-native-url-polyfill/auto'

const globalScope = globalThis as typeof globalThis & { crypto?: Partial<Crypto> }

if (!globalScope.crypto) globalScope.crypto = {} as Crypto
if (typeof globalScope.crypto.getRandomValues !== 'function') {
  globalScope.crypto.getRandomValues = (<T extends ArrayBufferView | null>(array: T): T => getRandomValues(array as never) as T) as Crypto['getRandomValues']
}
if (typeof globalScope.crypto.randomUUID !== 'function') {
  globalScope.crypto.randomUUID = (() => randomUUID() as `${string}-${string}-${string}-${string}-${string}`) as Crypto['randomUUID']
}
