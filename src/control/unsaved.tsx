/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

/** Shown before leaving a screen that has edits which have not been saved. */
export const UNSAVED_MESSAGE = 'You have unsaved website copy changes. Leave this page and discard them?'

interface UnsavedValue {
  dirty: boolean
  setDirty: (dirty: boolean) => void
}

const UnsavedContext = createContext<UnsavedValue | null>(null)

/**
 * Tracks whether any console screen holds unsaved edits. Sidebar navigation asks before
 * leaving, and the browser's own unload prompt covers reloads and closing the tab.
 */
export function UnsavedChangesProvider({ children }: { children: ReactNode }) {
  const [dirty, setDirty] = useState(false)
  const value = useMemo(() => ({ dirty, setDirty }), [dirty])

  useEffect(() => {
    if (!dirty) return undefined
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty])

  return <UnsavedContext.Provider value={value}>{children}</UnsavedContext.Provider>
}

export function useUnsavedChanges(): UnsavedValue {
  const value = useContext(UnsavedContext)
  if (!value) return { dirty: false, setDirty: () => undefined }
  return value
}

/** Reports a screen's dirty state for as long as it is mounted; clears it on unmount. */
export function useReportUnsaved(dirty: boolean) {
  const { setDirty } = useUnsavedChanges()
  useEffect(() => {
    setDirty(dirty)
    return () => setDirty(false)
  }, [dirty, setDirty])
}
