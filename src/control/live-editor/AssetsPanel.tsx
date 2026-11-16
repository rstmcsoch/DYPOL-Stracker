import { useMemo, useRef, useState } from 'react'
import { Check, Search, Trash2, Upload, Replace } from 'lucide-react'
import { Button } from '../ui'
import type { MediaKind } from '../../lib/site-content/media'
import { formatBytes, kindOfFile, useMediaLibrary, type MediaAsset } from './media-library'

export interface MediaTarget { id: string; label: string; kind: MediaKind; current: string; apply: (url: string, alt: string) => void }

/**
 * Assets library: every file uploaded for the public site, with search, upload, name and alt
 * text, where it is used, "use for the selected element", "replace everywhere in the draft"
 * and delete (refused while anything, including a saved version, still uses the file).
 */
export function AssetsPanel({ targets, targetName, inWorkingCopy, replaceEverywhere }: {
  targets: MediaTarget[]; targetName: string | null
  inWorkingCopy: (url: string) => boolean
  replaceEverywhere: (from: string, to: string) => number
}) {
  const library = useMediaLibrary()
  const [query, setQuery] = useState('')
  const [kind, setKind] = useState<'all' | MediaKind>('all')
  const [selected, setSelected] = useState<string | null>(null)
  const [replacing, setReplacing] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ tone: 'ok' | 'crit'; text: string } | null>(null)
  const [draft, setDraft] = useState<{ path: string; name: string; alt: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const needle = query.trim().toLowerCase()
  const assets = useMemo(() => library.assets.filter(asset => (kind === 'all' || asset.kind === kind) && (!needle || `${asset.name} ${asset.alt} ${asset.mime}`.toLowerCase().includes(needle))), [library.assets, kind, needle])
  const active = library.assets.find(asset => asset.path === selected) ?? null
  const replaceFrom = library.assets.find(asset => asset.path === replacing) ?? null

  const choose = (asset: MediaAsset) => {
    if (replaceFrom && replaceFrom.path !== asset.path) {
      if (replaceFrom.kind !== asset.kind) { setMessage({ tone: 'crit', text: `Choose another ${replaceFrom.kind}.` }); return }
      const count = replaceEverywhere(replaceFrom.url, asset.url)
      setMessage({ tone: count ? 'ok' : 'crit', text: count ? `Replaced in ${count} place${count === 1 ? '' : 's'} in the draft. Undo reverts it.` : 'That file is not used in the draft.' })
      setReplacing(null)
      setSelected(asset.path)
      return
    }
    setSelected(asset.path)
    setDraft({ path: asset.path, name: asset.name, alt: asset.alt })
    setMessage(null)
  }

  const uploadFiles = async (files: FileList | null) => {
    if (!files?.length) return
    setBusy(true)
    setMessage(null)
    try {
      for (const file of Array.from(files).slice(0, 10)) {
        const fileKind = kindOfFile(file)
        if (!fileKind) throw new Error(`${file.name}: use JPEG, PNG or WebP images, or MP4 videos.`)
        const url = await library.upload(fileKind, file)
        if (replaceFrom) {
          const count = replaceEverywhere(replaceFrom.url, url)
          setMessage({ tone: 'ok', text: `Uploaded and replaced in ${count} place${count === 1 ? '' : 's'} in the draft.` })
          setReplacing(null)
          break
        }
      }
      if (!replaceFrom) setMessage({ tone: 'ok', text: files.length === 1 ? 'Uploaded.' : `Uploaded ${Math.min(files.length, 10)} files.` })
    } catch (error) {
      setMessage({ tone: 'crit', text: error instanceof Error ? error.message : 'The upload did not finish.' })
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const saveMeta = async () => {
    if (!draft || !active || (draft.name === active.name && draft.alt === active.alt)) return
    try {
      await library.update(draft.path, { name: draft.name, alt: draft.alt })
      setMessage({ tone: 'ok', text: 'Saved.' })
    } catch (error) {
      setMessage({ tone: 'crit', text: error instanceof Error ? error.message : 'Not saved.' })
    }
  }

  const remove = async (asset: MediaAsset) => {
    if (inWorkingCopy(asset.url)) { setMessage({ tone: 'crit', text: 'This file is used on a page you are editing. Replace or remove it there first.' }); return }
    if (!window.confirm(`Delete “${asset.name || 'this file'}” from the library? This cannot be undone.`)) return
    try {
      await library.remove(asset.path)
      setSelected(null)
      setMessage({ tone: 'ok', text: 'Deleted.' })
    } catch (error) {
      setMessage({ tone: 'crit', text: error instanceof Error ? error.message : 'Not deleted.' })
    }
  }

  const usable = active ? targets.filter(target => target.kind === active.kind) : []

  return <div className="le-assets">
    <div className="le-inline-row">
      <input ref={fileRef} type="file" multiple accept="image/jpeg,image/png,image/webp,video/mp4" className="cc-sr-only" aria-label="Upload files" onChange={event => void uploadFiles(event.target.files)} />
      <Button size="sm" variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}><Upload size={14} aria-hidden="true" /> {busy ? 'Uploading…' : replaceFrom ? 'Upload replacement' : 'Upload'}</Button>
      <div className="le-devices" role="radiogroup" aria-label="File type">
        {(['all', 'image', 'video'] as const).map(item => <button key={item} type="button" role="radio" aria-checked={kind === item} className={`le-chip${kind === item ? ' is-active' : ''}`} onClick={() => setKind(item)}>{item === 'all' ? 'All' : item === 'image' ? 'Images' : 'Videos'}</button>)}
      </div>
    </div>
    <label className="le-search"><Search size={14} aria-hidden="true" /><input className="cc-input" type="search" placeholder="Search by name or description" value={query} onChange={event => setQuery(event.target.value)} aria-label="Search assets" /></label>
    {replaceFrom && <div className="le-banner is-warn" role="status">Choose or upload the file that replaces “{replaceFrom.name || 'this file'}” everywhere in the draft. <Button size="sm" variant="ghost" onClick={() => setReplacing(null)}>Cancel</Button></div>}
    {message && <p className={message.tone === 'ok' ? 'le-ok' : 'le-error'} role="status">{message.text}</p>}
    {library.query.isLoading && <p className="le-hint">Loading the library…</p>}
    {library.query.isError && <p className="le-error">The library could not be loaded. <Button size="sm" variant="ghost" onClick={() => void library.refresh()}>Try again</Button></p>}
    {!library.query.isLoading && !assets.length && <p className="le-hint">{library.assets.length ? 'No file matches.' : 'No uploads yet. JPEG, PNG and WebP images up to 5 MB, MP4 videos up to 50 MB.'}</p>}

    <ul className="le-asset-grid">
      {assets.map(asset => <li key={asset.path}>
        <button type="button" className={`le-asset${asset.path === selected ? ' is-active' : ''}`} onClick={() => choose(asset)} aria-pressed={asset.path === selected}>
          {asset.kind === 'image' ? <img src={asset.url} alt="" loading="lazy" /> : <video src={asset.url} preload="metadata" muted />}
          <span>{asset.name || asset.alt || 'Untitled'}</span>
          <small>{asset.usedLive ? 'Live' : asset.usedInDraft ? 'In draft' : asset.usedInVersions ? 'In history' : 'Unused'}</small>
        </button>
      </li>)}
    </ul>

    {active && draft?.path === active.path && <div className="le-card le-asset-detail">
      <p className="le-hint">{active.kind === 'image' ? 'Image' : 'Video'} · {active.mime.replace(/^\w+\//, '').toUpperCase()} · {formatBytes(active.bytes)}</p>
      <label className="le-field"><span className="le-field__label">Name (only you see this)</span>
        <input className="cc-input" maxLength={80} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} onBlur={() => void saveMeta()} /></label>
      {active.kind === 'image' && <label className="le-field"><span className="le-field__label">Alt text (describes the image for screen readers)</span>
        <input className="cc-input" maxLength={200} value={draft.alt} onChange={event => setDraft({ ...draft, alt: event.target.value })} onBlur={() => void saveMeta()} /></label>}
      {active.kind === 'image' && <p className="le-hint">Used as the alt text when this image is applied to an element whose alt text is empty.</p>}
      <div className="le-inline-row">
        {usable.map(target => <Button key={target.id} size="sm" variant="primary" disabled={target.current === active.url} onClick={() => { target.apply(active.url, active.alt); setMessage({ tone: 'ok', text: `Applied to ${target.label}.` }) }}>
          <Check size={14} aria-hidden="true" /> {target.current === active.url ? `Used as ${target.label}` : `Use as ${target.label}`}
        </Button>)}
        {!usable.length && <span className="le-hint">{targetName ? `“${targetName}” has no ${active.kind} to set.` : `Select an element with an ${active.kind} on the page to use this file.`}</span>}
      </div>
      <div className="le-inline-row">
        <Button size="sm" onClick={() => { setReplacing(active.path); setMessage(null) }}><Replace size={14} aria-hidden="true" /> Replace everywhere…</Button>
        <Button size="sm" variant="danger" disabled={active.usedLive || active.usedInDraft || active.usedInVersions} title={active.usedLive || active.usedInDraft || active.usedInVersions ? 'Used by the site or its history' : undefined} onClick={() => void remove(active)}><Trash2 size={14} aria-hidden="true" /> Delete</Button>
      </div>
      {(active.usedLive || active.usedInDraft || active.usedInVersions) && <p className="le-hint">Files used by the live site, the saved draft or a saved version cannot be deleted, so every version stays restorable.</p>}
    </div>}
  </div>
}
