import { useRef, useState } from 'react'
import { ImagePlus, Library, Trash2, Video } from 'lucide-react'
import { Button } from '../ui'
import { MEDIA_LIMITS, type MediaKind } from '../../lib/site-content/media'
import { uploadMedia, useMediaLibrary } from './media-library'

/**
 * A media value: upload through the existing owner media flow, or pick an earlier upload from
 * the library. Only URLs of files uploaded into the site's own bucket validate.
 */
export function MediaUpload({ kind, value, onChange, label, onAlt }: { kind: MediaKind; value: string; onChange: (url: string) => void; label: string; onAlt?: (alt: string) => void }) {
  const limits = MEDIA_LIMITS[kind]
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)

  const upload = async (file: File) => {
    setProblem(null)
    setBusy(true)
    try {
      onChange(await uploadMedia(kind, file))
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The upload did not finish. Try again.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return <div className="le-media">
    <div className="le-media__preview">
      {value
        ? kind === 'image' ? <img src={value} alt="" loading="lazy" /> : <video src={value} preload="metadata" muted />
        : <span>{kind === 'image' ? 'No image' : 'No video'}</span>}
    </div>
    <div className="le-media__actions">
      <input ref={fileRef} type="file" accept={limits.mimes.join(',')} className="cc-sr-only" aria-label={label} disabled={busy} onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file) }} />
      <Button size="sm" onClick={() => fileRef.current?.click()} disabled={busy}>
        {kind === 'image' ? <ImagePlus size={14} aria-hidden="true" /> : <Video size={14} aria-hidden="true" />} {busy ? 'Uploading…' : value ? 'Replace' : 'Upload'}
      </Button>
      <Button size="sm" variant="ghost" aria-expanded={picking} onClick={() => setPicking(open => !open)} disabled={busy}><Library size={14} aria-hidden="true" /> Library</Button>
      {value && <Button size="sm" variant="ghost" onClick={() => onChange('')} disabled={busy}><Trash2 size={14} aria-hidden="true" /> Remove</Button>}
    </div>
    {picking && <MediaPicker kind={kind} current={value} onPick={(url, alt) => { onChange(url); if (alt && onAlt) onAlt(alt); setPicking(false) }} />}
    {problem && <p className="le-error" role="alert">{problem}</p>}
  </div>
}

function MediaPicker({ kind, current, onPick }: { kind: MediaKind; current: string; onPick: (url: string, alt: string) => void }) {
  const library = useMediaLibrary()
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()
  const assets = library.assets.filter(asset => asset.kind === kind && (!needle || `${asset.name} ${asset.alt}`.toLowerCase().includes(needle)))
  return <div className="le-picker">
    <input className="cc-input" type="search" placeholder={`Search ${kind === 'image' ? 'images' : 'videos'}`} aria-label="Search the library" value={query} onChange={event => setQuery(event.target.value)} />
    {library.query.isLoading && <p className="le-hint">Loading the library…</p>}
    {library.query.isError && <p className="le-error">The library could not be loaded.</p>}
    {!library.query.isLoading && !assets.length && <p className="le-hint">No {kind === 'image' ? 'images' : 'videos'} yet. Upload one, or add files in the Assets panel.</p>}
    <ul className="le-asset-grid is-compact">
      {assets.map(asset => <li key={asset.path}>
        <button type="button" className={`le-asset${asset.url === current ? ' is-active' : ''}`} onClick={() => onPick(asset.url, asset.alt)} title={asset.name || asset.alt || 'Untitled'}>
          {asset.kind === 'image' ? <img src={asset.url} alt="" loading="lazy" /> : <video src={asset.url} preload="metadata" muted />}
          <span>{asset.name || asset.alt || 'Untitled'}</span>
        </button>
      </li>)}
    </ul>
  </div>
}
