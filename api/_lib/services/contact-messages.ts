import { z } from 'zod'
import type { SupabaseClient } from '@supabase/supabase-js'
import { ApiError } from '../http.js'
import { CONTACT_REASON_VALUES, CONTACT_STATUSES } from '../../../src/lib/contact/reasons.js'
import { CONTACT_BUCKET, removeMessageFiles, type PlannedAttachment } from '../control-routes/contact.js'
import { MESSAGES_PAGE_SIZE, searchTerm } from '../control-routes/messages.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNED_URL_SECONDS = 300
const LIST_COLUMNS = 'id, created_at, name, email, reason, subject, message, status, read_at, attachments, links'
const messageId = z.string().regex(UUID)
const listInput = z.object({
  status: z.enum(['all', 'active', ...CONTACT_STATUSES]).default('active'),
  reason: z.enum(['all', ...CONTACT_REASON_VALUES]).default('all'),
  q: z.string().max(80).default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1)
}).strict()

function preview(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return value.length > 160 ? `${value.slice(0, 157)}…` : value
}

async function loadMessage(admin: SupabaseClient, id: string) {
  const parsed = messageId.safeParse(id)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'That message id is not valid.')
  const { data, error } = await admin.from('contact_messages').select('id, created_at, updated_at, name, email, reason, subject, message, details, links, attachments, status, read_at, user_id').eq('id', parsed.data).neq('status', 'pending').maybeSingle()
  if (error) throw new ApiError(503, 'messages_unavailable', 'The message could not be loaded. Try again.')
  if (!data) throw new ApiError(404, 'not_found', 'That message no longer exists.')
  return data as Record<string, unknown> & { id: string; status: string; attachments: unknown; user_id: string | null }
}

async function signFiles(admin: SupabaseClient, id: string, attachments: unknown) {
  const planned = (Array.isArray(attachments) ? attachments : []) as PlannedAttachment[]
  return Promise.all(planned.map(async file => {
    const safePath = typeof file.path === 'string' && file.path.startsWith(`${id}/`) && !file.path.includes('..') && !file.path.includes('\\')
    if (!safePath) return { name: file.name, size: file.size, type: file.type, viewUrl: null, downloadUrl: null }
    const { data } = await admin.storage.from(CONTACT_BUCKET).createSignedUrl(file.path, SIGNED_URL_SECONDS, { download: file.name })
    const { data: view } = await admin.storage.from(CONTACT_BUCKET).createSignedUrl(file.path, SIGNED_URL_SECONDS)
    return { name: file.name, size: file.size, type: file.type, viewUrl: view?.signedUrl ?? null, downloadUrl: data?.signedUrl ?? null }
  }))
}

export async function listContactMessages(admin: SupabaseClient, input: unknown = {}) {
  const parsed = listInput.safeParse(input ?? {})
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the message filters.')
  const { status, reason, q, page } = parsed.data
  let query = admin.from('contact_messages').select(LIST_COLUMNS, { count: 'exact' }).neq('status', 'pending')
  if (status === 'active') query = query.in('status', ['new', 'read'])
  else if (status !== 'all') query = query.eq('status', status)
  if (reason !== 'all') query = query.eq('reason', reason)
  const term = searchTerm(q)
  if (term) query = query.or(['name', 'email', 'subject', 'message'].map(column => `${column}.ilike.*${term}*`).join(','))
  const from = (page - 1) * MESSAGES_PAGE_SIZE
  const [{ data, error, count }, unread, reasons] = await Promise.all([
    query.order('created_at', { ascending: false }).range(from, from + MESSAGES_PAGE_SIZE - 1),
    admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('contact_messages').select('reason').neq('status', 'pending')
  ])
  if (error || unread.error || reasons.error) throw new ApiError(503, 'messages_unavailable', 'Messages could not be loaded. Try again.')
  const reasonCounts: Record<string, number> = {}
  for (const row of reasons.data ?? []) {
    const key = String((row as { reason?: string }).reason ?? 'unknown')
    reasonCounts[key] = (reasonCounts[key] ?? 0) + 1
  }
  return {
    page,
    pageSize: MESSAGES_PAGE_SIZE,
    total: count ?? 0,
    unread: unread.count ?? 0,
    reasonCounts,
    emailSending: false,
    emailSendingNote: 'Stracker does not send email replies from this inbox. Do not claim that a reply was sent.',
    messages: (data ?? []).map(row => ({
      id: row.id,
      created_at: row.created_at,
      name: row.name,
      email: row.email,
      reason: row.reason,
      subject: row.subject,
      status: row.status,
      read_at: row.read_at,
      preview: preview(row.message),
      fileCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
      linkCount: Array.isArray(row.links) ? row.links.length : 0
    }))
  }
}

export async function getContactMessage(admin: SupabaseClient, id: string) {
  const row = await loadMessage(admin, id)
  const files = await signFiles(admin, row.id, row.attachments)
  const { attachments: _stored, user_id: userId, ...rest } = row
  void _stored
  return {
    message: { ...rest, signedIn: Boolean(userId), files, linkExpiresInSeconds: SIGNED_URL_SECONDS },
    emailSending: false,
    emailSendingNote: 'Attachment links expire in five minutes. Permanent storage URLs and bucket credentials are never returned. Email sending is not available.'
  }
}

export async function updateContactMessageStatus(admin: SupabaseClient, id: string, status: unknown) {
  const parsed = z.enum(CONTACT_STATUSES).safeParse(status)
  if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Mark the message as new, read or archived.')
  const existing = await loadMessage(admin, id)
  const now = new Date().toISOString()
  const patch = { status: parsed.data, updated_at: now, ...(parsed.data === 'new' ? { read_at: null } : existing.status === 'new' ? { read_at: now } : {}) }
  const { error } = await admin.from('contact_messages').update(patch).eq('id', existing.id)
  if (error) throw new ApiError(503, 'message_update_failed', 'The message was not updated. Try again.')
  return { ok: true, id: existing.id, status: parsed.data }
}

export async function archiveContactMessage(admin: SupabaseClient, id: string) {
  return updateContactMessageStatus(admin, id, 'archived')
}

export async function deleteContactMessage(admin: SupabaseClient, id: string) {
  const existing = await loadMessage(admin, id)
  if (!await removeMessageFiles(admin, existing.id)) {
    throw new ApiError(503, 'message_files_delete_failed', 'The attached files could not be deleted, so the message was kept. Try again.')
  }
  const { error } = await admin.from('contact_messages').delete().eq('id', existing.id)
  if (error) throw new ApiError(503, 'message_delete_failed', 'The message was not deleted. Try again.')
  return { ok: true, deleted: true, id: existing.id }
}

export { messageId }
