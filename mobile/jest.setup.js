// Test-only globals. Production crypto comes from expo-crypto in src/lib/runtime/polyfills.ts.
const { webcrypto } = require('node:crypto')

if (!globalThis.crypto) {
  Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true })
}
