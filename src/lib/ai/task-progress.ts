/**
 * Live progress for an Ask Stracker request. The server streams the answer as `delta` events;
 * these helpers turn that into a progress line that moves on from "Thinking…" once text
 * arrives, and an elapsed-time readout, without recording anything the student typed.
 */
export const WRITING_PROGRESS = 'Writing the answer…'
export const RESTART_PROGRESS = 'Starting the answer again…'

/** States in which streamed text means the answer is being written. */
const STREAMING_STATES = new Set(['queued', 'running', 'retrying', 'fallback', 'tool_call'])

/** Progress text after a chunk of answer text arrives. Other states (waiting, done, failed) keep theirs. */
export function progressAfterDelta(status: string, progress: string): string {
  return STREAMING_STATES.has(status) ? WRITING_PROGRESS : progress
}

/** Whole seconds between the request start and now, never negative or NaN. */
export function elapsedSeconds(startedAt: string, now: number): number {
  const started = Date.parse(startedAt)
  if (!Number.isFinite(started)) return 0
  return Math.max(0, Math.floor((now - started) / 1000))
}

/** "7s", "1m 05s". */
export function formatElapsed(seconds: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  if (safe < 60) return `${safe}s`
  return `${Math.floor(safe / 60)}m ${String(safe % 60).padStart(2, '0')}s`
}
