import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { ChevronsLeft, Menu, Search, LogOut, ShieldCheck, X, LayoutDashboard, Users, KeyRound, ShieldAlert, ScrollText, Activity, Info } from 'lucide-react'
import { useControlSession } from './ControlSession'
import { CommandLauncher } from './CommandLauncher'
import { NAV_GROUPS, activeNavItem, breadcrumbsFor, CONSOLE_BASE, secondsUntilIdle, formatRelative, type NavIcon } from './policy'
import { Button, Dialog } from './ui'
import { BrandMark } from './BrandMark'

const ICONS: Record<NavIcon, typeof LayoutDashboard> = {
  overview: LayoutDashboard,
  users: Users,
  roles: KeyRound,
  security: ShieldAlert,
  audit: ScrollText,
  health: Activity,
  about: Info
}

/** Layout modes: expanded sidebar (desktop), icon rail (tablet / collapsed), and overlay drawer (phone). */
export function ControlLayout({ children, detailLabel, pageTitle, pageDescription }: { children: ReactNode; detailLabel?: string; pageTitle?: string; pageDescription?: string }) {
  const location = useLocation()
  const navigate = useNavigate()
  const { signOut, idle, phase } = useControlSession()
  // Tablet widths start with the icon rail; desktop starts expanded. The user can toggle either.
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px) and (max-width: 1099px)').matches)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [launcherOpen, setLauncherOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const current = activeNavItem(location.pathname)
  const crumbs = breadcrumbsFor(location.pathname, detailLabel)
  const session = phase.kind === 'granted' ? phase.session : null

  useEffect(() => { setDrawerOpen(false); setMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setLauncherOpen(open => !open)
      }
      if (event.key === 'Escape') { setMenuOpen(false); setDrawerOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const onDown = (event: MouseEvent) => { if (menuRef.current && !menuRef.current.contains(event.target as Node)) setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  const sidebarClass = ['cc-sidebar', collapsed ? 'is-collapsed' : '', drawerOpen ? 'is-open' : ''].filter(Boolean).join(' ')

  return (
    <div className={`cc-shell${collapsed ? ' cc-shell--collapsed' : ''}`}>
      <a className="cc-skip" href="#cc-main">Skip to content</a>
      {drawerOpen && <button type="button" className="cc-backdrop" aria-label="Close navigation" onClick={() => setDrawerOpen(false)} />}
      <aside className={sidebarClass} aria-label="Control Center navigation">
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
                  <NavLink key={item.to || 'overview'} to={to} end={item.to === ''} className={active ? 'is-active' : ''} title={collapsed ? item.label : undefined} aria-current={active ? 'page' : undefined}>
                    <Icon size={18} aria-hidden="true" />
                    <span className="cc-nav__text">{item.label}</span>
                    {collapsed && <span className="cc-sr-only">{item.label}</span>}
                  </NavLink>
                )
              })}
            </div>
          ))}
          <button type="button" className="cc-nav__search" onClick={() => setLauncherOpen(true)}>
            <Search size={18} aria-hidden="true" />
            <span className="cc-nav__text">Search <kbd>Ctrl K</kbd></span>
            {collapsed && <span className="cc-sr-only">Search</span>}
          </button>
        </nav>
        <div className="cc-sidebar__footer">
          <button type="button" className="cc-icon-btn cc-collapse" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(value => !value)}>
            <ChevronsLeft size={18} aria-hidden="true" className={collapsed ? 'is-flipped' : ''} />
          </button>
          <span className="cc-sidebar__credit">{collapsed ? 'DYPOL' : 'Stracker by DYPOL LABS'}</span>
        </div>
      </aside>

      <div className="cc-main">
        <header className="cc-topbar">
          <button type="button" className="cc-icon-btn cc-menu-btn" aria-label="Open navigation" onClick={() => setDrawerOpen(true)}><Menu size={20} aria-hidden="true" /></button>
          <button type="button" className="cc-icon-btn cc-collapse-desktop" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={() => setCollapsed(value => !value)}>
            <ChevronsLeft size={18} aria-hidden="true" className={collapsed ? 'is-flipped' : ''} />
          </button>
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
            <button type="button" className="cc-search-btn" onClick={() => setLauncherOpen(true)} aria-label="Open search (Control K)">
              <Search size={16} aria-hidden="true" /> <span>Search</span> <kbd>Ctrl K</kbd>
            </button>
            <span className="cc-pill cc-pill--ok" title={session ? `Assurance ${session.aal}; ${session.recentMfa ? 'verified recently' : 'verification older than 15 minutes'}` : undefined}>
              <ShieldCheck size={14} aria-hidden="true" /> {session?.recentMfa ? 'MFA verified' : 'MFA session'}
            </span>
            <div className="cc-menu" ref={menuRef}>
              <button type="button" className="cc-avatar" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(open => !open)} aria-label="Account and security menu">OW</button>
              {menuOpen && (
                <div role="menu" className="cc-menu__list">
                  <div className="cc-menu__meta">Owner · {idle === 'warning' ? 'idle warning' : 'session active'}</div>
                  <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); navigate(`${CONSOLE_BASE}/security`) }}>Security center</button>
                  <button role="menuitem" type="button" onClick={() => { setMenuOpen(false); navigate(`${CONSOLE_BASE}/about`) }}>Help &amp; about</button>
                  <button role="menuitem" type="button" className="is-danger" onClick={() => { setMenuOpen(false); void signOut('local') }}><LogOut size={15} aria-hidden="true" /> Sign out</button>
                </div>
              )}
            </div>
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
          <span>Session data refreshed on demand · Times shown in your local zone</span>
        </footer>
      </div>

      {launcherOpen && <CommandLauncher onClose={() => setLauncherOpen(false)} />}
      {idle === 'warning' && <IdleWarning onSignOut={() => void signOut('local')} />}
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
      description={`You will be signed out of the Control Center in ${seconds} seconds because there has been no activity. Last activity ${formatRelative(new Date(lastActivity()).toISOString(), now)}.`}
      onClose={markActive}
      footer={<><Button variant="ghost" onClick={onSignOut}>Sign out now</Button><Button variant="primary" onClick={markActive}>Stay signed in</Button></>}
    >
      <p className="cc-note cc-note--warn">Idle sign-out protects the console on shared computers.</p>
    </Dialog>
  )
}
