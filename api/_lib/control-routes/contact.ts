import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, publicError, readJson, sendJson } from '../http.js'
import { clientKeyHash, serviceClient } from '../control.js'
import { logAIEvent } from '../diagnostics.js'
import {
  ATTACHMENT_RULES,
  CONTACT_LIMITS,
  attachmentMime,
  attachmentProblem,
  cleanContactDetails,
  cleanContactLinks,
  isContactReason,
  magicBytesMatch,
  safeFileName,
  validateContactDraft,
  type AttachmentMime,
  type ContactReason
} from '../../../src/lib/contact/reasons.js'

/**
 * POST /api/contact — public contact form intake (no sign-in needed).
 *
 *   { action: 'start', name, email, reason, subject?, message, details?, links?, files?, website? }
 *       Validates everything, applies per-network rate limits, stores the message and, when files
 *       are declared, returns one signed upload URL per file into the private bucket. A message
 *       with files stays `pending` (invisible in the console) until it is finalised.
 *   { action: 'finalize', id, token }   verifies every uploaded file (presence, size, MIME, magic
 *       bytes, 15 MB total). Success makes the message visible; failure deletes it and its files.
 *   { action: 'cancel', id, token }     the sender gave up during upload: delete message and files.
 *
 * `website` is a honeypot: humans never see it, so a value means a bot and the request is
 * answered as if it succeeded while nothing is stored. Message text, names and emails are never
 * logged. The raw network address is never stored; only the same one-way hash the console uses
 * for rate limits.
 */
export const CONTACT_BUCKET = 'contact-attachments'
export const CONTACT_BURST_RATE = { limit: 3, windowSeconds: 10 * 60 }
export const CONTACT_DAILY_RATE = { limit: 10, windowSeconds: 24 * 60 * 60 }
const PENDING_TTL_MS = 2 * 60 * 60 * 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const fileSchema = z.object({ name: z.string().trim().min(1).max(200), size: z.number().int().positive(), type: z.string().max(100) }).strict()
const startSchema = z.object({
  action: z.literal('start').optional(),
  name: z.string().max(400),
  email: z.string().max(400),
  reason: z.string().max(40),
  subject: z.string().max(600).optional().default(''),
  message: z.string().max(20_000),
  details: z.record(z.string().max(40), z.union([z.string().max(10_000), z.boolean()])).optional().default({}),
  links: z.array(z.string().max(2_000)).max(20).optional().default([]),
  files: z.array(fileSchema).max(20).optional().default([]),
  website: z.string().max(500).optional()
}).strict()
const tokenSchema = z.object({ action: z.enum(['finalize', 'cancel']), id: z.string().regex(UUID), token: z.string().regex(/^[0-9a-f]{64}$/) }).strict()

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g
const clean = (value: string) => value.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS, '').trim()

export interface PlannedAttachment { path: string; name: string; size: number; type: AttachmentMime; verified?: boolean }

export interface ValidStart {
  honeypot: boolean
  row: { name: string; email: string; reason: ContactReason; subject: string | null; message: string; details: Record<string, string | boolean>; links: string[] }
  files: Array<{ name: string; size: number; type: AttachmentMime }>
}

/** Parses and validates a start request. Throws 400 with per-field messages when invalid. */
export function parseStart(raw: unknown): ValidStart {
  const parsed = startSchema.safeParse(raw)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The message could not be read. Reload the page and try again.')
  const input = parsed.data
  const honeypot = Boolean(input.website?.trim())
  const details = Object.fromEntries(Object.entries(input.details).map(([key, value]) => [key, typeof value === 'string' ? clean(value) : value]))
  const draft = { name: clean(input.name), email: clean(input.email), reason: input.reason as ContactReason, subject: clean(input.subject), message: clean(input.message), details, links: input.links.map(clean) }
  const errors = validateContactDraft(draft)
  const fileIssue = attachmentProblem(input.files)
  if (fileIssue) errors.files = fileIssue
  if (Object.keys(errors).length) {
    const error = new ApiError(400, 'invalid_message', Object.values(errors)[0] ?? 'Check the highlighted fields.')
    ;(error as ApiError & { fields?: Record<string, string> }).fields = errors as Record<string, string>
    throw error
  }
  if (!isContactReason(draft.reason)) throw new ApiError(400, 'invalid_message', 'Choose why you are contacting us.')
  return {
    honeypot,
    row: {
      name: draft.name,
      email: draft.email,
      reason: draft.reason,
      subject: draft.subject || null,
      message: draft.message,
      details: cleanContactDetails(draft.reason, draft.details),
      links: cleanContactLinks(draft.links).slice(0, CONTACT_LIMITS.links.max)
    },
    files: input.files.map(file => ({ name: file.name, size: file.size, type: attachmentMime(file.name, file.type)! }))
  }
}

export function hashToken(token: string): string {
  return createHash('sha256').update(`stracker-contact:${token}`).digest('hex')
}

function tokenMatches(token: string, storedHash: string | null): boolean {
  if (!storedHash) return false
  const a = Buffer.from(hashToken(token), 'hex')
  const b = Buffer.from(storedHash, 'hex')
  return a.length === b.length && timingSafeEqual(a, b)
}

async function takeSlot(admin: SupabaseClient, key: string, bucket: string, rule: { limit: number; windowSeconds: number }): Promise<void> {
  const { data, error } = await admin.rpc('control_take_rate_slot', { actor_key: key, bucket, per_limit: rule.limit, window_seconds: rule.windowSeconds })
  if (error) throw new ApiError(503, 'rate_limit_unavailable', 'Messages cannot be sent right now. Try again in a few minutes.')
  if (data !== true) throw new ApiError(429, 'rate_limited', 'You have sent several messages recently. Wait a while before sending another.')
}

async function optionalUserId(req: ApiRequest, url: string, anonKey: string): Promise<string | null> {
  const match = typeof req.headers.authorization === 'string' ? /^Bearer\s+([^\s]+)$/i.exec(req.headers.authorization) : null
  if (!match?.[1]) return null
  try {
    const client = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } })
    const { data, error } = await client.auth.getClaims(match[1])
    const sub = (data?.claims as { sub?: unknown } | undefined)?.sub
    return !error && typeof sub === 'string' && UUID.test(sub) ? sub : null
  } catch {
    return null
  }
}

/** Removes every stored file of a message. Never throws; returns false when the files may remain. */
export async function removeMessageFiles(admin: SupabaseClient, id: string): Promise<boolean> {
  try {
    const { data, error } = await admin.storage.from(CONTACT_BUCKET).list(id, { limit: 100 })
    if (error) throw error
    const paths = (data ?? []).map(object => `${id}/${object.name}`)
    if (paths.length) {
      const { error: removeError } = await admin.storage.from(CONTACT_BUCKET).remove(paths)
      if (removeError) throw removeError
    }
    return true
  } catch {
    logAIEvent('warn', 'contact_file_cleanup_failed', {})
    return false
  }
}

/** Deletes pending messages that were never finalised (and their files). Best effort. */
async function sweepStalePending(admin: SupabaseClient, now = Date.now()): Promise<void> {
  try {
    const { data } = await admin.from('contact_messages').select('id').eq('status', 'pending').lt('created_at', new Date(now - PENDING_TTL_MS).toISOString()).limit(20)
    for (const row of data ?? []) {
      await removeMessageFiles(admin, String(row.id))
      await admin.from('contact_messages').delete().eq('id', row.id).eq('status', 'pending')
    }
  } catch {
    // Cleanup must never block a new message.
  }
}

/** Reads the first bytes of a stored object through a short-lived signed URL. */
export async function readObjectHead(admin: SupabaseClient, path: string, length = 16): Promise<Uint8Array> {
  const { data, error } = await admin.storage.from(CONTACT_BUCKET).createSignedUrl(path, 60)
  if (error || !data?.signedUrl) throw new Error('signed_url_failed')
  const response = await fetch(data.signedUrl, { headers: { Range: `bytes=0-${length - 1}` } })
  if (!response.ok || !response.body) throw new Error('head_read_failed')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  while (received < length) {
    const { value, done } = await reader.read()
    if (done || !value) break
    chunks.push(value)
    received += value.byteLength
  }
  await reader.cancel().catch(() => undefined)
  const head = new Uint8Array(Math.min(received, length))
  let offset = 0
  for (const chunk of chunks) {
    const part = chunk.subarray(0, head.length - offset)
    head.set(part, offset)
    offset += part.length
    if (offset >= head.length) break
  }
  return head
}

export interface StoredObject { name: string; size: number; mimetype: string }

/**
 * Decides whether the uploaded objects match what was declared. Pure: the caller lists the
 * folder and reads each file's first bytes. Returns a sender-facing problem, or null.
 */
export function uploadProblem(planned: readonly PlannedAttachment[], objects: readonly StoredObject[], heads: ReadonlyMap<string, Uint8Array>, id: string): string | null {
  if (objects.length !== planned.length) return objects.length < planned.length ? 'Some files did not finish uploading. Try sending again.' : 'Unexpected files were uploaded. Try sending again.'
  let total = 0
  for (const file of planned) {
    const object = objects.find(item => `${id}/${item.name}` === file.path)
    if (!object) return `“${file.name}” did not finish uploading. Try sending again.`
    if (object.size !== file.size || object.size > ATTACHMENT_RULES.maxFileBytes) return `“${file.name}” is not the size that was declared, or is larger than 10 MB.`
    if (object.mimetype.toLowerCase() !== file.type) return `“${file.name}” is not a PDF, JPG or PNG file.`
    const head = heads.get(file.path)
    if (!head || !magicBytesMatch(file.type, head)) return `“${file.name}” does not look like a real ${file.type === 'application/pdf' ? 'PDF' : file.type === 'image/png' ? 'PNG' : 'JPG'} file.`
    total += object.size
  }
  if (total > ATTACHMENT_RULES.maxTotalBytes) return 'Attachments add up to more than 15 MB.'
  return null
}

async function start(req: ApiRequest, res: ApiResponse, body: unknown): Promise<void> {
  const input = parseStart(body)
  if (input.honeypot) { sendJson(res, 200, { ok: true, id: null, uploads: [] }); return }
  const { url, anonKey, admin } = serviceClient()
  const clientHash = clientKeyHash(req)
  await takeSlot(admin, `contact:${clientHash}`, 'contact-burst', CONTACT_BURST_RATE)
  await takeSlot(admin, `contact:${clientHash}`, 'contact-day', CONTACT_DAILY_RATE)
  await sweepStalePending(admin)
  const userId = await optionalUserId(req, url, anonKey)

  const id = randomUUID()
  const token = randomBytes(32).toString('hex')
  const attachments: PlannedAttachment[] = input.files.map((file, index) => ({ path: `${id}/${index + 1}-${safeFileName(file.name)}`, name: file.name.slice(0, 200), size: file.size, type: file.type }))
  const hasFiles = attachments.length > 0
  const { error } = await admin.from('contact_messages').insert({
    id,
    ...input.row,
    attachments,
    status: hasFiles ? 'pending' : 'new',
    user_id: userId,
    client_hash: clientHash,
    upload_token_hash: hasFiles ? hashToken(token) : null
  })
  if (error) {
    logAIEvent('error', 'contact_insert_failed', { code: error.code ?? '' })
    throw new ApiError(503, 'contact_unavailable', 'Your message could not be saved. Try again in a few minutes.')
  }
  if (!hasFiles) {
    logAIEvent('info', 'contact_message_received', { reason: input.row.reason, files: 0, signed_in: Boolean(userId) })
    sendJson(res, 200, { ok: true, id, uploads: [], finalised: true })
    return
  }
  const uploads: Array<{ index: number; path: string; signedUrl: string; token: string }> = []
  for (const [index, file] of attachments.entries()) {
    const { data, error: signError } = await admin.storage.from(CONTACT_BUCKET).createSignedUploadUrl(file.path)
    if (signError || !data) {
      await admin.from('contact_messages').delete().eq('id', id)
      throw new ApiError(503, 'upload_unavailable', 'File uploads are unavailable right now. Send the message without files, or try again later.')
    }
    uploads.push({ index, path: file.path, signedUrl: data.signedUrl, token: data.token })
  }
  sendJson(res, 200, { ok: true, id, token, uploads, finalised: false })
}

async function finishOrCancel(res: ApiResponse, body: unknown): Promise<void> {
  const parsed = tokenSchema.safeParse(body)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'The upload could not be confirmed. Send the message again.')
  const { action, id, token } = parsed.data
  const { admin } = serviceClient()
  const { data: row, error } = await admin.from('contact_messages').select('id, status, attachments, upload_token_hash, reason, user_id').eq('id', id).maybeSingle()
  if (error) throw new ApiError(503, 'contact_unavailable', 'Your message could not be confirmed. Try again in a few minutes.')
  if (!row || row.status !== 'pending' || !tokenMatches(token, row.upload_token_hash as string | null)) throw new ApiError(404, 'not_found', 'That message upload has expired. Send the message again.')

  const discard = async () => {
    await removeMessageFiles(admin, id)
    await admin.from('contact_messages').delete().eq('id', id).eq('status', 'pending')
  }
  if (action === 'cancel') { await discard(); sendJson(res, 200, { ok: true }); return }

  const planned = (Array.isArray(row.attachments) ? row.attachments : []) as PlannedAttachment[]
  const { data: listed, error: listError } = await admin.storage.from(CONTACT_BUCKET).list(id, { limit: 100 })
  if (listError) throw new ApiError(503, 'contact_unavailable', 'Your files could not be checked. Try again in a moment.')
  const objects: StoredObject[] = (listed ?? []).map(object => {
    const metadata = (object.metadata ?? {}) as { size?: number; mimetype?: string }
    return { name: object.name, size: Number(metadata.size ?? -1), mimetype: String(metadata.mimetype ?? '') }
  })
  const heads = new Map<string, Uint8Array>()
  for (const file of planned) {
    try { heads.set(file.path, await readObjectHead(admin, file.path)) } catch { /* treated as missing below */ }
  }
  const problem = uploadProblem(planned, objects, heads, id)
  if (problem) {
    await discard()
    logAIEvent('warn', 'contact_upload_rejected', { files: planned.length })
    throw new ApiError(400, 'invalid_upload', `${problem} Nothing was sent.`)
  }
  const { error: updateError } = await admin.from('contact_messages')
    .update({ status: 'new', upload_token_hash: null, attachments: planned.map(file => ({ ...file, verified: true })), updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'pending')
  if (updateError) throw new ApiError(503, 'contact_unavailable', 'Your message could not be confirmed. Try again in a few minutes.')
  logAIEvent('info', 'contact_message_received', { reason: String(row.reason), files: planned.length, signed_in: Boolean(row.user_id) })
  sendJson(res, 200, { ok: true, id, finalised: true })
}

export async function contactHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  res.setHeader('X-Robots-Tag', 'noindex')
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); sendJson(res, 405, { error: 'method_not_allowed', message: 'POST only.' }); return }
  try {
    const body = await readJson(req, 64_000)
    if (body.action === 'finalize' || body.action === 'cancel') await finishOrCancel(res, body)
    else await start(req, res, body)
  } catch (error) {
    const result = publicError(error)
    const fields = (error as { fields?: Record<string, string> }).fields
    sendJson(res, result.status, fields ? { ...result.body, fields } : result.body)
  }
}
