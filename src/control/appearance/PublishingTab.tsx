import { useState, type ReactNode } from 'react'
import { ChangeList } from './ChangeList'
import { useContentEditor, type AppearanceState } from './ContentEditor'
import { CONSOLE_BASE, formatDateTime } from '../policy'
import { useTimeZone } from '../time'
import { Button, Dialog, Panel, Segmented } from '../ui'
import { diffSiteValues, resolveSiteValues, type ContentChange } from '../../lib/site-content/content'
import { PREVIEW_DEVICES, type PreviewDevice } from './devices'

type Dialogs = null | { kind: 'publish' } | { kind: 'discard' } | { kind: 'restore'; version: number; changes: ContentChange[] }
type Notice = { tone: 'ok' | 'crit'; text: string } | null

const NOTE_LIMIT = 280

/** Plain-language status line for a published version. */
function versionLabel(version: number): string {
  return version > 0 ? `Version ${version}` : 'Built-in copy'
}

export function PublishingTab() {
  const editor = useContentEditor()
  const { zone } = useTimeZone()
  const [device, setDevice] = useState<PreviewDevice>('phone')
  const [frameKey, setFrameKey] = useState(0)
  const [note, setNote] = useState('')
  const [dialog, setDialog] = useState<Dialogs>(null)
  const [notice, setNotice] = useState<Notice>(null)
  const [expanded, setExpanded] = useState<number | null>(null)

  const state: AppearanceState | undefined = editor.state
  const unsaved = editor.dirtyKeys.length
  const hasErrors = Object.keys(editor.errors).length > 0
  const changes = editor.draftChanges
  const canPublish = editor.draftExists && changes.length > 0 && unsaved === 0 && !hasErrors && !editor.busy
  const deviceInfo = PREVIEW_DEVICES.find(item => item.value === device) ?? PREVIEW_DEVICES[0]!

  const closeDialog = () => { if (!editor.busy) setDialog(null) }

  const runPublish = async () => {
    const result = await editor.publish(note.trim())
    setDialog(null)
    setNote('')
    setNotice(result.ok ? { tone: 'ok', text: result.message } : { tone: 'crit', text: result.message })
    setFrameKey(key => key + 1)
  }

  const runDiscard = async () => {
    const result = await editor.discardDraft()
    setDialog(null)
    setNotice(result.ok ? { tone: 'ok', text: result.message } : { tone: 'crit', text: result.message })
    setFrameKey(key => key + 1)
  }

  const runRestore = async (version: number) => {
    const result = await editor.restore(version, note.trim())
    setDialog(null)
    setNote('')
    setNotice(result.ok ? { tone: 'ok', text: result.message } : { tone: 'crit', text: result.message })
    setFrameKey(key => key + 1)
  }

  if (editor.loadError) return <Panel title="Publishing could not be loaded"><p className="cc-muted">{editor.loadError.message}</p><Button onClick={editor.reload}>Try again</Button></Panel>

  return <>
    {notice && <div className={`cc-note ${notice.tone === 'crit' ? 'cc-note--crit' : ''}`} role="status">{notice.text}</div>}

    <div className="cc-appearance-grid">
      <Panel title="Live now" description="What visitors see on the public website.">
        <dl className="cc-dl">
          <div><dt>Version</dt><dd>{versionLabel(state?.published.version ?? 0)}</dd></div>
          <div><dt>Published</dt><dd>{state?.published.publishedAt ? formatDateTime(state.published.publishedAt, zone) : 'Not yet'}</dd></div>
          <div><dt>Published by</dt><dd>{state?.published.version ? (state.published.publishedByYou ? 'You' : 'Another owner') : '—'}</dd></div>
        </dl>
      </Panel>
      <Panel title="Unpublished draft" description="Saved for you. Not visible to visitors.">
        <dl className="cc-dl">
          <div><dt>Changes waiting</dt><dd>{editor.draftExists ? changes.length : 0}</dd></div>
          <div><dt>Last saved</dt><dd>{state?.draft.exists && state.draft.updatedAt ? formatDateTime(state.draft.updatedAt, zone) : '—'}</dd></div>
        </dl>
        {unsaved > 0 && <p className="cc-note cc-note--warn">You have {unsaved} unsaved {unsaved === 1 ? 'edit' : 'edits'} on the editor tabs. Save the draft first; publishing and preview use the saved draft only.</p>}
      </Panel>
    </div>

    <Panel
      title="Review and publish"
      description="Publishing makes the saved draft live as one new version. Every related field is published together, and a failed publish leaves the live site as it was."
      actions={<div className="cc-panel__actions-row">
        <Button variant="ghost" disabled={!editor.draftExists || editor.busy} onClick={() => setDialog({ kind: 'discard' })}>Discard draft</Button>
        <Button variant="primary" disabled={!canPublish} onClick={() => setDialog({ kind: 'publish' })}>Publish {changes.length > 0 ? `${changes.length} ${changes.length === 1 ? 'change' : 'changes'}` : 'changes'}…</Button>
      </div>}
    >
      {changes.length === 0
        ? <p className="cc-muted">{editor.draftExists ? 'The saved draft matches the live copy. Nothing to publish.' : 'No unpublished changes. Edit copy on the Public website or Navigation tabs, then save a draft.'}</p>
        : <ChangeList changes={changes} />}
      {hasErrors && <p className="cc-note cc-note--crit" role="alert">Some edits are invalid. Fix them on the editor tabs before publishing.</p>}
    </Panel>

    <Panel
      title="Preview"
      description="A live view of the public homepage with the saved draft. Save your edits first, then reload the preview."
      actions={<div className="cc-panel__actions-row">
        <Segmented label="Preview size" value={device} options={PREVIEW_DEVICES.map(item => ({ value: item.value, label: item.label }))} onChange={setDevice} />
        <Button onClick={() => setFrameKey(key => key + 1)}>Reload preview</Button>
      </div>}
    >
      <p className="cc-muted cc-preview-meta">{deviceInfo.label} · {deviceInfo.width} × {deviceInfo.height} px · scroll inside the frame to see the whole page.</p>
      <div className="cc-preview-frame-wrap">
        <iframe
          key={`${device}-${frameKey}`}
          title={`Public homepage preview, ${deviceInfo.label}`}
          src={`${CONSOLE_BASE}/preview/public`}
          width={deviceInfo.width}
          height={deviceInfo.height}
          className="cc-preview-frame"
          referrerPolicy="same-origin"
        />
      </div>
    </Panel>

    <Panel title="Version history" description="Every publish and restore is kept. Restoring publishes an earlier version as a new one; accounts, study data, roles and audit records are not touched.">
      {state && state.versions.length === 0
        ? <p className="cc-muted">No versions yet. The first publish creates version 1.</p>
        : <div className="cc-table-wrap" tabIndex={0}>
          <table className="cc-table">
            <thead><tr><th scope="col">Version</th><th scope="col">Action</th><th scope="col">When</th><th scope="col">By</th><th scope="col">Note</th><th scope="col"><span className="cc-sr-only">Actions</span></th></tr></thead>
            <tbody>
              {(state?.versions ?? []).map(version => {
                const diff = diffSiteValues(editor.publishedValues, resolveSiteValues(version.overrides))
                const isLive = version.version === state?.published.version
                return <VersionRow key={version.version} version={version} isLive={isLive} diffCount={diff.length} expanded={expanded === version.version} onToggle={() => setExpanded(current => current === version.version ? null : version.version)} zone={zone}
                  restoreAction={<Button size="sm" disabled={isLive || editor.busy} onClick={() => { setNote(''); setDialog({ kind: 'restore', version: version.version, changes: diff }) }}>Restore</Button>}
                  details={<ChangeList changes={diff} emptyText="Identical to the live copy." compact />}
                />
              })}
            </tbody>
          </table>
        </div>}
    </Panel>

    {dialog?.kind === 'publish' && <Dialog title="Publish these changes?" description="Visitors will see these changes right away. The previous version stays in history and can be restored." onClose={closeDialog} busy={editor.busy} footer={<>
      <Button variant="ghost" onClick={closeDialog} disabled={editor.busy}>Cancel</Button>
      <Button variant="primary" onClick={() => void runPublish()} disabled={editor.busy}>{editor.busy ? 'Publishing…' : 'Publish now'}</Button>
    </>}>
      <p className="cc-muted">A fresh authenticator code may be requested first. This keeps the change to the live website tied to a recent verification.</p>
      <ChangeList changes={changes} compact />
      <NoteField value={note} onChange={setNote} />
    </Dialog>}

    {dialog?.kind === 'discard' && <Dialog title="Discard unpublished changes?" description="The saved draft is deleted. The live copy stays exactly as it is." onClose={closeDialog} busy={editor.busy} danger footer={<>
      <Button variant="ghost" onClick={closeDialog} disabled={editor.busy}>Keep draft</Button>
      <Button variant="danger" onClick={() => void runDiscard()} disabled={editor.busy}>Discard draft</Button>
    </>}>
      <p className="cc-muted">{changes.length} unpublished {changes.length === 1 ? 'change' : 'changes'} will be removed.</p>
    </Dialog>}

    {dialog?.kind === 'restore' && <Dialog title={`Restore version ${dialog.version}?`} description="This publishes that earlier copy as a new live version. Unsaved draft changes are replaced by it." onClose={closeDialog} busy={editor.busy} footer={<>
      <Button variant="ghost" onClick={closeDialog} disabled={editor.busy}>Cancel</Button>
      <Button variant="primary" onClick={() => void runRestore(dialog.version)} disabled={editor.busy}>{editor.busy ? 'Restoring…' : 'Restore and publish'}</Button>
    </>}>
      {dialog.changes.length === 0
        ? <p className="cc-muted">That version matches the live copy, so there is nothing to restore.</p>
        : <ChangeList changes={dialog.changes} compact />}
      <NoteField value={note} onChange={setNote} />
    </Dialog>}
  </>
}

function NoteField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <div className="cc-field">
    <label htmlFor="cc-publish-note">Note for the history (optional)</label>
    <input id="cc-publish-note" className="cc-input" maxLength={NOTE_LIMIT} value={value} onChange={event => onChange(event.target.value)} placeholder="e.g. Updated the homepage heading" />
    <span className="cc-field__hint">{value.length}/{NOTE_LIMIT}</span>
  </div>
}

function VersionRow({ version, isLive, diffCount, expanded, onToggle, zone, restoreAction, details }: {
  version: AppearanceState['versions'][number]
  isLive: boolean
  diffCount: number
  expanded: boolean
  onToggle: () => void
  zone: string
  restoreAction: ReactNode
  details: ReactNode
}) {
  return <>
    <tr>
      <td>{version.version}{isLive && <span className="cc-badge cc-badge--ok cc-badge--inline">Live</span>}</td>
      <td>{version.action === 'restore' ? `Restored v${version.restoredFrom ?? '?'}` : 'Published'}</td>
      <td>{formatDateTime(version.createdAt, zone)}</td>
      <td>{version.createdByYou ? 'You' : 'Another owner'}</td>
      <td>{version.note ?? <span className="cc-muted">—</span>}</td>
      <td className="cc-table__actions">
        <Button size="sm" variant="ghost" aria-expanded={expanded} onClick={onToggle}>{expanded ? 'Hide' : 'Inspect'} ({diffCount})</Button>
        {restoreAction}
      </td>
    </tr>
    {expanded && <tr><td colSpan={6}>{details}</td></tr>}
  </>
}

