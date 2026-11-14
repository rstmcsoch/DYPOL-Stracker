import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'

const rpc = vi.fn()
const network = { down: false }
vi.mock('./supabase', () => ({ supabase: { rpc: (...args: unknown[]) => network.down ? Promise.reject(new Error('offline')) : rpc(...args) } }))
const { emailDomain, isDisposableEmail } = await import('./disposable-email')

beforeEach(() => { rpc.mockReset(); network.down = false })

describe('disposable email check (client)', () => {
  it('extracts the domain', () => {
    expect(emailDomain(' Ada@Mailinator.COM ')).toBe('mailinator.com')
    expect(emailDomain('ada@example.com.')).toBe('example.com')
    expect(emailDomain('not-an-email')).toBeNull()
    expect(emailDomain('ada@localhost')).toBeNull()
  })
  it('never asks about mainstream or relay providers', async () => {
    for (const domain of ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'privaterelay.appleid.com', 'proton.me']) {
      expect(await isDisposableEmail(['ada', domain].join('@'))).toBe(false)
    }
    expect(rpc).not.toHaveBeenCalled()
  })
  it('asks the server for other domains', async () => {
    rpc.mockResolvedValue({ data: true, error: null })
    expect(await isDisposableEmail('ada@mailinator.com')).toBe(true)
    expect(rpc).toHaveBeenCalledWith('is_disposable_email', { p_email: 'ada@mailinator.com' })
  })
  it('fails open when the check errors (the database trigger still decides)', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'boom' } })
    expect(await isDisposableEmail('ada@example.org')).toBe(false)
  })
  it('fails open when the network is down', async () => {
    network.down = true
    expect(await isDisposableEmail('ada@example.net')).toBe(false)
  })
})

describe('disposable email block (database migration)', () => {
  const sql = readFileSync(new URL('../../supabase/migrations/20261114200000_disposable_email_block.sql', import.meta.url), 'utf8')
  it('keeps the domain table private with RLS and no API grants', () => {
    expect(sql).toContain('alter table public.disposable_email_domains enable row level security;')
    expect(sql).toContain('revoke all on public.disposable_email_domains from anon, authenticated;')
    expect(sql).not.toMatch(/create policy/i)
  })
  it('enforces on new accounts only, server-side', () => {
    expect(sql).toMatch(/before insert on auth\.users/)
    expect(sql).not.toMatch(/before update on auth\.users/)
    expect(sql).toContain("Temporary or disposable email addresses aren''t allowed. Please use your regular email.")
  })
  it('uses the normal list, never a strict list, and never blocks mainstream providers', () => {
    expect(sql).toContain('disposable-email-domains/disposable-email-domains/main/disposable_email_blocklist.conf')
    expect(sql).not.toMatch(/strict[a-z_]*\.conf/i)
    for (const domain of ['gmail.com', 'outlook.com', 'hotmail.com', 'icloud.com', 'privaterelay.appleid.com']) expect(sql).toContain(`'${domain}'`)
  })
  it('refuses implausible downloads instead of emptying the list', () => {
    expect(sql).toContain('if total < 1000 then')
  })
  it('contains no secrets or destructive resets', () => {
    expect(sql).not.toMatch(/service_role|truncate public\.|drop table/i)
  })
})
