/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'
import { Segmented } from './ui'
import { zoneShortLabel } from './policy'
import { isValidTimeZone, UTC_ZONE } from '../lib/time-window'

/**
 * Console-wide display zone. One policy for every page: timestamps are stored in UTC;
 * reporting windows, date filters and displayed times all use the zone chosen here. The
 * default is the browser's zone; the operator can switch to UTC for cross-team comparison.
 * The choice is kept in memory only (the console stores nothing in browser storage).
 */
export type TimeZoneMode = 'local' | 'utc'

export interface TimeZoneValue {
  mode: TimeZoneMode
  /** IANA zone used for calculations and display. */
  zone: string
  /** The browser's own zone (what "local" means on this device). */
  browserZone: string
  /** Short label such as "GMT+5:30" or "UTC". */
  shortLabel: string
  /** Full label such as "Asia/Kolkata (GMT+5:30)". */
  longLabel: string
  setMode: (mode: TimeZoneMode) => void
}

const TimeZoneContext = createContext<TimeZoneValue | null>(null)

export function detectBrowserZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone
    return isValidTimeZone(zone) ? zone : UTC_ZONE
  } catch {
    return UTC_ZONE
  }
}

export function TimeZoneProvider({ children, initialMode = 'local' }: { children: ReactNode; initialMode?: TimeZoneMode }) {
  const [mode, setMode] = useState<TimeZoneMode>(initialMode)
  const browserZone = useMemo(detectBrowserZone, [])
  const value = useMemo<TimeZoneValue>(() => {
    const zone = mode === 'utc' ? UTC_ZONE : browserZone
    const shortLabel = zoneShortLabel(zone)
    return {
      mode,
      zone,
      browserZone,
      shortLabel,
      longLabel: zone === UTC_ZONE ? 'UTC' : `${zone} (${shortLabel})`,
      setMode
    }
  }, [mode, browserZone])
  return <TimeZoneContext.Provider value={value}>{children}</TimeZoneContext.Provider>
}

export function useTimeZone(): TimeZoneValue {
  const value = useContext(TimeZoneContext)
  if (!value) throw new Error('useTimeZone must be used inside TimeZoneProvider')
  return value
}

/** Local / UTC switch. Changing it re-runs the calculations that depend on the zone. */
export function TimeZoneSwitch() {
  const { mode, setMode, browserZone, shortLabel } = useTimeZone()
  const options = browserZone === UTC_ZONE
    ? [{ value: 'utc' as const, label: 'UTC' }]
    : [{ value: 'local' as const, label: `Local (${mode === 'local' ? shortLabel : zoneShortLabel(browserZone)})` }, { value: 'utc' as const, label: 'UTC' }]
  return <Segmented<TimeZoneMode> label="Time zone for dates and times" value={mode} options={options} onChange={setMode} />
}
