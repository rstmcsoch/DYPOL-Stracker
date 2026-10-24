/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { createId } from '../lib/id'
import type { StudyActivity, Subject } from '../types'
import { buildFocusSession, defaultTimerState as defaults, hasUnsavedFocus, isFocusMode, liveElapsedSeconds, safeCustomMinutes, sanitizeTimerState, type FocusMode, type TimerState } from '../lib/focus-timer'
export type { FocusMode } from '../lib/focus-timer'

interface FocusContextValue extends TimerState {
  progress: number
  start: () => void
  pause: () => void
  reset: () => void
  switchMode: (mode: FocusMode) => void
  setSubject: (subject: Subject | null) => void
  setChapter: (chapterId: string | null) => void
  setActivity: (activity: StudyActivity) => void
  setTask: (taskId: string | null) => void
  setCustomMinutes: (minutes: number) => void
  focusMinutes: number
  /** Live studied seconds in this block (paused segments + the running one). */
  liveElapsed: number
  /** True when this focus block has studied time that is not saved yet. */
  unsaved: boolean
  /**
   * Ends the current focus block. `save: true` logs the elapsed time as one
   * study_sessions row (idempotent per block); `save: false` discards it. Returns the
   * minutes saved (0 when nothing was recorded).
   */
  endBlock: (save: boolean) => number
}

const KEY = 'stracker-focus-state'
const FocusContext = createContext<FocusContextValue | null>(null)

function restoreTimer(key: string): TimerState {
  try { return sanitizeTimerState(JSON.parse(sessionStorage.getItem(key) ?? 'null')) }
  catch { return defaults }
}

/** A new, idle block in the given mode that keeps the student's chosen subject/chapter/activity. */
function freshBlock(current: TimerState, mode: FocusMode = current.mode): TimerState {
  return {
    ...current, mode, remainingSeconds: current.durations[mode] * 60, running: false, endsAt: null, segmentStartedAt: null,
    focusStartedAt: null, elapsedSeconds: 0, finished: false, blockId: null
  }
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const { upsert, data } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const storageKey = `${KEY}:${user?.id ?? 'session'}`
  const [timer, setTimer] = useState<TimerState>(() => restoreTimer(storageKey))
  const timerRef = useRef(timer)
  const ending = useRef(false)
  const focusMinutes = timer.durations[timer.mode]

  useEffect(() => {
    timerRef.current = timer
    try { sessionStorage.setItem(storageKey, JSON.stringify(timer)) } catch { /* A blocked session store does not stop the timer. */ }
  }, [timer, storageKey])

  /** Block ids already written in this tab, so a double End/Save/completion cannot double-log. */
  const loggedBlocks = useRef(new Set<string>())

  const logSession = useCallback((state: TimerState, completed: boolean, endedAt = Date.now()): number => {
    if (state.blockId && loggedBlocks.current.has(state.blockId)) return 0
    const session = buildFocusSession(state, completed, endedAt, createId())
    if (!session) return 0
    loggedBlocks.current.add(session.id)
    upsert('study_sessions', session).catch(error => notify(error instanceof Error ? error.message : 'Session saved on this device but could not sync.', 'error'))
    return session.duration_minutes
  }, [upsert, notify])

  const finish = useCallback((snapshot: TimerState) => {
    if (ending.current) return
    ending.current = true
    const endedAt = snapshot.endsAt ?? Date.now()
    timerRef.current = { ...snapshot, remainingSeconds: 0, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: true, blockId: null }
    setTimer(current => ({ ...current, remainingSeconds: 0, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: true, blockId: null }))
    if (isFocusMode(snapshot.mode)) {
      logSession(snapshot, true, endedAt)
      if (data.settings.sound_enabled) playTone()
      notify('Focus block complete. Take a breath before the next one.')
    } else notify('Break complete. Ready when you are.')
    window.setTimeout(() => { ending.current = false }, 500)
  }, [data.settings.sound_enabled, logSession, notify])

  useEffect(() => {
    if (!timer.running || !timer.endsAt) return
    const endsAt = timer.endsAt
    const update = () => {
      const remaining = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000))
      if (remaining <= 0) {
        const snapshot = timerRef.current
        if (snapshot.endsAt === endsAt) finish(snapshot)
        return
      }
      setTimer(current => current.endsAt === endsAt ? { ...current, remainingSeconds: remaining } : current)
    }
    update()
    const id = window.setInterval(update, 250)
    return () => window.clearInterval(id)
  }, [timer.running, timer.endsAt, finish])

  const pause = useCallback(() => {
    const snapshot = timerRef.current
    const now = Date.now()
    if (snapshot.running && snapshot.endsAt !== null && snapshot.endsAt <= now) {
      finish(snapshot)
      return
    }
    setTimer(current => {
      if (!current.running || !current.endsAt) return current
      const remainingSeconds = Math.max(0, Math.ceil((current.endsAt - now) / 1000))
      const elapsedUntil = Math.min(now, current.endsAt)
      const focusElapsed = (current.mode === 'Pomodoro' || current.mode === 'Custom') && current.segmentStartedAt ? Math.max(0, (elapsedUntil - current.segmentStartedAt) / 1000) : 0
      return { ...current, running: false, endsAt: null, segmentStartedAt: null, remainingSeconds, elapsedSeconds: Math.min(180 * 60, current.elapsedSeconds + focusElapsed) }
    })
  }, [finish])

  const start = useCallback(() => {
    ending.current = false
    setTimer(current => {
      if (current.running) return current
      const now = Date.now()
      const remaining = current.remainingSeconds > 0 ? current.remainingSeconds : current.durations[current.mode] * 60
      const focus = current.mode === 'Pomodoro' || current.mode === 'Custom'
      return {
        ...current, remainingSeconds: remaining, running: true, endsAt: now + remaining * 1000,
        segmentStartedAt: now,
        focusStartedAt: focus ? (current.remainingSeconds <= 0 ? null : current.focusStartedAt) ?? new Date(now).toISOString() : null,
        elapsedSeconds: current.remainingSeconds <= 0 ? 0 : current.elapsedSeconds, finished: false,
        blockId: focus ? (current.remainingSeconds <= 0 ? null : current.blockId) ?? createId() : null
      }
    })
  }, [])

  const endBlock = useCallback((save: boolean): number => {
    const snapshot = timerRef.current
    const now = Date.now()
    // A block whose deadline already passed is a natural completion, not a partial one.
    if (snapshot.running && snapshot.endsAt !== null && snapshot.endsAt <= now) {
      finish(snapshot)
      return 0
    }
    const minutes = save ? logSession(snapshot, false, now) : 0
    if (snapshot.blockId) loggedBlocks.current.add(snapshot.blockId)
    const next = freshBlock(snapshot)
    timerRef.current = next
    setTimer(current => freshBlock(current))
    return minutes
  }, [finish, logSession])

  /**
   * Reset never throws away studied time silently: the Focus page asks first (save /
   * discard / keep studying). If any other caller resets a block with unsaved time, it
   * is saved as a partial session rather than lost.
   */
  const reset = useCallback(() => {
    const snapshot = timerRef.current
    if (hasUnsavedFocus(snapshot)) { endBlock(true); return }
    setTimer(current => freshBlock(current))
  }, [endBlock])

  const switchMode = useCallback((mode: FocusMode) => {
    const snapshot = timerRef.current
    if (snapshot.running) return
    if (hasUnsavedFocus(snapshot)) endBlock(true)
    setTimer(current => current.running ? current : freshBlock(current, mode))
  }, [endBlock])

  // Closing the tab would drop the in-memory block; ask the browser to warn first.
  const unsavedNow = hasUnsavedFocus(timer)
  useEffect(() => {
    if (!unsavedNow) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [unsavedNow])

  const setSubject = useCallback((subject: Subject | null) => setTimer(current => ({ ...current, subject })), [])
  const setChapter = useCallback((chapterId: string | null) => setTimer(current => ({ ...current, chapterId })), [])
  const setActivity = useCallback((activity: StudyActivity) => setTimer(current => ({ ...current, activity })), [])
  const setTask = useCallback((taskId: string | null) => setTimer(current => ({ ...current, taskId })), [])
  const setCustomMinutes = useCallback((minutes: number) => {
    const safeMinutes = safeCustomMinutes(minutes)
    if (safeMinutes === null) return
    setTimer(current => current.running ? current : ({ ...current, durations: { ...current.durations, Custom: safeMinutes }, remainingSeconds: current.mode === 'Custom' ? safeMinutes * 60 : current.remainingSeconds }))
  }, [])

  const value = useMemo<FocusContextValue>(() => ({
    ...timer, progress: focusMinutes > 0 ? Math.min(100, Math.max(0, (1 - timer.remainingSeconds / (focusMinutes * 60)) * 100)) : 0,
    start, pause, reset, switchMode, setSubject, setChapter, setActivity, setTask, setCustomMinutes, focusMinutes,
    liveElapsed: liveElapsedSeconds(timer), unsaved: hasUnsavedFocus(timer), endBlock
  }), [timer, focusMinutes, start, pause, reset, switchMode, setSubject, setChapter, setActivity, setTask, setCustomMinutes, endBlock])
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

function playTone() {
  try {
    const context = new AudioContext()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = 'sine'; oscillator.frequency.value = 740
    gain.gain.setValueAtTime(0.001, context.currentTime); gain.gain.exponentialRampToValueAtTime(0.12, context.currentTime + 0.04); gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.6)
    oscillator.connect(gain); gain.connect(context.destination); oscillator.start(); oscillator.stop(context.currentTime + 0.62)
    void context.close()
  } catch { /* Timer completion still works without audio. */ }
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext)
  if (!context) throw new Error('useFocus must be used inside FocusProvider')
  return context
}

/** Same timer, or null outside a FocusProvider (lets summary widgets render in isolation). */
export function useFocusOptional(): FocusContextValue | null {
  return useContext(FocusContext)
}
