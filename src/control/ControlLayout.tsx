import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { ChevronsLeft, ChevronDown, Menu, Search, LogOut, ShieldCheck, X, LayoutDashboard, Users, KeyRound, ShieldAlert, ScrollText, Activity, Info, Palette } from 'lucide-react'
import { useControlSession } from './ControlSession'
import { CommandLauncher } from './CommandLauncher'
import { NAV_GROUPS, activeNavItem, breadcrumbsFor, CONSOLE_BASE, documentTitleFor, secondsUntilIdle, formatCountdown, type NavIcon } from './policy'
import { Button, Dialog } from './ui'
import { BrandMark } from './BrandMark'
import { useTimeZone } from './time'
import { ControlThemeSwitch } from './ControlTheme'
import { useUnsavedChanges, UNSAVED_MESSAGE } from './unsaved'

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  users: Users,
  roles: KeyRound,
  security: ShieldAlert,
  audit: ScrollText,
  health: Activity,
  about: Info,
  appearance: Palette
}

/** Keeps the browser tab title in step with client-side navigation. */
function useDocumentTitle(title: string) {
  useEffect(() => { document.title = title }, [title])
}

/**
 * Layout modes: expanded sidebar (desktop), icon rail (tablet / collapsed), and overlay drawer (phone).
 * Controls per mode:
 *   - ≥768px: one collapse/expand toggle, in the sidebar footer (it stays visible in the rail).
 *   - <768px: a menu button in the top bar opens the drawer; the drawer has its own close button.
 *   - Search lives in the top bar only (Ctrl/⌘ K); the shortcut hint is hidden on touch-first devices.
 */
export function ControlLayout({ children, detailLabel, pageTitle, pageDescription }: { children: ReactNode; detailLabel?: string; pageTitle?: string; pageDescription?: string }) {
  const location = useLocation()
  const { signOut, idle, phase } = useControlSession()
  const { longLabel } = useTimeZone()
  // Tablet widths start with the icon rail; desktop starts expanded. The user can toggle either.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (max-width: 1099px)').matches)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const current = activeNavItem(location.pathname)
  const crumbs = breadcrumbsFor(location.pathname, detailLabel)
  const session = phase.kind === 'granted' ? phase.session : null
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const { dirty } = useUnsavedChanges()
  /** Asks before navigating away from a screen with unsaved edits. */
  const leaveAllowed = () => !dirty || window.confirm(UNSAVED_MESSAGE)

  useDocumentTitle(documentTitleFor(location.pathname, detailLabel))

  useEffect(() => { setDrawerOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLauncherOpen(open => !open)
      }
      if (event.key === 'Escape') setDrawerOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Return focus to the menu button after the drawer closes from the keyboard.
  useEffect(() => {
    if (!drawerOpen) return
    const button = menuButtonRef.current
    return () => { button?.focus?.() }
  }, [drawerOpen])

  const sidebarClass = ['cc-sidebar', collapsed ? 'is-collapsed' : '', drawerOpen ? 'is-open' : ''].filter(Boolean).join(' ')

  return (
    <div className={`cc-shell${collapsed ? ' cc-shell--collapsed' : ''}`}>
      <a className="cc-skip" href="#cc-main">Skip to content</a>
      {drawerOpen && <button type="button" className="cc-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}
      <aside className={sidebarClass} aria-label="Control Center navigation" id="cc-sidebar">
        <div className="cc-sidebar__brand">
          <BrandMark compact={collapsed} />
          <button type="button" className="cc-icon-btn cc-sidebar__close" aria-label="Close navigation" onClick={() => setDrawerOpen(false)}><X size={18} aria-hidden="true" /></button>
        </div>
        <nav className="cc-nav">
          {NAV_GROUPS.map(group => (
            <div key={group.label} className="cc-nav__group">
              <span className="cc-nav__label">{group.label}</span>
              {group.items.map(item => {
                const Icon = ICONS[item.icon]
                const to = item.to ? `${CONSOLE_BASE}/${item.to}` : CONSOLE_BASE
                const active = current?.to === item.to
                return (
                  <NavLink key={item.to || 'overview'} to={to} end={item.to === ''} className={active ? 'is-active' : ''} title={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined} onClick={event => { if (!leaveAllowed()) event.preventDefault() }}>
                    <Icon size={18} aria-hidden="true" />
                    <span className="cc-nav__text">{item.label}</span>
                    {collapsed && <span className="cc-sr-only">{item.label}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
        </nav>
        <div className="cc-sidebar__footer">
          <button type="button" className="cc-icon-btn cc-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} aria-controls="cc-sidebar" title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(value => !value)}>
            <ChevronsLeft size={18} aria-hidden="true" className={collapsed ? 'is-flipped' : ''} />
          </button>
          <span className="cc-sidebar__credit">{collapsed ? 'DYPOL' : 'Stracker by DYPOL LABS'}</span>
        </div>
      </aside>

      <div className="cc-main">
        <header className="cc-topbar">
          <button ref={menuButtonRef} type="button" className="cc-icon-btn cc-menu-btn" aria-label="Open navigation" aria-expanded={drawerOpen} aria-controls="cc-sidebar" onClick={() => setDrawerOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <nav aria-label="Breadcrumb" className="cc-crumbs">
            <ol>
              {crumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>
                  {crumb.to !== undefined && index < crumbs.length - 1 ? <Link to={crumb.to ? `${CONSOLE_BASE}/${crumb.to}` : CONSOLE_BASE}>{crumb.label}</Link> : <span aria-current={index === crumbs.length - 1 ? 'page' : undefined}>{crumb.label}</span>}
                </li>
              ))}
            </ol>
          </nav>
          <div className="cc-topbar__right">
            <button type="button" className="cc-search-btn" onClick={() => setLauncherOpen(true)} aria-label="Search pages and accounts (Control K)" aria-keyshortcuts="Control+K Meta+K">
              <Search size={16} aria-hidden="true" /> <span>Search</span> <kbd className="cc-kbd">Ctrl K</kbd>
            </button>
            <ControlThemeSwitch />
            <span className="cc-pill cc-pill--ok" title={session ? `Assurance ${session.aal}; ${session.recentMfa ? 'verified recently' : 'verification older than 15 minutes'}` : undefined}>
              <ShieldCheck size={14} aria-hidden="true" /> {session?.recentMfa ? 'MFA verified' : 'MFA session'}
            </span>
            <AccountMenu idleWarning={idle === 'warning'} onSignOut={() => void signOut('local')} />
          </div>
        </header>

        <main id="cc-main" className="cc-content" tabIndex={-1}>
          {(pageTitle || pageDescription) && (
            <div className="cc-pagehead">
              {pageTitle && <h1>{pageTitle}</h1>}
              {pageDescription && <p>{pageDescription}</p>}
            </div>
          )}
          {children}
        </main>

        <footer className="cc-footer">
          <span>Stracker by DYPOL LABS · Control Center</span>
          <span>Times shown in {longLabel} · stored in UTC</span>
        </footer>
      </div>

      {launcherOpen && <CommandLauncher onClose={() => setLauncherOpen(false)} />}
      {idle === 'warning' && <IdleWarning onSignOut={() => void signOut('local')} />}
    </div>
  )
}

/**
 * Account menu (role, security, help, sign out). Sign-out is the single sign-out control in
 * the shell; the button is labelled so it is discoverable, and the menu follows the
 * menu-button keyboard pattern (arrows, Home/End, Escape, focus return).
 */
function AccountMenu({ idleWarning, onSignOut }: { idleWarning: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const location = useLocation()

  useEffect(() => { setOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => { if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    const first = listRef.current?.querySelector<HTMLElement>('[role="menuitem"]')
    first?.focus()
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = (restoreFocus = true) => {
    setOpen(false)
    if (restoreFocus) buttonRef.current?.focus()
  }

  const onMenuKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (event.key === 'Escape') { event.preventDefault(); close() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); items[(index + 1) % items.length]?.focus() }
    else if (event.key === 'ArrowUp') { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus() }
    else if (event.key === 'Home') { event.preventDefault(); items[0]?.focus() }
    else if (event.key === 'End') { event.preventDefault(); items[items.length - 1]?.focus() }
    else if (event.key === 'Tab') close(false)
  }

  return (
    <div className="cc-menu" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="cc-avatar"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="cc-account-menu"
        onClick={() => setOpen(value => !value)}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
        aria-label="Account menu: owner session, security, help and sign out"
        title="Account menu · sign out"
      >
        <span className="cc-avatar__initials" aria-hidden="true">OW</span>
        <ChevronDown size={14} aria-hidden="true" className="cc-avatar__chevron" />
      </button>
      {open && (
        <div role="menu" id="cc-account-menu" className="cc-menu__list" ref={listRef} onKeyDown={onMenuKey} aria-label="Account">
          <div className="cc-menu__meta">Owner · {idleWarning ? 'idle warning' : 'session active'}</div>
          <Link role="menuitem" to={`${CONSOLE_BASE}/security`} onClick={() => close(false)}>Security center</Link>
          <Link role="menuitem" to={`${CONSOLE_BASE}/about`} onClick={() => close(false)}>Help &amp; about</Link>
          <button role="menuitem" type="button" className="is-danger" onClick={() => { close(false); onSignOut() }}><LogOut size={15} aria-hidden="true" /> Sign out</button>
        </div>
      )}
    </div>
  )
}

function IdleWarning({ onSignOut }: { onSignOut: () => void }) {
  const { lastActivity, markActive } = useControlSession()
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])
  const seconds = secondsUntilIdle(lastActivity(), now)
  return (
    <Dialog
      title="Still there?"
      description="There has been no activity for a while. You will be signed out of the Control Center when the timer reaches zero."
      onClose={markActive}
      footer={<><Button variant="ghost" onClick={onSignOut}>Sign out now</Button><Button variant="primary" onClick={markActive}>Stay signed in</Button></>}
    >
      <p className="cc-idle-countdown" role="timer" aria-live="polite" aria-atomic="true">
        <strong>{formatCountdown(seconds)}</strong> remaining
      </p>
      <p className="cc-note cc-note--warn">Idle sign-out after 20 minutes without activity protects the console on shared computers. Staying signed in resets the idle timer only; it does not extend your authentication.</p>
    </Dialog>
  )
}
