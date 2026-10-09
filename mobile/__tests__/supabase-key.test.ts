import { isPrivilegedSupabaseKey, resolveSupabasePublicKey } from '../src/lib/supabase-key'

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
const jwt = (role: string) => `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ role, iss: 'supabase' })}.signature`

const KEY_VARIABLES = ['EXPO_PUBLIC_SUPABASE_URL', 'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'EXPO_PUBLIC_SUPABASE_ANON_KEY', 'EAS_BUILD_PROFILE']

/** Loads app.config.ts the way Expo's config loader does, under the given environment. */
function loadAppConfig(env: Record<string, string>): { thrown?: string; androidPackage?: string } {
  const saved = process.env
  const next: NodeJS.ProcessEnv = { ...saved }
  for (const key of KEY_VARIABLES) delete next[key]
  Object.assign(next, env)
  process.env = next
  let result: { thrown?: string; androidPackage?: string } = {}
  try {
    jest.isolateModules(() => {
      try {
        const load = (require('../app.config') as { default: (context: { config: object }) => { android?: { package?: string } } }).default
        result = { androidPackage: load({ config: {} }).android?.package }
      } catch (error) {
        result = { thrown: error instanceof Error ? error.message : String(error) }
      }
    })
  } finally {
    process.env = saved
  }
  return result
}

describe('public Supabase key resolution', () => {
  it('uses the publishable key and treats the anon key as an alias', () => {
    expect(resolveSupabasePublicKey('sb_publishable_abc', 'anon-alias')).toBe('sb_publishable_abc')
    expect(resolveSupabasePublicKey('   ', 'anon-alias')).toBe('anon-alias')
    expect(resolveSupabasePublicKey(undefined, jwt('anon'))).toBe(jwt('anon'))
    expect(resolveSupabasePublicKey(undefined, undefined)).toBe('')
  })

  it('classifies privileged keys: sb_secret_ and service_role JWTs, failing closed on unreadable tokens', () => {
    expect(isPrivilegedSupabaseKey('sb_secret_example')).toBe(true)
    expect(isPrivilegedSupabaseKey(jwt('service_role'))).toBe(true)
    expect(isPrivilegedSupabaseKey('a.b.c')).toBe(true)
    expect(isPrivilegedSupabaseKey('sb_publishable_example')).toBe(false)
    expect(isPrivilegedSupabaseKey(jwt('anon'))).toBe(false)
    expect(isPrivilegedSupabaseKey('')).toBe(false)
  })
})

describe('app.config.ts Supabase guard (Expo config loader)', () => {
  it('builds with the publishable key and keeps the application identity', () => {
    const result = loadAppConfig({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc' })
    expect(result.thrown).toBeUndefined()
    expect(result.androidPackage).toBe('com.stracker.dypollabs')
  })

  it('refuses a service-role key in any profile', () => {
    expect(loadAppConfig({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_example' }).thrown).toMatch(/privileged/)
    expect(loadAppConfig({ EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('service_role') }).thrown).toMatch(/privileged/)
  })

  it('requires the URL and a key for production builds, and accepts the legacy alias', () => {
    expect(loadAppConfig({ EAS_BUILD_PROFILE: 'production' }).thrown).toMatch(/Production builds need/)
    expect(loadAppConfig({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }).thrown).toMatch(/Production builds need/)
    const aliased = loadAppConfig({ EAS_BUILD_PROFILE: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://example.supabase.co', EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt('anon') })
    expect(aliased.thrown).toBeUndefined()
  })

  it('agrees with the runtime policy on every sample key', () => {
    const samples = ['sb_secret_example', 'sb_publishable_example', jwt('anon'), jwt('service_role'), 'a.b.c']
    for (const key of samples) {
      const buildSaysPrivileged = /privileged/.test(loadAppConfig({ EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key }).thrown ?? '')
      expect({ key, buildSaysPrivileged }).toEqual({ key, buildSaysPrivileged: isPrivilegedSupabaseKey(key) })
    }
  })
})
