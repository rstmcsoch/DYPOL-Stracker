import { useEffect, useRef, useState } from 'react'
import { Check, Copy } from 'lucide-react'

/** Copies text with the async Clipboard API, falling back to a hidden textarea. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true }
  } catch { /* fall through to the legacy path */ }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.setAttribute('readonly', '')
    area.style.position = 'fixed'; area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  } catch { return false }
}

/** Small icon button with a visible and announced "Copied" confirmation. */
export function CopyButton({ text, label, className = '', showLabel = false }: { text: string; label: string; className?: string; showLabel?: boolean }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const timer = useRef<number | null>(null)
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current) }, [])
  const onCopy = async () => {
    const ok = await copyText(text)
    setState(ok ? 'copied' : 'failed')
    if (timer.current) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1600)
  }
  const status = state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : ''
  return <button type="button" className={`ai-copy-button ${state !== 'idle' ? `is-${state}` : ''} ${className}`} onClick={() => void onCopy()} aria-label={status || label} title={status || label}>
    {state === 'copied' ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    {(showLabel || state !== 'idle') && <span>{status || 'Copy'}</span>}
    <span className="ai-sr-only" role="status" aria-live="polite">{status}</span>
  </button>
}
