import { useEffect, useState } from 'react'
import { elapsedSeconds, formatElapsed } from '../../lib/ai/task-progress'

/**
 * Seconds since the current Ask Stracker request started, ticking once a second while it runs.
 * Hidden from screen readers so the progress status is not re-announced every second.
 */
export function AITaskElapsed({ startedAt }: { startedAt: string }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt])
  return <span className="ai-task-elapsed" aria-hidden="true" data-testid="ai-task-elapsed">{formatElapsed(elapsedSeconds(startedAt, now))}</span>
}
