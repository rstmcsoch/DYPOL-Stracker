import { z } from 'zod'
import type { ApiRequest, ApiResponse } from '../http.js'
import { ApiError, readJson, sendJson } from '../http.js'
import { controlHandler, recordAuditEvent } from '../control.js'
import { CONTACT_REASON_VALUES, CONTACT_STATUSES } from '../../../src/lib/contact/reasons.js'
import { CONTACT_BUCKET, removeMessageFiles, type PlannedAttachment } from './contact.js'

/**
 * Owner-only (aal2) inbox for contact messages: Control Center → Messages.
 *   GET  /api/control/messages?summary=1                     { unread }
 *   GET  /api/control/messages?status=&reason=&q=&page=      list (pending uploads never shown)
 *   GET  /api/control/messages?id=<uuid>                     one message, with 5-minute signed file URLs
 *   POST /api/control/messages { action: 'status', id, status }   mark new (unread) / read / archived
 *   POST /api/control/messages { action: 'delete', id }            delete the message and its files
 * Status changes and deletions are audited by message id only (never content or email).
 */
export const MESSAGES_PAGE_SIZE = 25
const SIGNED_URL_SECONDS = 300
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const LIST_COLUMNS = 'id, created_at, name, email, reason, subject, message, status, read_at, attachments, links'

const listQuery = z.object({
  status: z.enum(['all', 'active', ...CONTACT_STATUSES]).default('active'),
  reason: z.enum(['all', ...CONTACT_REASON_VALUES]).default('all'),
  q: z.string().max(80).default(''),
  page: z.coerce.number().int().min(1).max(10_000).default(1)
})
const actionBody = z.discriminatedUnion('action', [
  z.object({ action: z.literal('status'), id: z.string().regex(UUID), status: z.enum(CONTACT_STATUSES) }).strict(),
  z.object({ action: z.literal('delete'), id: z.string().regex(UUID) }).strict()
])

/** Search text safe to embed in a PostgREST `or` filter: letters, numbers, @ . _ - and spaces only. */
export function searchTerm(raw: string): string {
  return raw.replace(/[^\p{L}\p{N}@._ -]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
}

function preview(text: unknown): string {
  const value = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : ''
  return value.length > 160 ? `${value.slice(0, 157)}…` : value
}

export async function messagesHandler(req: ApiRequest, res: ApiResponse): Promise<void> {
  await controlHandler(req, res, ['GET', 'POST'], { requireAal2: true, permission: req2 => req2.method === 'GET' ? 'messages.view' : 'messages.manage' }, async context => {
    const admin = context.admin
    if (req.method === 'GET') {
      const params = new URL(req.url ?? '/', 'http://localhost').searchParams
      const unreadQuery = () => admin.from('contact_messages').select('id', { count: 'exact', head: true }).eq('status', 'new')

      if (params.get('summary') === '1') {
        const { count, error } = await unreadQuery()
        if (error) throw new ApiError(503, 'messages_unavailable', 'Messages could not be loaded. Try again.')
        sendJson(res, 200, { ok: true, unread: count ?? 0 })
        return
      }

      const id = params.get('id')
      if (id !== null) {
        if (!UUID.test(id)) throw new ApiError(400, 'invalid_request', 'That message id is not valid.')
        const { data: row, error } = await admin.from('contact_messages').select('id, created_at, updated_at, name, email, reason, subject, message, details, links, attachments, status, read_at, user_id').eq('id', id).neq('status', 'pending').maybeSingle()
        if (error) throw new ApiError(503, 'messages_unavailable', 'The message could not be loaded. Try again.')
        if (!row) throw new ApiError(404, 'not_found', 'That message no longer exists.')
        const planned = (Array.isArray(row.attachments) ? row.attachments : []) as PlannedAttachment[]
        const files = await Promise.all(planned.map(async file => {
          const { data } = await admin.storage.from(CONTACT_BUCKET).createSignedUrl(file.path, SIGNED_URL_SECONDS, { download: file.name })
          const { data: view } = await admin.storage.from(CONTACT_BUCKET).createSignedUrl(file.path, SIGNED_URL_SECONDS)
          return { name: file.name, size: file.size, type: file.type, viewUrl: view?.signedUrl ?? null, downloadUrl: data?.signedUrl ?? null }
        }))
        const { attachments: _stored, user_id: userId, ...rest } = row
        void _stored
        sendJson(res, 200, { ok: true, message: { ...rest, signedIn: Boolean(userId), files, linkExpiresInSeconds: SIGNED_URL_SECONDS } })
        return
      }

      const parsed = listQuery.safeParse(Object.fromEntries(params.entries()))
      if (!parsed.success) throw new ApiError(400, 'invalid_request', 'Check the message filters.')
      const { status, reason, q, page } = parsed.data
      let query = admin.from('contact_messages').select(LIST_COLUMNS, { count: 'exact' }).neq('status', 'pending')
      if (status === 'active') query = query.in('status', ['new', 'read'])
      else if (status !== 'all') query = query.eq('status', status)
      if (reason !== 'all') query = query.eq('reason', reason)
      const term = searchTerm(q)
      if (term) query = query.or(['name', 'email', 'subject', 'message'].map(column => `${column}.ilike.*${term}*`).join(','))
      const from = (page - 1) * MESSAGES_PAGE_SIZE
      const [{ data, error, count }, unread] = await Promise.all([
        query.order('created_at', { ascending: false }).range(from, from + MESSAGES_PAGE_SIZE - 1),
        unreadQuery()
      ])
      if (error) throw new ApiError(503, 'messages_unavailable', 'Messages could not be loaded. Try again.')
      sendJson(res, 200, {
        ok: true,
        page,
        pageSize: MESSAGES_PAGE_SIZE,
        total: count ?? 0,
        unread: unread.count ?? 0,
        messages: (data ?? []).map(row => ({
          id: row.id, created_at: row.created_at, name: row.name, email: row.email, reason: row.reason, subject: row.subject,
          status: row.status, read_at: row.read_at, preview: preview(row.message),
          fileCount: Array.isArray(row.attachments) ? row.attachments.length : 0,
          linkCount: Array.isArray(row.links) ? row.links.length : 0
        }))
      })
      return
    }

    const parsed = actionBody.safeParse(await readJson(req, 4_000))
    if (!parsed.success) throw new ApiError(400, 'invalid_request', 'That message action is not valid.')
    const input = parsed.data
    const audit = (action: string, outcome: 'success' | 'failed', summary?: Record<string, string>) =>
      recordAuditEvent(admin, { requestId: context.requestId, actorId: context.userId, actorRole: context.role, action, targetType: 'contact_message', targetId: input.id, outcome, severity: outcome === 'success' ? 'info' : 'warning', summary })

    const { data: existing, error: readError } = await admin.from('contact_messages').select('id, status').eq('id', input.id).neq('status', 'pending').maybeSingle()
    if (readError) throw new ApiError(503, 'messages_unavailable', 'The message could not be loaded. Nothing changed.')
    if (!existing) throw new ApiError(404, 'not_found', 'That message no longer exists.')

    if (input.action === 'status') {
      const now = new Date().toISOString()
      const patch = { status: input.status, updated_at: now, ...(input.status === 'new' ? { read_at: null } : existing.status === 'new' ? { read_at: now } : {}) }
      const { error } = await admin.from('contact_messages').update(patch).eq('id', input.id)
      if (error) { await audit('message.status', 'failed'); throw new ApiError(503, 'message_update_failed', 'The message was not updated. Try again.') }
      await audit('message.status', 'success', { status: input.status })
      sendJson(res, 200, { ok: true, status: input.status })
      return
    }

    if (!await removeMessageFiles(admin, input.id)) {
      await audit('message.delete', 'failed')
      throw new ApiError(503, 'message_files_delete_failed', 'The attached files could not be deleted, so the message was kept. Try again.')
    }
    const { error } = await admin.from('contact_messages').delete().eq('id', input.id)
    if (error) { await audit('message.delete', 'failed'); throw new ApiError(503, 'message_delete_failed', 'The message was not deleted. Try again.') }
    await audit('message.delete', 'success')
    sendJson(res, 200, { ok: true, deleted: true })
  })
}
