import { useSyncExternalStore } from 'react'

// The unsent message in the Stracker AI composer. Kept outside the composer so minimising,
// restoring, expanding or collapsing the assistant (which unmounts the composer) never loses it.
// In memory only: never persisted to storage.
let draft = ''
const listeners = new Set<() => void>()

export function getAIDraft() { return draft }

export function setAIDraft(next: string) {
  if (next === draft) return
  draft = next
  listeners.forEach(listener => listener())
}

export function clearAIDraft() { setAIDraft('') }

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useAIDraft(): [string, (next: string) => void] {
  const value = useSyncExternalStore(subscribe, getAIDraft, getAIDraft)
  return [value, setAIDraft]
}
