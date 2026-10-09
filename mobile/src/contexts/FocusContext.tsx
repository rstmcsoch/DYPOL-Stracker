import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createAudioPlayer, setAudioModeAsync, type AudioPlayer } from 'expo-audio'
import * as Haptics from 'expo-haptics'
import * as SecureStore from 'expo-secure-store'
import { useData } from './DataContext'
import { useAuth } from './AuthContext'
import { useToast } from './ToastContext'
import { createId } from '../shared/lib/id'
import type { StudyActivity, StudySession, Subject } from '../shared/types'
import { defaultTimerState as defaults, safeCustomMinutes, sanitizeTimerState, type FocusMode, type TimerState } from '../shared/lib/focus-timer'
export type { FocusMode } from '../shared/lib/focus-timer'

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
}

const KEY_PREFIX = 'stracker_focus_'
const FocusContext = createContext<FocusContextValue | null>(null)

/** Completion tone, generated once from the website's 740 Hz envelope and shipped in the APK. */
const COMPLETE_TONE = require('../../assets/sounds/focus-complete.wav') as number

/**
 * Focus timer. The timer runs from absolute end times, so it stays correct across screen changes and
 * app backgrounding. The state is kept per account in secure storage, and a finished block is logged
 * as a study session exactly as on the website.
 */
export function FocusProvider({ children }: { children: ReactNode }) {
  const { upsert, data } = useData()
  const { user } = useAuth()
  const { notify } = useToast()
  const storageKey = `${KEY_PREFIX}${(user?.id ?? 'session').replace(/[^A-Za-z0-9._-]/g, '_')}`
  const [timer, setTimer] = useState<TimerState>(defaults)
  // Hydration is tied to the storage key, so switching accounts re-reads the right timer.
  const [hydratedFor, setHydratedFor] = useState<string | null>(null)
  const hydrated = hydratedFor === storageKey
  const timerRef = useRef(timer)
  const ending = useRef(false)
  const toneRef = useRef<AudioPlayer | null>(null)
  const focusMinutes = timer.durations[timer.mode]

  // Restore the saved timer for this account.
  useEffect(() => {
    let active = true
    void SecureStore.getItemAsync(storageKey)
      .then(raw => {
        if (!active) return
        const restored = sanitizeTimerState(JSON.parse(raw ?? 'null'))
        timerRef.current = restored
        setTimer(restored)
      })
      .catch(() => undefined)
      .finally(() => { if (active) setHydratedFor(storageKey) })
    return () => { active = false }
  }, [storageKey])

  // Persist changes, debounced so the one-second ticks do not write to secure storage constantly.
  useEffect(() => {
    timerRef.current = timer
    if (!hydrated) return
    const id = setTimeout(() => {
      void SecureStore.setItemAsync(storageKey, JSON.stringify(timer)).catch(() => undefined)
    }, 400)
    return () => clearTimeout(id)
  }, [timer, storageKey, hydrated])

  const logSession = useCallback(async (state: TimerState, completed: boolean, endedAt = Date.now()) => {
    if (state.mode !== 'Pomodoro' && state.mode !== 'Custom') return
    const effectiveEnd = state.running && state.endsAt !== null ? Math.min(endedAt, state.endsAt) : endedAt
    const tail = state.running && state.segmentStartedAt ? Math.max(0, (effectiveEnd - state.segmentStartedAt) / 1000) : 0
    const elapsed = Math.min(180 * 60, state.elapsedSeconds + tail)
    if (elapsed <= 0) return
    const now = new Date(endedAt).toISOString()
    const session: StudySession = {
      id: createId(), subject: state.subject, chapter_id: state.chapterId,
      started_at: state.focusStartedAt ?? new Date(endedAt - elapsed * 1000).toISOString(), ended_at: now,
      duration_minutes: Math.max(0, Math.round(elapsed / 60)), completion_state: completed ? 'completed' : 'interrupted',
      mode: state.mode, activity: state.activity ?? 'Practice', created_at: now, updated_at: now
    }
    try {
      await upsert('study_sessions', session)
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Session saved on this device but could not sync.', 'error')
    }
  }, [upsert, notify])

  const playCompletion = useCallback(() => {
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined)
    try {
      toneRef.current?.remove()
      const player = createAudioPlayer(COMPLETE_TONE)
      toneRef.current = player
      player.play()
    } catch {
      // Completion still shows on screen and as a haptic when audio is unavailable.
    }
  }, [])

  const finish = useCallback((snapshot: TimerState) => {
    if (ending.current) return
    ending.current = true
    const endedAt = snapshot.endsAt ?? Date.now()
    const done = { ...snapshot, remainingSeconds: 0, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: true }
    timerRef.current = done
    setTimer(current => ({ ...current, ...done }))
    if (snapshot.mode === 'Pomodoro' || snapshot.mode === 'Custom') {
      void logSession(snapshot, true, endedAt)
      if (data.settings.sound_enabled) playCompletion()
      notify('Focus block complete. Take a breath before the next one.')
    } else {
      notify('Break complete. Ready when you are.')
    }
    setTimeout(() => { ending.current = false }, 500)
  }, [data.settings.sound_enabled, logSession, notify, playCompletion])

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
      setTimer(current => (current.endsAt === endsAt ? { ...current, remainingSeconds: remaining } : current))
    }
    update()
    const id = setInterval(update, 250)
    return () => clearInterval(id)
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
    setTimer(current => (current.running ? current : ({ ...current, mode, remainingSeconds: current.durations[mode] * 60, running: false, endsAt: null, segmentStartedAt: null, focusStartedAt: null, elapsedSeconds: 0, finished: false })))
  }, [logSession])

  const setSubject = useCallback((subject: Subject | null) => setTimer(current => ({ ...current, subject })), [])
  const setChapter = useCallback((chapterId: string | null) => setTimer(current => ({ ...current, chapterId })), [])
  const setActivity = useCallback((activity: StudyActivity) => setTimer(current => ({ ...current, activity })), [])
  const setTask = useCallback((taskId: string | null) => setTimer(current => ({ ...current, taskId })), [])
  const setCustomMinutes = useCallback((minutes: number) => {
    const safeMinutes = safeCustomMinutes(minutes)
    if (safeMinutes === null) return
    setTimer(current => (current.running ? current : ({ ...current, durations: { ...current.durations, Custom: safeMinutes }, remainingSeconds: current.mode === 'Custom' ? safeMinutes * 60 : current.remainingSeconds })))
  }, [])

  // Release the tone player when the provider unmounts.
  useEffect(() => () => { toneRef.current?.remove() }, [])
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: false }).catch(() => undefined) }, [])

  const value = useMemo<FocusContextValue>(() => ({
    ...timer,
    progress: focusMinutes > 0 ? Math.min(100, Math.max(0, (1 - timer.remainingSeconds / (focusMinutes * 60)) * 100)) : 0,
    start, pause, reset, switchMode, setSubject, setChapter, setActivity, setTask, setCustomMinutes, focusMinutes
  }), [timer, focusMinutes, start, pause, reset, switchMode, setSubject, setChapter, setActivity, setTask, setCustomMinutes])
  return <FocusContext.Provider value={value}>{children}</FocusContext.Provider>
}

export function useFocus(): FocusContextValue {
  const context = useContext(FocusContext)
  if (!context) throw new Error('useFocus must be used inside FocusProvider')
  return context
}
