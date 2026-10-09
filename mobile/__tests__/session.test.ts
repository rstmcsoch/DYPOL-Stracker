/**
 * Session persistence and token refresh. SecureStore is replaced by an in-memory store that enforces
 * SecureStore's 2 KB value limit, so the chunking is exercised rather than assumed.
 */
import * as SecureStore from 'expo-secure-store'
import { secureSessionStorage } from '../src/lib/secure-storage'

jest.mock('expo-secure-store', () => {
  const mockValues = new Map<string, string>()
  return {
    __values: mockValues,
    getItemAsync: jest.fn(async (key: string) => (mockValues.has(key) ? (mockValues.get(key) as string) : null)),
    setItemAsync: jest.fn(async (key: string, value: string) => {
      if (Buffer.byteLength(value, 'utf8') > 2048) throw new Error(`SecureStore value too large for ${key}`)
      mockValues.set(key, value)
    }),
    deleteItemAsync: jest.fn(async (key: string) => {
      mockValues.delete(key)
    })
  }
})

// Mocks for the Supabase client. Names start with "mock" so the jest.mock factories may reference them.
const mockClient = { auth: { startAutoRefresh: jest.fn(), stopAutoRefresh: jest.fn() } }
const mockCreateClient = jest.fn((..._args: unknown[]) => mockClient)
const mockRemoveListener = jest.fn()
let mockAppStateListener: ((state: string) => void) | undefined

const mockAppState = {
  currentState: 'active' as string,
  addEventListener: (_type: string, handler: (state: string) => void) => {
    mockAppStateListener = handler
    return { remove: mockRemoveListener }
  }
}

jest.mock('@supabase/supabase-js', () => ({ createClient: mockCreateClient }))
// Only AppState is replaced. Everything else comes from the real module, because expo-modules-core reads Platform from it.
jest.mock('react-native', () => {
  const actual = jest.requireActual('react-native')
  return new Proxy(actual, { get: (target, key) => (key === 'AppState' ? mockAppState : Reflect.get(target, key)) })
})
jest.mock('../src/lib/config', () => ({
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test',
  supabaseConfigured: true,
  API_BASE_URL: 'https://example.invalid',
  localPreviewEnabled: false
}))

const store = (SecureStore as unknown as { __values: Map<string, string> }).__values

beforeEach(() => store.clear())

describe('secure session storage', () => {
  it('stores a small session under its own key', async () => {
    await secureSessionStorage.setItem('sb-test-auth-token', '{"access_token":"a"}')
    expect(store.get('sb-test-auth-token')).toBe('{"access_token":"a"}')
    await expect(secureSessionStorage.getItem('sb-test-auth-token')).resolves.toBe('{"access_token":"a"}')
  })

  it('splits a large session with multi-byte text into values SecureStore accepts, and reassembles it exactly', async () => {
    const session = JSON.stringify({ access_token: 'x'.repeat(2500), refresh_token: 'r', note: 'नमस्ते 📚 '.repeat(200) })
    await secureSessionStorage.setItem('sb-test-auth-token', session)
    expect(store.has('sb-test-auth-token')).toBe(false)
    expect(store.get('sb-test-auth-token.chunks')).toBeDefined()
    for (const value of store.values()) expect(Buffer.byteLength(value, 'utf8')).toBeLessThanOrEqual(2048)
    await expect(secureSessionStorage.getItem('sb-test-auth-token')).resolves.toBe(session)
  })

  it('removes every chunk when the session is replaced by a smaller one or removed', async () => {
    await secureSessionStorage.setItem('sb-test-auth-token', 'y'.repeat(4000))
    expect(store.size).toBeGreaterThan(2)
    await secureSessionStorage.setItem('sb-test-auth-token', 'short')
    expect([...store.keys()]).toEqual(['sb-test-auth-token'])
    await secureSessionStorage.removeItem('sb-test-auth-token')
    expect(store.size).toBe(0)
  })

  it('treats a damaged manifest or a missing chunk as no session rather than returning partial data', async () => {
    await secureSessionStorage.setItem('sb-test-auth-token', 'z'.repeat(3000))
    store.set('sb-test-auth-token.chunks', 'not-a-number')
    await expect(secureSessionStorage.getItem('sb-test-auth-token')).resolves.toBeNull()
    store.set('sb-test-auth-token.chunks', '3')
    store.delete('sb-test-auth-token.1')
    await expect(secureSessionStorage.getItem('sb-test-auth-token')).resolves.toBeNull()
  })
})

describe('supabase client configuration and token refresh', () => {
  it('creates the client with secure, persistent, PKCE sessions and no URL detection', () => {
    let storageModule: unknown
    jest.isolateModules(() => {
      require('../src/lib/supabase')
      // Loaded in the same isolated registry as the client, so the identity check compares like with like.
      storageModule = (require('../src/lib/secure-storage') as typeof import('../src/lib/secure-storage')).secureSessionStorage
    })
    expect(mockCreateClient).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test',
      expect.objectContaining({
        auth: expect.objectContaining({
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          flowType: 'pkce'
        })
      })
    )
    const options = (mockCreateClient.mock.calls[0] as unknown[])[2] as { auth: { storage: unknown } }
    expect(options.auth.storage).toBe(storageModule)
  })

  it('refreshes tokens only while the app is in the foreground', () => {
    jest.isolateModules(() => {
      const { followAppStateForAuthRefresh } = require('../src/lib/supabase') as typeof import('../src/lib/supabase')
      const stop = followAppStateForAuthRefresh()
      expect(mockClient.auth.startAutoRefresh).toHaveBeenCalledTimes(1)
      mockAppStateListener?.('background')
      expect(mockClient.auth.stopAutoRefresh).toHaveBeenCalled()
      mockAppStateListener?.('active')
      expect(mockClient.auth.startAutoRefresh).toHaveBeenCalledTimes(2)
      stop()
      expect(mockRemoveListener).toHaveBeenCalled()
    })
  })
})
