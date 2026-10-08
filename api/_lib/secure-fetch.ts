import { request as httpsRequest } from 'node:https'
import { Readable } from 'node:stream'
import { ApiError } from './http'
import { resolveCustomBaseUrl } from './registry'

/**
 * Fetch a user-supplied HTTPS provider URL only after resolving it to a public
 * address, then pin TLS/SNI to the original hostname while connecting to that
 * address. This closes the DNS-rebinding gap between validation and fetch.
 */
export async function fetchCustomProvider(urlValue:string,init:RequestInit):Promise<Response> {
  const resolved = await resolveCustomBaseUrl(urlValue)
  const target = new URL(resolved.url)
  const pinned = resolved.address
  const headers = new Headers(init.headers)
  const options:Record<string,unknown> = {
    method:init.method ?? 'GET',
    headers:Object.fromEntries(headers.entries()),
    lookup:(_hostname:string,optionsOrCallback:unknown,maybeCallback?:unknown) => {
      const callback = typeof optionsOrCallback === 'function' ? optionsOrCallback : maybeCallback
      const lookupOptions = optionsOrCallback && typeof optionsOrCallback === 'object' ? optionsOrCallback as {all?:boolean} : {}
      if (typeof callback !== 'function') throw new Error('Missing pinned DNS callback')
      if (lookupOptions.all) (callback as (error:null,addresses:Array<{address:string;family:number}>)=>void)(null,[{address:pinned.address,family:pinned.family}])
      else (callback as (error:null,address:string,family:number)=>void)(null,pinned.address,pinned.family)
    },
    servername:target.hostname
  }
  if (init.signal) options.signal = init.signal
  return new Promise((resolve,reject) => {
    const request = httpsRequest(target,options as Parameters<typeof httpsRequest>[1],response => {
      const responseHeaders = new Headers()
      for (const [name,value] of Object.entries(response.headers)) {
        if (Array.isArray(value)) for (const entry of value) responseHeaders.append(name,entry)
        else if (typeof value === 'string') responseHeaders.set(name,value)
      }
      const body = response.statusCode === 204 || response.statusCode === 304 ? null : Readable.toWeb(response) as ReadableStream<Uint8Array>
      resolve(new Response(body,{status:response.statusCode ?? 502,statusText:response.statusMessage,headers:responseHeaders}))
    })
    request.on('error',reject)
    if (typeof init.body === 'string') request.write(init.body)
    else if (init.body !== undefined && init.body !== null) {
      request.destroy(new ApiError(400,'unsupported_custom_request','Custom provider requests must use a text JSON body.'))
      return
    }
    request.end()
  })
}
