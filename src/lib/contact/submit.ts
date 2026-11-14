import { supabase } from '../supabase'
import type { ContactDetails, ContactReason } from './reasons'

export interface ContactSubmission {
  name: string
  email: string
  reason: ContactReason
  subject: string
  message: string
  details: ContactDetails
  links: string[]
  files: File[]
  /** Honeypot value; real visitors never fill it. */
  website: string
}

export class ContactSubmitError extends Error {
  readonly fields: Record<string, string> | null
  constructor(message: string, fields: Record<string, string> | null = null) {
    super(message)
    this.name = 'ContactSubmitError'
    this.fields = fields
  }
}

interface StartResponse { ok: boolean; id: string | null; token?: string; uploads: Array<{ index: number; signedUrl: string }>; finalised?: boolean }

async function post<T>(body: unknown, authorization?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(authorization ? { Authorization: authorization } : {}) },
      body: JSON.stringify(body),
      cache: 'no-store',
      credentials: 'omit'
    })
  } catch {
    throw new ContactSubmitError('Could not reach Stracker. Check your connection and try again.')
  }
  const data = await response.json().catch(() => null) as (T & { message?: string; fields?: Record<string, string> }) | null
  if (!response.ok || !data) throw new ContactSubmitError(data?.message ?? 'Your message could not be sent. Try again in a few minutes.', data?.fields ?? null)
  return data
}

/** Uploads one file straight to private storage through its signed URL, reporting progress (0–1). */
export function uploadToSignedUrl(signedUrl: string, file: File, onProgress: (fraction: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open('PUT', signedUrl)
    request.setRequestHeader('Content-Type', file.type)
    request.setRequestHeader('x-upsert', 'false')
    request.upload.onprogress = event => { if (event.lengthComputable) onProgress(event.loaded / event.total) }
    request.onload = () => (request.status >= 200 && request.status < 300 ? (onProgress(1), resolve()) : reject(new ContactSubmitError(`“${file.name}” could not be uploaded. Check that it is a PDF, JPG or PNG under 10 MB.`)))
    request.onerror = () => reject(new ContactSubmitError(`“${file.name}” could not be uploaded. Check your connection and try again.`))
    request.send(file)
  })
}

async function bearer(): Promise<string | undefined> {
  try {
    const { data } = await supabase?.auth.getSession() ?? { data: { session: null } }
    return data.session?.access_token ? `Bearer ${data.session.access_token}` : undefined
  } catch {
    return undefined
  }
}

/**
 * Sends a contact message: the text first, then each file straight to private storage, then a
 * confirmation that lets the server verify the files. Any upload failure cancels the message so
 * nothing half-sent reaches the inbox.
 */
export async function submitContactMessage(input: ContactSubmission, onFileProgress: (index: number, fraction: number) => void): Promise<void> {
  const start = await post<StartResponse>({
    action: 'start',
    name: input.name,
    email: input.email,
    reason: input.reason,
    subject: input.subject,
    message: input.message,
    details: input.details,
    links: input.links.filter(link => link.trim()),
    files: input.files.map(file => ({ name: file.name, size: file.size, type: file.type })),
    website: input.website
  }, await bearer())
  if (!start.id || start.finalised || !start.uploads.length) return
  const id = start.id
  const token = start.token ?? ''
  try {
    for (const upload of start.uploads) {
      const file = input.files[upload.index]
      if (!file) throw new ContactSubmitError('An attachment went missing. Try again.')
      await uploadToSignedUrl(upload.signedUrl, file, fraction => onFileProgress(upload.index, fraction))
    }
  } catch (error) {
    await post({ action: 'cancel', id, token }).catch(() => undefined)
    throw error instanceof ContactSubmitError ? error : new ContactSubmitError('Your files could not be uploaded. Try again.')
  }
  await post({ action: 'finalize', id, token })
}
