import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, AlarmClock, AlertTriangle, ArrowDownToLine, BookOpen, CalendarDays, Check,
  ChevronRight, CircleHelp, Cloud, CloudOff, Compass, Focus, Home, Inbox, Layers, Library, ListChecks, Microscope, MoreHorizontal,
  NotebookPen, RotateCcw, Search, Settings, ShieldCheck, Sparkles, Timer, X, Zap, LogOut, ClipboardList, type LucideIcon
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { AIExperience } from './ai/AIExperience'
import { useToast } from '../contexts/ToastContext'
import { Button, Dialog, Field, IconButton } from './ui'
import { ThemeToggle } from './ThemeToggle'
import { indiaToday } from '../lib/date'
import { createId } from '../lib/id'
import { computeReminders, shouldFireToday } from '../lib/jee/reminders'
import { taskInputSchema } from '../lib/task-validation'
import type { AppData, DailyTask, Priority, Subject } from '../types'
import { useSiteValues } from '../contexts/SiteContentContext'
import { navCaptionFor, navLabelFor } from '../lib/site-content/nav'
import type { SiteValues } from '../lib/site-content/content'

interface NavigationItem { to: string; label: string; icon: LucideIcon; exact?: boolean }
interface NavigationGroup { caption: string; items: NavigationItem[] }

/**
 * Information architecture: a handful of task-shaped groups instead of a long flat list.
 * Study = daily doing, Syllabus = what is covered, Tests = measuring and diagnosing,
 * Revision = remembering, Planning = deciding what comes next. Routes are unchanged.
 */
const navGroups: NavigationGroup[] = [
  { caption: 'STUDY', items: [
    { to: '/', label: 'Home', icon: Home, exact: true },
    { to: '/focus', label: 'Focus', icon: Focus },
    { to: '/backlog', label: 'Backlog', icon: Inbox },
    { to: '/practice', label: 'Practice', icon: ClipboardList }
  ] },
  { caption: 'SYLLABUS', items: [
    { to: '/syllabus', label: 'Syllabus', icon: BookOpen },
    { to: '/weak-areas', label: 'Weak areas', icon: AlertTriangle },
    { to: '/pyqs', label: 'PYQs', icon: Library }
  ] },
  { caption: 'TESTS', items: [
    { to: '/tests', label: 'Tests & mocks', icon: ListChecks },
    { to: '/mock-analysis', label: 'Mock analysis', icon: Microscope },
    { to: '/mistakes', label: 'Mistake notebook', icon: NotebookPen },
    { to: '/retry', label: 'Retry', icon: RotateCcw },
    { to: '/analytics', label: 'Analytics', icon: Activity }
  ] },
  { caption: 'REVISION', items: [
    { to: '/revision', label: 'Revisions', icon: AlarmClock },
    { to: '/decks', label: 'Formulas & flashcards', icon: Layers }
  ] },
  { caption: 'PLANNING', items: [
    { to: '/study-now', label: 'Study now', icon: Compass },
    { to: '/planner', label: 'Study plan', icon: CalendarDays }
  ] },
  { caption: 'KEEP GOING', items: [
    { to: '/backup', label: 'Export & backup', icon: ArrowDownToLine },
    { to: '/settings', label: 'Settings', icon: Settings }
  ] }
]
/** Bottom bar on phones: the four daily destinations, with everything else under More. */
const mobileBar: NavigationItem[] = [
  { to: '/', label: 'Home', icon: Home, exact: true },
  { to: '/practice', label: 'Practice', icon: ClipboardList },
  { to: '/tests', label: 'Tests', icon: ListChecks },
  { to: '/revision', label: 'Revision', icon: AlarmClock }
]
const allNav: NavigationItem[] = navGroups.flatMap(group => group.items)

/** Label of the destination for the current path, using the owner's wording when one is saved. */
function currentNavLabel(pathname: string, values: SiteValues): string | undefined {
  const item = allNav.find(entry => entry.to === pathname)
  return item ? navLabelFor(item.to, item.label, values) : undefined
}
const moreRoutes = new Set(allNav.map(item => item.to).filter(to => !mobileBar.some(item => item.to === to)))

export function AppFrame() {
  const siteValues = useSiteValues()
  const { user, signOut } = useAuth()
  const { data, syncState, pendingCount, syncError, refresh, undoAvailable, undoDelete, dismissUndo } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileMore, setMobileMore] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [quickTaskOpen, setQuickTaskOpen] = useState(false)
  const [quickActionsOpen, setQuickActionsOpen] = useState(false)

  useEffect(() => { setMobileMore(false) }, [location.pathname])

  // Reminders: checked while the app is open. Fires at most once per IST day, and only when
  // there is a real item to mention and the browser has granted notification permission.
  useEffect(() => {
    if (!data.settings.reminders_enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return
    const check = () => {
      const items = computeReminders(data, indiaToday())
      if (!items.length || !shouldFireToday(data.settings.reminder_time, new Date())) return
      try {
        new Notification('Stracker', { body: items.map(item => item.title).join(' · '), tag: 'stracker-daily' })
      } catch { /* Some mobile browsers only allow notifications from a service worker; the in-app card still shows. */ }
    }
    check()
    const timer = window.setInterval(check, 60_000)
    return () => window.clearInterval(timer)
  }, [data])
  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isTyping = target && (['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName) || target.isContentEditable)
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault(); setSearchOpen(true); return
      }
      if (isTyping || event.metaKey || event.ctrlKey || event.altKey) return
      if (event.key.toLowerCase() === 'n') { event.preventDefault(); setQuickTaskOpen(true) }
      if (event.key.toLowerCase() === 't') { event.preventDefault(); navigate('/tests?add=1') }
      if (event.key.toLowerCase() === 'r') { event.preventDefault(); navigate('/revision') }
      if (event.key === '?') { event.preventDefault(); setShortcutsOpen(true) }
    }
    window.addEventListener('keydown', onShortcut)
    return () => window.removeEventListener('keydown', onShortcut)
  }, [navigate])

  const name = data.settings.owner_name || data.profile?.display_name || user?.displayName || 'Your notebook'
  const activeMore = [...moreRoutes].some(to => location.pathname === to)
  const statusLabel = syncState === 'syncing' ? 'Syncing' : syncState === 'offline' ? 'Offline' : syncState === 'error' ? 'Sync issue' : syncState === 'local' ? 'On this device' : pendingCount ? `${pendingCount} pending` : 'Synced'
  const StatusIcon = syncState === 'offline' || syncState === 'error' ? CloudOff : syncState === 'local' ? ShieldCheck : Cloud

  return <div className="app-shell">
    <aside className="sidebar" aria-label="Main navigation">
      <div className="sidebar-head">
        <Brand />
        <div className="sidebar-date"><span className="date-dot" />{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date())}</div>
      </div>
      <div className="sidebar-scroll">
        {navGroups.map(group => <div key={group.caption} className="nav-group">
          <div className="nav-caption">{navCaptionFor(group.caption, siteValues)}</div>
          <nav className="nav-list" aria-label={`${group.caption.toLowerCase()} sections`}>
            {group.items.map(item => <NavItem key={item.to} {...item} label={navLabelFor(item.to, item.label, siteValues)} />)}
          </nav>
        </div>)}
      </div>
      <div className="sidebar-bottom">
        <button className="sidebar-search" onClick={() => setSearchOpen(true)}><Search size={16} /><span>Search your notebook</span><kbd>⌘ K</kbd></button>
        <div className="sidebar-user">
          <div className="avatar-mark" aria-hidden="true">{(name.trim()[0] ?? 'S').toUpperCase()}</div>
          <div className="user-copy"><strong>{name}</strong><span>{user?.isLocal ? 'Local preview' : user?.email}</span></div>
          <IconButton label="Sign out" onClick={() => { void signOut().catch(() => notify('Could not sign out. Try again.', 'error')) }}><LogOut size={16} /></IconButton>
        </div>
      </div>
    </aside>

    <header className="mobile-topbar">
      <Brand compact />
      <div className="mobile-top-actions">
        <ThemeToggle className="theme-toggle-compact" />
        <button className="mobile-sync" onClick={() => void refresh()} aria-label={`Sync status: ${statusLabel}`} title={syncError ?? statusLabel}><StatusIcon size={16} />{pendingCount > 0 && <span className="mobile-pending-dot" />}</button>
        <IconButton label="Search notebook" onClick={() => setSearchOpen(true)}><Search size={19} /></IconButton>
      </div>
    </header>

    <main className="main-area">
      <div className="topline">
        <div className="breadcrumb"><span>JEE 2027</span><ChevronRight size={13} /><strong>{currentNavLabel(location.pathname, siteValues) ?? (location.pathname === '/focus' ? 'Focus mode' : 'Study home')}</strong></div>
        <div className="topline-right">
          {user?.isLocal && <span className="preview-pill"><span />Local preview — not synced</span>}
          <button className={`sync-pill sync-${syncState}`} onClick={() => void refresh()} title={syncError ?? 'Click to sync now'}>
            <StatusIcon size={15} className={syncState === 'syncing' ? 'sync-spin' : ''} /><span>{statusLabel}</span>{pendingCount > 0 && <small>{pendingCount}</small>}
          </button>
          <button className="help-pill" onClick={() => setShortcutsOpen(true)} aria-label="Show keyboard shortcuts"><CircleHelp size={16} /><span>Shortcuts</span></button>
          <ThemeToggle className="theme-toggle-topline" />
        </div>
      </div>
      {syncError && syncState !== 'local' && <div className={`sync-message sync-message-${syncState}`} role="status">
        <span>{syncError}</span><button onClick={() => void refresh()}>{syncState === 'offline' ? 'Retry when online' : 'Retry sync'}</button>
      </div>}
      <div className="page-wrap"><Suspense fallback={<PageLoading />}><Outlet /></Suspense></div>
      <footer className="app-footer"><span className="footer-spark" aria-hidden="true">✳</span><span className="footer-credit">Stracker <i>by</i> DYPOL LABS</span><span className="footer-tagline">A little more prepared, every day.</span></footer>
    </main>

    <nav className="mobile-nav" aria-label="Mobile navigation">
      {mobileBar.map(item => <MobileNavItem key={item.to} item={{ ...item, label: navLabelFor(item.to, item.label, siteValues) }} />)}
      <button className={`mobile-nav-item ${activeMore || mobileMore ? 'active' : ''}`} onClick={() => setMobileMore(true)} aria-expanded={mobileMore}>
        <MoreHorizontal size={20} /><span>More</span>
      </button>
    </nav>
    {mobileMore && <div className="mobile-sheet-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) setMobileMore(false) }}>
      <div className="mobile-sheet" role="dialog" aria-modal="true" aria-label="More navigation">
        <div className="sheet-handle" /><div className="sheet-head"><div><span className="eyebrow">STUDY TOOLS</span><h2>More to explore</h2></div><IconButton label="Close navigation" onClick={() => setMobileMore(false)}><X size={19} /></IconButton></div>
        <nav className="sheet-nav">
          {navGroups.map(group => <div key={group.caption}>
            <div className="sheet-nav-caption">{(() => { const caption = navCaptionFor(group.caption, siteValues); return caption.charAt(0) + caption.slice(1).toLowerCase() })()}</div>
            {group.items.filter(item => !mobileBar.some(bar => bar.to === item.to)).map(item => <NavItem key={item.to} {...item} label={navLabelFor(item.to, item.label, siteValues)} onClick={() => setMobileMore(false)} />)}
          </div>)}
          <button className="nav-link sheet-help" onClick={() => { setMobileMore(false); setShortcutsOpen(true) }}><CircleHelp size={18} /><span>Keyboard shortcuts</span></button>
          <button className="nav-link sheet-help" onClick={() => { setMobileMore(false); void signOut() }}><LogOut size={18} /><span>Sign out</span></button>
        </nav>
        <div className="sheet-brand-credit">Stracker <span>by DYPOL LABS</span></div>
      </div>
    </div>}

    <div className="quick-action-area">
      {quickActionsOpen && <div className="quick-action-menu" aria-label="Quick actions">
        <button onClick={() => { setQuickActionsOpen(false); setQuickTaskOpen(true) }}><ListChecks size={17} /><span>Plan a task</span><kbd>N</kbd></button>
        <button onClick={() => { setQuickActionsOpen(false); navigate('/tests?add=1') }}><NotebookPen size={17} /><span>Add a test</span><kbd>T</kbd></button>
        <button onClick={() => { setQuickActionsOpen(false); navigate('/practice?add=1') }}><ClipboardList size={17} /><span>Log practice</span></button>
        <button onClick={() => { setQuickActionsOpen(false); navigate('/focus') }}><Focus size={17} /><span>Focus session</span><Timer size={15} /></button>
      </div>}
      <button className={`quick-action-fab ${quickActionsOpen ? 'fab-open' : ''}`} onClick={() => setQuickActionsOpen(open => !open)} aria-label={quickActionsOpen ? 'Close quick actions' : 'Open quick actions'} aria-expanded={quickActionsOpen}>
        {quickActionsOpen ? <X size={23} /> : <Zap size={22} />}
      </button>
    </div>

    {searchOpen && <GlobalSearch data={data} onClose={() => setSearchOpen(false)} />}
    {shortcutsOpen && <ShortcutsDialog onClose={() => setShortcutsOpen(false)} />}
    {quickTaskOpen && <QuickTaskDialog data={data} onClose={() => setQuickTaskOpen(false)} />}
    {undoAvailable && <div className="undo-toast" role="status"><Check size={15} /><span>Deleted</span><button onClick={() => void undoDelete().then(() => notify('Deletion undone.')).catch(error => notify(error instanceof Error ? error.message : 'Could not undo deletion.', 'error'))}>Undo</button><IconButton label="Dismiss" onClick={dismissUndo}><X size={14} /></IconButton></div>}
    <AIExperience />
  </div>
}

function NavItem({ to, label, icon: Icon, exact, onClick }: NavigationItem & { onClick?: () => void }) {
  return <NavLink to={to} end={exact} onClick={onClick} className={({ isActive }) => `nav-link type-nav ${isActive ? 'active' : ''}`}>
    <Icon size={18} strokeWidth={1.8} /><span>{label}</span>
  </NavLink>
}

function MobileNavItem({ item }: { item: NavigationItem }) {
  const Icon = item.icon
  return <NavLink to={item.to} end={item.exact} className={({ isActive }) => `mobile-nav-item type-nav ${isActive ? 'active' : ''}`}>
    <Icon size={20} strokeWidth={1.8} /><span>{item.label === 'Mistake notebook' ? 'Mistakes' : item.label}</span>
  </NavLink>
}

function Brand({ compact = false }: { compact?: boolean }) {
  return <NavLink className={`brand ${compact ? 'brand-compact' : ''}`} to="/" aria-label="Stracker home">
    <span className="brand-mark"><span>S</span><i>✳</i></span><span className="brand-type type-brand">Stracker<small className="type-overline">JEE STUDY HOME</small></span>
  </NavLink>
}

function PageLoading() {
  return <div className="page-skeleton" aria-label="Loading page"><div className="skeleton-line wide" /><div className="skeleton-line" /><div className="skeleton-card-grid"><i /><i /><i /></div><div className="skeleton-large" /></div>
}

function QuickTaskDialog({ data, onClose }: { data: AppData; onClose: () => void }) {
  const { upsert } = useData()
  const { notify } = useToast()
  const [taskId] = useState(() => createId())
  const [title, setTitle] = useState('')
  const [subject, setSubject] = useState<Subject | ''>('')
  const [chapterId, setChapterId] = useState('')
  const [minutes, setMinutes] = useState('30')
  const [priority, setPriority] = useState<Priority>('Medium')
  const [loading, setLoading] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const loadingRef = useRef(false)
  const chapters = data.chapters.filter(chapter => !subject || chapter.subject === subject)
  const save = async (event: React.FormEvent) => {
    event.preventDefault()
    if (loadingRef.current) return
    const taskDate = indiaToday()
    const parsed = taskInputSchema.safeParse({
      title: title.trim(), estimated_minutes: minutes.trim() === '' ? null : Number(minutes), task_date: taskDate
    })
    if (!parsed.success) {
      const nextErrors: Record<string, string> = {}
      for (const issue of parsed.error.issues) nextErrors[String(issue.path[0] ?? 'form')] ??= issue.message
      setFieldErrors(nextErrors)
      notify('Please correct the highlighted task fields.', 'error')
      return
    }
    if (chapterId) {
      const chapter = data.chapters.find(item => item.id === chapterId)
      if (!chapter || (subject && chapter.subject !== subject)) { notify('Choose a chapter that belongs to the selected subject.', 'error'); return }
    }
    loadingRef.current = true
    setLoading(true)
    const now = new Date().toISOString()
    const task: DailyTask = {
      id: taskId, title: parsed.data.title, subject: subject || null, chapter_id: chapterId || null,
      estimated_minutes: parsed.data.estimated_minutes, priority, is_completed: false,
      task_date: taskDate, position: data.tasks.filter(item => item.task_date === taskDate).length,
      created_at: now, updated_at: now
    }
    try { await upsert('daily_tasks', task); notify('Task added to today.'); onClose() }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not save task. Retry.', 'error') }
    finally { loadingRef.current = false; setLoading(false) }
  }
  return <Dialog title="A small step for today" subtitle="Add a task to your study plan." onClose={onClose}>
    <form className="form-stack" noValidate onSubmit={save}>
      <Field label="What do you want to do?" required error={fieldErrors.title}><input autoFocus required maxLength={200} placeholder="e.g. Revise Kirchhoff's laws" value={title} onChange={event => { setTitle(event.target.value); setFieldErrors(current => { const next = { ...current }; delete next.title; return next }) }} /></Field>
      <div className="form-grid two"><Field label="Subject"><select value={subject} onChange={event => { setSubject(event.target.value as Subject | ''); setChapterId('') }}><option value="">General</option><option>Physics</option><option>Chemistry</option><option>Maths</option></select></Field>
        <Field label="Chapter"><select value={chapterId} onChange={event => setChapterId(event.target.value)}><option value="">Choose chapter</option>{chapters.map(chapter => <option key={chapter.id} value={chapter.id}>{chapter.name}</option>)}</select></Field></div>
      <div className="form-grid two"><Field label="Estimated time (min)" error={fieldErrors.estimated_minutes}><input type="number" min="0" max="1440" step="1" value={minutes} onChange={event => { setMinutes(event.target.value); setFieldErrors(current => { const next = { ...current }; delete next.estimated_minutes; return next }) }} /></Field>
        <Field label="Priority"><select value={priority} onChange={event => setPriority(event.target.value as Priority)}><option>High</option><option>Medium</option><option>Low</option></select></Field></div>
      <div className="dialog-actions"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" loading={loading}>Add to today <Check size={16} /></Button></div>
    </form>
  </Dialog>
}

function GlobalSearch({ data, onClose }: { data: AppData; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const navigate = useNavigate()
  const trimmed = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!trimmed) return []
    const found: { label: string; type: string; to: string; context: string }[] = []
    data.chapters.filter(chapter => `${chapter.name} ${chapter.subject} ${chapter.notes} ${chapter.formula_notes}`.toLowerCase().includes(trimmed)).slice(0, 6).forEach(chapter => found.push({ label: chapter.name, type: 'Chapter', to: '/syllabus', context: `${chapter.subject} · ${chapter.status}` }))
    data.tests.filter(test => `${test.title} ${test.test_type} ${test.notes}`.toLowerCase().includes(trimmed)).slice(0, 5).forEach(test => found.push({ label: test.title, type: 'Test', to: '/tests', context: `${test.test_date} · ${test.test_type}` }))
    data.mistakes.filter(mistake => `${mistake.question_note} ${mistake.solution_note} ${mistake.mistake_type}`.toLowerCase().includes(trimmed)).slice(0, 5).forEach(mistake => found.push({ label: mistake.question_note, type: 'Mistake', to: '/mistakes', context: mistake.mistake_type }))
    data.tasks.filter(task => task.title.toLowerCase().includes(trimmed)).slice(0, 5).forEach(task => found.push({ label: task.title, type: 'Task', to: '/planner', context: task.task_date }))
    return found.slice(0, 12)
  }, [data, trimmed])
  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, results.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(index - 1, 0)) }
    if (event.key === 'Enter' && results[selected]) { navigate(results[selected].to); onClose() }
  }
  return <Dialog title="Search your notebook" subtitle="Find chapters, tests, mistakes and tasks." onClose={onClose} className="search-dialog">
    <div className="global-search-input"><Search size={19} /><input autoFocus value={query} onChange={event => { setQuery(event.target.value); setSelected(0) }} onKeyDown={onKeyDown} placeholder="Try ‘Current Electricity’…" aria-label="Search notebook" /><kbd>ESC</kbd></div>
    <div className="search-results">
      {!trimmed ? <div className="search-hint"><Sparkles size={17} /> Your notes stay private to your account.</div> : results.length ? results.map((result, index) => <button className={`search-result ${selected === index ? 'selected' : ''}`} key={`${result.type}-${result.label}-${index}`} onClick={() => { navigate(result.to); onClose() }}>
        <span className="search-result-icon">{result.type === 'Chapter' ? <BookOpen size={16} /> : result.type === 'Test' ? <ListChecks size={16} /> : result.type === 'Mistake' ? <NotebookPen size={16} /> : <Check size={16} />}</span>
        <span className="search-result-text"><strong>{result.label}</strong><small>{result.context}</small></span><span className="search-result-type">{result.type}</span>
      </button>) : <div className="search-empty">No matches yet. Try another word.</div>}
    </div>
  </Dialog>
}

function ShortcutsDialog({ onClose }: { onClose: () => void }) {
  const shortcuts = [['⌘ / Ctrl + K', 'Search your notebook'], ['N', 'Add a task'], ['T', 'Add a test'], ['R', 'Open revisions'], ['Space', 'Start or pause in Focus mode'], ['Esc', 'Close the current dialog'], ['?', 'Show this help']]
  return <Dialog title="A few handy shortcuts" subtitle="Shortcuts stay out of the way while you type." onClose={onClose} className="dialog-narrow">
    <div className="shortcut-list">{shortcuts.map(([key, action]) => <div className="shortcut-row" key={key}><span>{action}</span><kbd>{key}</kbd></div>)}</div>
    <div className="dialog-actions"><Button onClick={onClose}>Got it</Button></div>
  </Dialog>
}

// Retained as a no-op import target for the lazy shell boundary to warm the most-used page.
export function WarmDashboard({ children }: { children: ReactNode }) { return <>{children}</> }
