export function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `stracker-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
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
