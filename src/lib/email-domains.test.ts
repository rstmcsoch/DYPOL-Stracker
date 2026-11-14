import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BUILT_IN_ALLOWED_DOMAINS, isBuiltInAllowedDomain, normalizeDomainInput } from './email-domains'

describe('built-in always-allowed providers', () => {
  it('covers the providers Rustam listed', () => {
    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com', 'yahoo.com', 'ymail.com', 'rocketmail.com', 'yahoo.co.in', 'yahoo.co.uk',
      'icloud.com', 'me.com', 'mac.com', 'qq.com', 'foxmail.com', 'vip.qq.com', '163.com', '126.com', 'yeah.net', 'mail.ru', 'inbox.ru', 'list.ru', 'bk.ru',
      'yandex.com', 'yandex.ru', 'ya.ru', 'naver.com', 'aol.com', 'gmx.com', 'gmx.de', 'gmx.net', 'web.de', 'proton.me', 'protonmail.com', 'pm.me',
      'rediffmail.com', 'zohomail.com', 'zoho.com', 'comcast.net', 't-online.de', 'sina.com', 'sina.com.cn', 'sina.net', 'orange.fr', 'wanadoo.fr',
      'tuta.com', 'tutanota.com', 'tuta.io', 'privaterelay.appleid.com']) {
      expect(isBuiltInAllowedDomain(domain), domain).toBe(true)
    }
    expect(new Set(BUILT_IN_ALLOWED_DOMAINS).size).toBe(BUILT_IN_ALLOWED_DOMAINS.length)
  })

  it('is identical to the database allowlist', () => {
    const sql = readFileSync(new URL('../../supabase/migrations/20261114210000_email_domain_controls.sql', import.meta.url), 'utf8')
    const body = sql.slice(sql.indexOf('create or replace function public.never_block_email_domain'), sql.indexOf('revoke all on function public.never_block_email_domain'))
    const fromSql = [...body.matchAll(/'([a-z0-9.-]+\.[a-z0-9-]+)'/g)].map(match => match[1])
    expect(fromSql.sort()).toEqual([...BUILT_IN_ALLOWED_DOMAINS].sort())
  })
})

describe('owner domain input', () => {
  it('normalises valid domains', () => {
    expect(normalizeDomainInput(' Temp-Mail.Example. ')).toBe('temp-mail.example')
    expect(normalizeDomainInput('mail.co.uk')).toBe('mail.co.uk')
    expect(normalizeDomainInput('163.com')).toBe('163.com')
  })
  it('rejects anything that is not a plain hostname', () => {
    for (const value of ['', 'user@example.com', 'https://example.com', 'example', 'exa mple.com', 'example.com/path', '-bad.com', 'bad-.com', 'example.c', '*.example.com', '.example.com x']) {
      expect(normalizeDomainInput(value), value).toBeNull()
    }
  })
})
