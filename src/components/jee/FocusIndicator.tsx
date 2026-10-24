import { useNavigate } from 'react-router-dom'
import { Timer } from 'lucide-react'
import { Button } from '../ui'
import { useFocusOptional } from '../../contexts/FocusContext'
import { focusClockLabel } from '../../lib/focus-clock'

/**
 * Compact Home indicator for a focus block that is running or paused with studied
 * time. Reads the single FocusProvider timer (no second ticking timer) and disappears
 * as soon as the block is completed, saved or discarded.
 */
export function FocusIndicator() {
  const focus = useFocusOptional()
  const navigate = useNavigate()
  if (!focus?.unsaved) return null
  const seconds = Math.max(0, Math.floor(focus.liveElapsed))
  const minutes = Math.floor(seconds / 60)
  // Visible text ticks as mm:ss (h:mm:ss past an hour) from the same provider timer; the
  // accessible label only changes once a minute so screen readers are not flooded.
  const label = focusClockLabel(seconds)
  const spoken = minutes >= 1 ? `${minutes} min` : 'under a minute'
  return <div className="home-focus-indicator" role="status" aria-label={`${focus.running ? 'Focus in progress' : 'Focus paused'} · ${spoken}`}>
    <span className={focus.running ? 'focus-live-dot live' : 'focus-live-dot'} aria-hidden="true" />
    <Timer size={16} aria-hidden="true" />
    <span><strong>{focus.running ? 'Focus in progress' : 'Focus paused'}</strong> · <span className="home-focus-clock">{label}</span></span>
    <span className="home-focus-actions"><Button size="sm" variant="secondary" onClick={() => navigate('/focus')}>{focus.running ? 'Return to focus' : 'Resume'}</Button></span>
  </div>
}

