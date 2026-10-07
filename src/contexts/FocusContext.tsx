/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useData } from './DataContext'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { createId } from '../lib/id'
import type { StudySession, Subject } from '../types'

export type FocusMode = 'Pomodoro' | 'Short Break' | 'Long Break' | 'Custom'
interface TimerState {
  mode: FocusMode
  durations: { Pomodoro: number; 'Short Break': number; 'Long Break': number; Custom: number }
  remainingSeconds: number
  running: boolean
  endsAt: number | null
  segmentStartedAt: number | null
  focusStartedAt: string | null
  elapsedSeconds: number
  subject: Subject | null
  chapterId: string | null
  taskId: string | null
  finished: boolean
}
interface FocusContextValue extends TimerState {
  progress: number
  start: () => void
  pause: () => void
  reset: () => void
  switchMode: (mode: FocusMode) => void
  setSubject: (subject: Subject | null) => void
  setChapter: (chapterId: string | null) => void
  setTask: (taskId: string | null) => void
  setCustomMinutes: (minutes: number) => void
  focusMinutes: number
}

const KEY = 'stracker-focus-state'
const defaults: TimerState = {
  mode: 'Pomodoro', durations: { Pomodoro: 25, 'Short Break': 5, 'Long Break': 15, Custom: 40 },
  remainingSeconds: 25 * 60, running: false, endsAt: null, segmentStartedAt: null,
  focusStartedAt: null, elapsedSeconds: 0, subject: null, chapterId: null, taskId: null, finished: false
}
const FocusContext = createContext<FocusContextValue | null>(null)

function restoreTimer(key: string): TimerState {
  try {
    const parsed = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<TimerState> | null
    if (!parsed || !parsed.durations || typeof parsed.mode !== 'string') return defaults
    const durations = { ...defaults.durations, ...parsed.durations }
    const mode = parsed.mode as FocusMode
    const restored: TimerState = {
      ...defaults, ...parsed, mode, durations,
      remainingSeconds: Math.max(0, Number(parsed.remainingSeconds) || 0),
      running: Boolean(parsed.running), endsAt: typeof parsed.endsAt === 'number' ? parsed.endsAt : null,
      segmentStartedAt: typeof parsed.segmentStartedAt === 'number' ? parsed.segmentStartedAt : null,
      elapsedSeconds: Math.max(0, Number(parsed.elapsedSeconds) || 0),
      finished: Boolean(parsed.finished)
    }
    if (restored.running && restored.endsAt) restored.remainingSeconds = Math.max(0, Math.ceil((restored.endsAt - Date.now()) / 1000))
    return restored
  } catch { return defaults }
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

  const logSession = useCallback(async (state: TimerState, completed: boolean, endedAt = Date.now()) => {
    if (state.mode !== 'Pomodoro' && state.mode !== 'Custom') return
    const tail = state.running && state.segmentStartedAt ? Math.max(0, (endedAt - state.segmentStartedAt) / 1000) : 0
    const elapsed = state.elapsedSeconds + tail
    if (elapsed <= 0) return
    const now = new Date(endedAt).toISOString()
    const session: StudySession = {
      id: createId(), subject: state.subject, chapter_id: state.chapterId,
      started_at: state.focusStartedAt ?? new Date(endedAt - elapsed * 1000).toISOString(), ended_at: now,
      duration_minutes: Math.max(0, Math.round(elapsed / 60)), completion_state: completed ? 'completed' : 'interrupted',
      mode: state.mode, created_at: now, updated_at: now
    }
    try { await upsert('study_sessions', session) }
    catch (error) { notify(error instanceof Error ? error.message : 'Session saved on this device but could not sync.', 'error') }
  }, [upsert, notify])

  const finish = useCallback((snapshot: TimerState) => {
    if (ending.current) return
    ending.current = true
    const endedAt = snapshot.endsAt ?? Date.now()
    setTimer(current => ({ ...current, remainingSeconds: 0, running: false, endsAt: null, segmentStartedAt: null, finished: true }))
    if (snapshot.mode === 'Pomodoro' || snapshot.mode === 'Custom') {
      void logSession(snapshot, true, endedAt)
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
    setTimer(current => {
      if (!current.running || !current.endsAt) return current
      const now = Date.now()
      const remainingSeconds = Math.max(0, Math.ceil((current.endsAt - now) / 1000))
      const focusElapsed = (current.mode === 'Pomodoro' || current.mode === 'Custom') && current.segmentStartedAt ? Math.max(0, (now - current.segmentStartedAt) / 1000) : 0
      return { ...current, running: false, endsAt: null, segmentStartedAt: null, remainingSeconds, elapsedSeconds: current.elapsedSeconds + focusElapsed }
    })
  }, [])

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
        focusStartedAt: focus ? current.focusStartedAt ?? new Date(now).toISOString() : null,
        elapsedSeconds: current.remainingSeconds <= 0 ? 0 : current.elapsedSeconds, finished: false
      }
    })
  }, [])

  const reset = useCallback(() => {
    const snapshot = timerRef.current
    if (snapshot.mode === 'Pomodoro' || snapshot.mode === 'Custom') void logSession(snapshot, false)
    setTimer(current => ({ ...current, remainingSeconds: current.durations[current.mode] * 60, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: false }))
  }, [logSession])

  const switchMode = useCallback((mode: FocusMode) => {
    const snapshot = timerRef.current
    if (snapshot.running) return
    if ((snapshot.mode === 'Pomodoro' || snapshot.mode === 'Custom') && snapshot.elapsedSeconds > 0) void logSession(snapshot, false)
    setTimer(current => current.running ? current : ({ ...current, mode, remainingSeconds: current.durations[mode] * 60, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: false }))
  }, [logSession])

  const setSubject = useCallback((subject: Subject | null) => setTimer(current => ({ ...current, subject })), [])
  const setChapter = useCallback((chapterId: string | null) => setTimer(current => ({ ...current, chapterId })), [])
  const setTask = useCallback((taskId: string | null) => setTimer(current => ({ ...current, taskId })), [])
  const setCustomMinutes = useCallback((minutes: number) => setTimer(current => current.running ? current : ({ ...current, durations: { ...current.durations, Custom: Math.max(1, Math.min(180, minutes)) }, remainingSeconds: current.mode === 'Custom' ? Math.max(1, Math.min(180, minutes)) * 60 : current.remainingSeconds })), [])

  const value = useMemo<FocusContextValue>(() => ({
    ...timer, progress: focusMinutes > 0 ? Math.min(100, Math.max(0, (1 - timer.remainingSeconds / (focusMinutes * 60)) * 100)) : 0,
    start, pause, reset, switchMode, setSubject, setChapter, setTask, setCustomMinutes, focusMinutes
  }), [timer, focusMinutes, start, pause, reset, switchMode, setSubject, setChapter, setTask, setCustomMinutes])
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
