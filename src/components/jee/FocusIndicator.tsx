import { useNavigate } from 'react-router-dom'
import { Timer } from 'lucide-react'
import { Button } from '../ui'
import { useFocusOptional } from '../../contexts/FocusContext'

/**
 * Compact Home indicator for a focus block that is running or paused with studied
 * time. Reads the single FocusProvider timer (no second ticking timer) and disappears
 * as soon as the block is completed, saved or discarded.
 */
export function FocusIndicator() {
  const focus = useFocusOptional()
  const navigate = useNavigate()
  if (!focus?.unsaved) return null
  const minutes = Math.floor(focus.liveElapsed / 60)
  const label = minutes >= 1 ? `${minutes} min` : 'under a minute'
  return <div className="home-focus-indicator" role="status" aria-label={`${focus.running ? 'Focus in progress' : 'Focus paused'} · ${label}`}>
    <span className={focus.running ? 'focus-live-dot live' : 'focus-live-dot'} aria-hidden="true" />
    <Timer size={16} aria-hidden="true" />
    <span><strong>{focus.running ? 'Focus in progress' : 'Focus paused'}</strong> · {label}</span>
    <span className="home-focus-actions"><Button size="sm" variant="secondary" onClick={() => navigate('/focus')}>{focus.running ? 'Return to focus' : 'Resume'}</Button></span>
  </div>
}
