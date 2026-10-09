import type { LucideIcon } from 'lucide-react-native'
import { AlarmClock, Activity, ArrowDownToLine, AlertTriangle, BookOpen, CalendarDays, ClipboardList, Compass, Focus, Home, Inbox, Layers, Library, ListChecks, Microscope, NotebookPen, RotateCcw, Sparkles, Settings } from '../icons'

export interface NavItem { to: string; label: string; icon: LucideIcon }
export interface NavGroup { caption: string; items: NavItem[] }

/** The website's navigation, grouped exactly as its sidebar and More menu are. */
export const NAV_GROUPS: NavGroup[] = [
  { caption: 'STUDY', items: [
    { to: '/home', label: 'Home', icon: Home },
    { to: '/focus', label: 'Focus', icon: Focus },
    { to: '/backlog', label: 'Backlog', icon: Inbox },
    { to: '/practice', label: 'Practice', icon: ClipboardList },
    { to: '/assistant', label: 'Ask Stracker', icon: Sparkles }
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

/** The four daily destinations on the bottom dock. Everything else sits under More. */
export const DOCK_ITEMS: NavItem[] = [
  { to: '/home', label: 'Home', icon: Home },
  { to: '/practice', label: 'Practice', icon: ClipboardList },
  { to: '/tests', label: 'Tests', icon: ListChecks },
  { to: '/revision', label: 'Revision', icon: AlarmClock }
]

const dockPaths = new Set(DOCK_ITEMS.map(item => item.to))
export const MORE_PATHS: ReadonlySet<string> = new Set(
  NAV_GROUPS.flatMap(group => group.items.map(item => item.to)).filter(path => !dockPaths.has(path))
)
