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
    label: 'Configuration',
    items: [{ to: 'about', label: 'Help & about', icon: 'about', description: 'Console policy, credits and version' }]
  }
]

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

/** Converts a YYYY-MM-DD (UTC) date to a stable label. */
export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—'
  const date = new Date(value.length === 10 ? `${value}T00:00:00Z` : value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit', timeZone: value.length === 10 ? 'UTC' : undefined })
}

export function formatRelative(value: string | null | undefined, now = Date.now()): string {
  if (!value) return 'Never'
  const time = Date.parse(value)
  if (Number.isNaN(time)) return '—'
  const minutes = Math.round((now - time) / 60000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return formatDate(value)
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
