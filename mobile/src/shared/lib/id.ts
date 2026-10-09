export function createId(): string {
  const cryptoApi = globalThis.crypto
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID()

  const bytes = new Uint8Array(16)
  if (cryptoApi?.getRandomValues) cryptoApi.getRandomValues(bytes)
  else for (let index = 0; index < bytes.length; index += 1) bytes[index] = Math.floor(Math.random() * 256)
  bytes[6] = (bytes[6]! & 0x0f) | 0x40
  bytes[8] = (bytes[8]! & 0x3f) | 0x80
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

export function stableId(namespace: string): string {
  const hashes = [2166136261, 2246822519, 3266489917, 668265263]
  const input = namespace.toLowerCase()
  const words = hashes.map((initial, index) => {
    let hash = initial >>> 0
    for (let i = 0; i < input.length; i += 1) {
      hash ^= input.charCodeAt(i) + index
      hash = Math.imul(hash, 16777619) >>> 0
    }
    return hash.toString(16).padStart(8, '0')
  }).join('')
  return `${words.slice(0, 8)}-${words.slice(8, 12)}-5${words.slice(13, 16)}-a${words.slice(17, 20)}-${words.slice(20, 32)}`
}
