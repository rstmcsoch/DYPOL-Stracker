import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { ClientRequest,IncomingMessage } from 'node:http'
import type { RequestOptions } from 'node:https'
import type { LookupAddress } from 'node:dns'
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest'

vi.mock('node:dns/promises',() => ({ lookup:vi.fn() }))
vi.mock('node:https',() => ({ request:vi.fn() }))

import { lookup } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { fetchCustomProvider } from './secure-fetch'

const dnsLookup = vi.mocked(lookup)
const requestMock = vi.mocked(httpsRequest)
const publicAddress = { address:'93.184.216.34',family:4 }

beforeEach(() => {
  dnsLookup.mockReset()
  requestMock.mockReset()
  dnsLookup.mockResolvedValue([publicAddress] as never)
})
afterEach(() => vi.restoreAllMocks())

describe('pinned custom-provider HTTPS fetch',() => {
  it('refuses a private DNS answer before opening a provider connection',async () => {
    dnsLookup.mockResolvedValue([{address:'10.0.0.4',family:4}] as never)
    await expect(fetchCustomProvider('https://provider.example/v1/chat/completions',{method:'POST',body:'{}'})).rejects.toMatchObject({code:'invalid_endpoint'})
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('connects only to the previously validated public address while retaining hostname TLS identity',async () => {
    let capturedUrl:URL|undefined
    let capturedOptions:RequestOptions|undefined
    let responseCallback:((response:IncomingMessage)=>void)|undefined
    const fakeRequest = new EventEmitter() as EventEmitter & { write:(body:string)=>void;end:()=>void;destroy:(error:Error)=>void }
    fakeRequest.write = vi.fn()
    fakeRequest.destroy = vi.fn(error => { fakeRequest.emit('error',error) })
    fakeRequest.end = vi.fn(() => {
      const response = Readable.from([Buffer.from('{"ok":true}')]) as Readable & {statusCode:number;statusMessage:string;headers:Record<string,string>}
      response.statusCode = 200
      response.statusMessage = 'OK'
      response.headers = {'content-type':'application/json'}
      responseCallback?.(response as IncomingMessage)
    })
    requestMock.mockImplementation(((url:URL|string,options:RequestOptions,callback?:(response:IncomingMessage)=>void) => {
      capturedUrl = new URL(String(url))
      capturedOptions = options
      responseCallback = callback
      return fakeRequest as unknown as ClientRequest
    }) as typeof httpsRequest)

    const response = await fetchCustomProvider('https://provider.example/v1/chat/completions',{
      method:'POST',headers:{Authorization:'Bearer test-key','Content-Type':'application/json'},body:'{"model":"test"}'
    })
    expect(await response.json()).toEqual({ok:true})
    expect(capturedUrl?.hostname).toBe('provider.example')
    expect(capturedUrl?.pathname).toBe('/v1/chat/completions')
    expect(capturedOptions?.servername).toBe('provider.example')
    const options = capturedOptions as RequestOptions & {lookup:(hostname:string,options:{all?:boolean},callback:(error:NodeJS.ErrnoException|null,addresses:LookupAddress[]|string,family?:number)=>void)=>void}
    const result = await new Promise<LookupAddress[]>((resolve,reject) => {
      options.lookup('provider.example',{all:true},(error,addresses) => {
        if (error) reject(error)
        else if (typeof addresses === 'string') reject(new Error('Expected all DNS records'))
        else resolve(addresses)
      })
    })
    expect(result).toEqual([publicAddress])
    expect(dnsLookup).toHaveBeenCalledWith('provider.example',{all:true,verbatim:true})
    expect(fakeRequest.write).toHaveBeenCalledWith('{"model":"test"}')
  })
})
