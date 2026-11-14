import { useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, Download, ExternalLink, FileText, Inbox, Mail, MailOpen, Paperclip, Reply, Search, Trash2 } from 'lucide-react'
import { controlFetch } from '../api'
import { Badge, Button, Dialog, EmptyState, ErrorState, Pager, Panel, Segmented, Skeleton, type Tone } from '../ui'
import { PageHeader } from '../pageParts'
import { formatDateTime } from '../policy'
import { useTimeZone } from '../time'
import { useToast } from '../../contexts/ToastContext'
import { CONTACT_REASONS, contactReasonLabel, formatBytes, messageRows, type ContactStatus } from '../../lib/contact/reasons'
import { replyHref, safeHttpUrl, type MessageDetail, type MessageSummary } from './format'

interface ListResponse { messages: MessageSummary[]; total: number; unread: number; page: number; pageSize: number }

type StatusFilter = 'active' | 'new' | 'read' | 'archived' | 'all'
const STATUS_OPTIONS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'active', label: 'Inbox' }, { value: 'new', label: 'Unread' }, { value: 'read', label: 'Read' }, { value: 'archived', label: 'Archived' }, { value: 'all', label: 'All' }
]
const REASON_TONE: Record<string, Tone> = { bug_report: 'crit', complaint: 'warn', copyright: 'warn', feature_request: 'info', sponsorship: 'ok', general_query: 'neutral' }
const STATUS_LABEL: Record<ContactStatus, string> = { new: 'Unread', read: 'Read', archived: 'Archived' }

function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => { const timer = setTimeout(() => setSettled(value), delay); return () => clearTimeout(timer) }, [value, delay])
  return settled
}

/**
 * Control Centre → Messages: everything sent from the public Contact page. Opening an unread
 * message marks it read. Files open through 5-minute signed links from the owner-only API.
 */
export default function MessagesPage() {
  const [status, setStatus] = useState<StatusFilter>('active')
  const [reason, setReason] = useState('all')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState<string | null>(null)
  const query = useDebounced(search.trim())
  const { zone } = useTimeZone()
  const params = useMemo(() => new URLSearchParams({ status, reason, q: query, page: String(page) }).toString(), [status, reason, query, page])

  useEffect(() => { setPage(1) }, [status, reason, query])

  const list = useQuery({ queryKey: ['control', 'messages', 'list', params], queryFn: () => controlFetch<ListResponse>(`messages?${params}`), placeholderData: previous => previous })

  return <div className="cc-stack">
    <PageHeader title="Messages" description="Messages sent from the Contact page of the Stracker website. Reply by email, then archive or delete them." />
    <div className="cc-toolbar cc-toolbar--wrap cc-msg-toolbar">
      <Segmented label="Show" value={status} options={STATUS_OPTIONS} onChange={setStatus} />
      <label className="cc-msg-filter">
        <span className="cc-sr-only">Reason</span>
        <select className="cc-input" value={reason} onChange={event => setReason(event.target.value)} aria-label="Filter by reason">
          <option value="all">All reasons</option>
          {CONTACT_REASONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
        </select>
      </label>
      <label className="cc-search cc-msg-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Search name, email, subject or text" aria-label="Search messages" maxLength={80} />
      </label>
    </div>

    <div className={`cc-msg-layout ${selected ? 'has-selection' : ''}`}>
      <Panel title={list.data ? `${list.data.total.toLocaleString()} message${list.data.total === 1 ? '' : 's'}${list.data.unread ? ` · ${list.data.unread} unread` : ''}` : 'Messages'} className="cc-msg-list-panel">
        {list.isPending ? <Skeleton rows={6} height={18} />
          : list.isError && !list.data ? <ErrorState message={list.error instanceof Error ? list.error.message : 'Messages could not be loaded.'} onRetry={() => void list.refetch()} />
          : list.data && list.data.messages.length === 0 ? <EmptyState title={status === 'active' && reason === 'all' && !query ? 'No messages yet' : 'No messages match'} body={status === 'active' && reason === 'all' && !query ? 'Messages sent from the Contact page will appear here.' : 'Try another filter or search.'} />
          : <>
            <ul className="cc-msg-list" aria-label="Messages">
              {list.data!.messages.map(item => <li key={item.id}>
                <button type="button" className={`cc-msg-row ${item.status === 'new' ? 'is-unread' : ''} ${selected === item.id ? 'is-selected' : ''}`} aria-current={selected === item.id ? 'true' : undefined} onClick={() => setSelected(item.id)}>
                  <span className="cc-msg-row__top">
                    {item.status === 'new' ? <Mail size={15} aria-label="Unread" /> : <MailOpen size={15} aria-hidden="true" />}
                    <strong>{item.name}</strong>
                    <time dateTime={item.created_at}>{formatDateTime(item.created_at, zone)}</time>
                  </span>
                  <span className="cc-msg-row__subject">{item.subject || contactReasonLabel(item.reason)}</span>
                  <span className="cc-msg-row__preview">{item.preview}</span>
                  <span className="cc-msg-row__meta">
                    <Badge tone={REASON_TONE[item.reason] ?? 'neutral'}>{contactReasonLabel(item.reason)}</Badge>
                    {item.status === 'archived' && <Badge>Archived</Badge>}
                    {item.fileCount > 0 && <span className="cc-muted"><Paperclip size={12} aria-hidden="true" /> {item.fileCount}</span>}
                  </span>
                </button>
              </li>)}
            </ul>
            <Pager page={page} pageSize={list.data!.pageSize} total={list.data!.total} onPage={setPage} />
          </>}
      </Panel>
      {selected
        ? <MessageDetailPanel key={selected} id={selected} onClose={() => setSelected(null)} />
        : <Panel title="Message" className="cc-msg-detail-panel cc-msg-detail-panel--empty"><EmptyState title="Choose a message" body={<span><Inbox size={14} aria-hidden="true" /> Select a message on the left to read it.</span>} /></Panel>}
    </div>
  </div>
}

function MessageDetailPanel({ id, onClose }: { id: string; onClose: () => void }) {
  const client = useQueryClient()
  const { notify } = useToast()
  const { zone } = useTimeZone()
  const [confirmDelete, setConfirmDelete] = useState(false)
  const detail = useQuery({ queryKey: ['control', 'messages', 'detail', id], queryFn: () => controlFetch<{ message: MessageDetail }>(`messages?id=${id}`), staleTime: 60_000 })
  const refresh = () => client.invalidateQueries({ queryKey: ['control', 'messages'] })

  const setStatus = useMutation({
    mutationFn: (status: ContactStatus) => controlFetch<{ status: ContactStatus }>('messages', { method: 'POST', body: { action: 'status', id, status } }),
    onSuccess: result => {
      client.setQueryData<{ message: MessageDetail }>(['control', 'messages', 'detail', id], current => current ? { message: { ...current.message, status: result.status } } : current)
      void refresh()
    },
    onError: error => notify(error instanceof Error ? error.message : 'The message was not updated.', 'error')
  })
  const remove = useMutation({
    mutationFn: () => controlFetch<{ deleted: boolean }>('messages', { method: 'POST', body: { action: 'delete', id } }),
    onSuccess: () => { setConfirmDelete(false); notify('Message deleted.'); onClose(); void refresh() },
    onError: error => notify(error instanceof Error ? error.message : 'The message was not deleted.', 'error')
  })

  const message = detail.data?.message
  // Opening an unread message marks it read (the owner can mark it unread again).
  const marked = useRef(false)
  const markRead = setStatus.mutate
  useEffect(() => {
    if (message?.status === 'new' && !marked.current) { marked.current = true; markRead('read') }
  }, [message?.status, markRead])

  if (detail.isPending) return <Panel title="Message" className="cc-msg-detail-panel"><Skeleton rows={8} height={16} /></Panel>
  if (detail.isError || !message) return <Panel title="Message" className="cc-msg-detail-panel"><ErrorState message={detail.error instanceof Error ? detail.error.message : 'The message could not be loaded.'} onRetry={() => void detail.refetch()} /></Panel>

  const rows = messageRows(message.reason, message.message, message.details)
  const busy = setStatus.isPending || remove.isPending

  return <Panel
    title={message.subject || contactReasonLabel(message.reason)}
    description={<span className="cc-msg-from"><strong>{message.name}</strong> · <a className="cc-link" href={`mailto:${message.email}`}>{message.email}</a>{message.signedIn ? ' · signed-in student' : ''}</span>}
    className="cc-msg-detail-panel"
    actions={<Button variant="ghost" size="sm" className="cc-msg-back" onClick={onClose}>Back to list</Button>}
  >
    <div className="cc-msg-detail">
      <div className="cc-msg-badges">
        <Badge tone={REASON_TONE[message.reason] ?? 'neutral'}>{contactReasonLabel(message.reason)}</Badge>
        <Badge tone={message.status === 'new' ? 'info' : 'neutral'}>{STATUS_LABEL[message.status]}</Badge>
        <time className="cc-muted" dateTime={message.created_at}>Sent {formatDateTime(message.created_at, zone)}</time>
      </div>

      <div className="cc-msg-actions">
        <a className="cc-btn cc-btn--primary cc-btn--sm" href={replyHref(message)}><Reply size={14} aria-hidden="true" /> Reply by email</a>
        {message.status === 'new'
          ? <Button size="sm" disabled={busy} onClick={() => setStatus.mutate('read')}><MailOpen size={14} aria-hidden="true" /> Mark read</Button>
          : <Button size="sm" disabled={busy} onClick={() => setStatus.mutate('new')}><Mail size={14} aria-hidden="true" /> Mark unread</Button>}
        {message.status === 'archived'
          ? <Button size="sm" disabled={busy} onClick={() => setStatus.mutate('read')}><ArchiveRestore size={14} aria-hidden="true" /> Move to inbox</Button>
          : <Button size="sm" disabled={busy} onClick={() => setStatus.mutate('archived')}><Archive size={14} aria-hidden="true" /> Archive</Button>}
        <Button size="sm" variant="danger" disabled={busy} onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true" /> Delete</Button>
      </div>

      <dl className="cc-msg-details" aria-label="What the sender wrote">
        {rows.map(row => {
          const url = row.type === 'url' && typeof row.value === 'string' ? safeHttpUrl(row.value) : null
          return <div key={row.key} className={row.type === 'multiline' ? 'is-block' : undefined}>
            <dt>{row.label}</dt>
            <dd className={row.type === 'multiline' ? 'cc-msg-body' : undefined}>{row.type === 'checkbox' ? (row.value === true ? 'Confirmed by the sender' : 'Not confirmed') : url ? <a className="cc-link" href={url} target="_blank" rel="noopener noreferrer nofollow">{row.value as string} <ExternalLink size={12} aria-hidden="true" /></a> : String(row.value)}</dd>
          </div>
        })}
      </dl>

      {message.links.length > 0 && <div className="cc-msg-section">
        <h3>Links</h3>
        <ul className="cc-msg-links">
          {message.links.map(link => {
            const url = safeHttpUrl(link)
            return <li key={link}>{url ? <a className="cc-link" href={url} target="_blank" rel="noopener noreferrer nofollow">{link} <ExternalLink size={12} aria-hidden="true" /></a> : <span>{link}</span>}</li>
          })}
        </ul>
      </div>}

      {message.files.length > 0 && <div className="cc-msg-section">
        <h3>Attachments <span className="cc-muted">· links last {Math.round(message.linkExpiresInSeconds / 60)} minutes; reopen the message for fresh ones</span></h3>
        <ul className="cc-msg-files">
          {message.files.map(file => <li key={file.name} className="cc-msg-file">
            {file.type.startsWith('image/') && file.viewUrl
              ? <a href={file.viewUrl} target="_blank" rel="noopener noreferrer" className="cc-msg-thumb"><img src={file.viewUrl} alt={`Attachment ${file.name}`} loading="lazy" /></a>
              : <span className="cc-msg-thumb cc-msg-thumb--doc" aria-hidden="true"><FileText size={26} /></span>}
            <span className="cc-msg-file__text"><strong>{file.name}</strong><small>{file.type === 'application/pdf' ? 'PDF' : file.type === 'image/png' ? 'PNG' : 'JPG'} · {formatBytes(file.size)}</small></span>
            <span className="cc-msg-file__actions">
              {file.viewUrl && <a className="cc-btn cc-btn--ghost cc-btn--sm" href={file.viewUrl} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} aria-hidden="true" /> Open</a>}
              {file.downloadUrl && <a className="cc-btn cc-btn--ghost cc-btn--sm" href={file.downloadUrl} rel="noopener noreferrer"><Download size={13} aria-hidden="true" /> Download</a>}
            </span>
          </li>)}
        </ul>
      </div>}
    </div>

    {confirmDelete && <Dialog
      title="Delete this message?"
      description="The message and any attached files are permanently deleted. This cannot be undone."
      danger
      busy={remove.isPending}
      onClose={() => setConfirmDelete(false)}
      footer={<>
        <Button variant="ghost" onClick={() => setConfirmDelete(false)} disabled={remove.isPending}>Keep message</Button>
        <Button variant="danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'Deleting…' : 'Delete message'}</Button>
      </>}
    >
      <p className="cc-muted">From {message.name} · {contactReasonLabel(message.reason)}</p>
    </Dialog>}
  </Panel>
}
