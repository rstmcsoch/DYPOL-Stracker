/** Browser-side console policy. The server enforces the same limits independently. */

/** Idle sign-out for the console. The browser signs out; the server does not track idleness. */
export const IDLE_TIMEOUT_MS = 20 * 60 * 1000
/** The "still there?" warning appears this long before the idle sign-out. */
export const IDLE_WARNING_MS = 2 * 60 * 1000
/** Sensitive actions require a TOTP verification this recent (mirrors the server). */
export const RECENT_MFA_SECONDS = 15 * 60

export const CONSOLE_BASE = '/control-panel'

export type NavIcon = 'overview' | 'users' | 'roles' | 'security' | 'audit' | 'health' | 'about'

export interface NavItem {
  to: string
  label: string
  icon: NavIcon
  description: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Only destinations that are implemented appear here. Items from the wider brief (exam
 * catalog, announcements, feature flags, email operations) are omitted until they work.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Command',
    items: [{ to: '', label: 'Overview', icon: 'overview', description: 'Operational summary and warnings' }]
  },
  {
    label: 'People',
    items: [
      { to: 'users', label: 'Users', icon: 'users', description: 'Account directory and account actions' },
      { to: 'roles', label: 'Access & roles', icon: 'roles', description: 'Who holds administrative roles' },
      { to: 'security', label: 'Security center', icon: 'security', description: 'MFA, sessions and access attempts' }
    ]
  },
  {
    label: 'Operations',
    items: [
      { to: 'audit', label: 'Audit log', icon: 'audit', description: 'Every privileged action and denial' },
      { to: 'health', label: 'System health', icon: 'health', description: 'Database, auth and configuration checks' }
    ]
  },
  {
    label: 'Help',
    items: [{ to: 'about', label: 'Help & About', icon: 'about', description: 'Console policy, credits and version' }]
  }
]

/** User-facing name of the administrative area. The URL stays /control-panel for compatibility. */
export const CONSOLE_NAME = 'Stracker Control Center'

/** Document title for a console path, e.g. "Audit log · Stracker Control Center". */
export function documentTitleFor(pathname: string, detailLabel?: string): string {
  const item = activeNavItem(pathname)
  if (!item) return CONSOLE_NAME
  const parts = detailLabel && pathname.replace(/\/+$/, '') !== `${CONSOLE_BASE}/${item.to}`.replace(/\/+$/, '') ? [detailLabel, item.label] : [item.label]
  return `${parts.join(' · ')} · ${CONSOLE_NAME}`
}

export const ALL_NAV_ITEMS = NAV_GROUPS.flatMap(group => group.items)

/** Maps a pathname under /control-panel to the matching nav item (longest match wins). */
export function activeNavItem(pathname: string): NavItem | null {
  const relative = pathname.replace(/\/+$/, '').replace(new RegExp(`^${CONSOLE_BASE}/?`), '')
  const segment = relative.split('/')[0] ?? ''
  return ALL_NAV_ITEMS.find(item => item.to === segment) ?? (segment === '' ? ALL_NAV_ITEMS[0] ?? null : null)
}

export interface Crumb { label: string; to?: string }

export function breadcrumbsFor(pathname: string, detailLabel?: string): Crumb[] {
  const relative = pathname.replace(/\/+$/, '').replace(new RegExp(`^${CONSOLE_BASE}/?`), '')
  const parts = relative.split('/').filter(Boolean)
  const crumbs: Crumb[] = [{ label: 'Control Center', to: '' }]
  if (parts.length === 0) return [{ label: 'Control Center' }, { label: 'Overview' }]
  const item = ALL_NAV_ITEMS.find(entry => entry.to === parts[0])
  if (item) crumbs.push({ label: item.label, to: parts.length > 1 ? item.to : undefined })
  if (parts.length > 1) crumbs.push({ label: detailLabel ?? 'Details' })
  return crumbs
}

/**
 * Display formatting. Every formatter takes the display zone explicitly (an IANA name or
 * 'UTC'); when omitted the browser's zone is used. Calendar-day strings (YYYY-MM-DD) have no
 * zone of their own and are rendered as the same calendar date in every zone.
 */
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/

function safeZone(zone?: string): string | undefined {
  if (!zone) return undefined
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone })
    return zone
  } catch {
    return undefined
  }
}

export function formatDateTime(value: string | null | undefined, zone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: safeZone(zone) })
}

/** Full timestamp with seconds and the zone name, for tooltips and detail views. */
export function formatDateTimeFull(value: string | null | undefined, zone?: string): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: safeZone(zone), timeZoneName: 'short' })
}

export function formatDate(value: string | null | undefined, zone?: string): string {
  if (!value) return '—'
  if (DAY_ONLY.test(value)) {
    const date = new Date(`${value}T00:00:00Z`)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' })
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric', timeZone: safeZone(zone) })
}

/** "Oct 4 – Oct 10" (year added when it differs or is not the current year). */
export function formatDayRange(firstDay: string, lastDay: string, now = new Date()): string {
  if (!DAY_ONLY.test(firstDay) || !DAY_ONLY.test(lastDay)) return '—'
  const currentYear = String(now.getFullYear())
  const sameYear = firstDay.slice(0, 4) === lastDay.slice(0, 4)
  const withYear = !sameYear || firstDay.slice(0, 4) !== currentYear
  const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC', ...(withYear ? { year: 'numeric' } : {}) }
  const first = new Date(`${firstDay}T00:00:00Z`).toLocaleDateString(undefined, options)
  const last = new Date(`${lastDay}T00:00:00Z`).toLocaleDateString(undefined, options)
  return firstDay === lastDay ? first : `${first} – ${last}`
}

/** Short zone label such as "GMT+5:30" or "UTC" for the current instant. */
export function zoneShortLabel(zone: string, at = new Date()): string {
  if (zone === 'UTC') return 'UTC'
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'short' }).formatToParts(at).find(item => item.type === 'timeZoneName')
    return part?.value ?? zone
  } catch {
    return zone
  }
}

export function formatRelative(value: string | null | undefined, now = Date.now(), zone?: string): string {
  if (!value) return 'Never'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return '—'
  const seconds = Math.round((now - time) / 1000)
  if (seconds < 45) return 'Just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return formatDate(value, zone)
}

/** "m:ss" countdown label for the idle warning. */
export function formatCountdown(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function shortId(id: string): string {
  return id.length > 13 ? `${id.slice(0, 8)}…${id.slice(-4)}` : id
}

/** Idle state for the idle-timeout banner, computed from a last-activity timestamp. */
export function idleState(lastActivity: number, now: number): 'active' | 'warning' | 'expired' {
  const idle = now - lastActivity
  if (idle >= IDLE_TIMEOUT_MS) return 'expired'
  if (idle >= IDLE_TIMEOUT_MS - IDLE_WARNING_MS) return 'warning'
  return 'active'
}

export function secondsUntilIdle(lastActivity: number, now: number): number {
  return Math.max(0, Math.ceil((lastActivity + IDLE_TIMEOUT_MS - now) / 1000))
}
