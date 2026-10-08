import { beforeEach,describe,expect,it,vi } from 'vitest'
import type { LookupAddress } from 'node:dns'

vi.mock('node:dns/promises',() => ({ lookup:vi.fn() }))

import { lookup } from 'node:dns/promises'
import { resolveCustomBaseUrl } from './registry'

const dnsLookup = vi.mocked(lookup)
const publicV4:LookupAddress = { address:'93.184.216.34',family:4 }

beforeEach(() => dnsLookup.mockReset())

describe('custom provider endpoint validation',() => {
  it('normalizes a public HTTPS endpoint and returns the address that must be pinned',async () => {
    dnsLookup.mockResolvedValue([publicV4] as never)
    await expect(resolveCustomBaseUrl('https://Example.COM/v1/')).resolves.toMatchObject({
      url:'https://example.com/v1',address:publicV4
    })
    expect(dnsLookup).toHaveBeenCalledWith('example.com',{all:true,verbatim:true})
  })

  it.each([
    'http://provider.example/v1',
    'https://user:password@provider.example/v1',
    'https://provider.example:8443/v1',
    'https://localhost/v1',
    'https://service.local/v1',
    'https://127.0.0.1/v1',
    'https://10.0.0.4/v1',
    'https://192.0.2.15/v1'
  ])('rejects unsafe or unsupported URL %s before making a DNS request',async url => {
    await expect(resolveCustomBaseUrl(url)).rejects.toMatchObject({status:400,code:'invalid_endpoint'})
    expect(dnsLookup).not.toHaveBeenCalled()
  })

  it.each([
    '10.1.2.3','127.0.0.1','169.254.1.2','172.20.0.1','192.168.1.9','100.64.0.3',
    '192.0.2.1','198.18.0.1','198.51.100.9','203.0.113.3','::1','::ffff:127.0.0.1',
    'fd00::1234','fe80::1','2001:db8::3','2001:20::5','2002:7f00:1::1','3fff::1'
  ])('rejects a DNS answer that is not globally routable (%s)',async address => {
    dnsLookup.mockResolvedValue([{address,family:address.includes(':') ? 6 : 4}] as never)
    await expect(resolveCustomBaseUrl('https://provider.example/v1')).rejects.toMatchObject({status:400,code:'invalid_endpoint'})
  })

  it('rejects a hostname if even one answer is private, preventing mixed-answer rebinding',async () => {
    dnsLookup.mockResolvedValue([publicV4,{address:'10.0.0.1',family:4}] as never)
    await expect(resolveCustomBaseUrl('https://provider.example/v1')).rejects.toMatchObject({status:400,code:'invalid_endpoint'})
  })

  it('accepts globally-routable IPv4 and IPv6 answers',async () => {
    dnsLookup.mockResolvedValue([{address:'2606:4700:4700::1111',family:6}] as never)
    await expect(resolveCustomBaseUrl('https://provider.example/v1')).resolves.toMatchObject({address:{address:'2606:4700:4700::1111',family:6}})
  })


})
