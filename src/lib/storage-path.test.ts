import { describe, expect, it } from 'vitest'
import { isOwnedStoragePath } from './storage-path'

const userId = 'a3f147d2-b7cf-53bd-a461-0d3cfed00001'
const file = 'b4e258e3-c8d0-45ce-b572-1e4d0fe11112.webp'

describe('owned storage paths', () => {
  it('accepts the owner folder and a generated webp name', () => {
    expect(isOwnedStoragePath(userId, `${userId}/${file}`)).toBe(true)
  })

  it('rejects another owner, traversal, and extra segments', () => {
    expect(isOwnedStoragePath(userId, `bbbbbbbb-b7cf-53bd-a461-0d3cfed00001/${file}`)).toBe(false)
    expect(isOwnedStoragePath(userId, `${userId}/../${file}`)).toBe(false)
    expect(isOwnedStoragePath(userId, `${userId}/nested/${file}`)).toBe(false)
    expect(isOwnedStoragePath(userId, `${userId}/note.png`)).toBe(false)
  })
})
