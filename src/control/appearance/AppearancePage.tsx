import { useRef } from 'react'
import { Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { LayoutDashboard, PencilRuler } from 'lucide-react'
import { useCurrentTabInView } from '../useCurrentTabInView'
import { CONSOLE_BASE } from '../policy'
import { PageHeader } from '../pageParts'
import { ContentEditorProvider } from './ContentEditor'
import { NavigationTab, OverviewTab, PublicTab, StudentThemeTab } from './EditorTabs'
import { PublishingTab } from './PublishingTab'

/**
 * Appearance: owner-only editor for public-site and notebook-label copy.
 * Only subsections that are wired to live pages appear here. Omitted (not yet built):
 * Global branding, Pages & sections, Cards & components, Images & media, Theme & design tokens.
 */
const TABS = [
  { to: '', label: 'Overview', end: true },
  { to: 'public', label: 'Public website', end: false },
  { to: 'navigation', label: 'Navigation & labels', end: false },
  { to: 'student-theme', label: 'Student panel theme', end: false },
  { to: 'publishing', label: 'Preview & publishing', end: false }
]

export default function AppearancePage() {
  const navRef = useRef<HTMLElement>(null)
  useCurrentTabInView(navRef)
  return (
    <>
      <PageHeader title="Appearance" description="Edit the words visitors and members see, preview them, then publish. Drafts stay private until you publish."
        actions={<>
          <Link to={`${CONSOLE_BASE}/appearance/live-editor`} className="cc-btn cc-btn--primary cc-btn--md"><PencilRuler size={16} aria-hidden="true" /> Open Live Site Editor</Link>
          <Link to={`${CONSOLE_BASE}/appearance/student-dashboard-editor`} className="cc-btn cc-btn--default cc-btn--md" title="Student Dashboard Editor: the signed-in student workspace, previewed with sample data"><LayoutDashboard size={16} aria-hidden="true" /> Open Student Dashboard Editor</Link>
        </>} />
      <ContentEditorProvider>
        <nav className="cc-tabs" aria-label="Appearance sections" ref={navRef}>
          {TABS.map(tab => (
            <NavLink key={tab.label} to={tab.to ? `${CONSOLE_BASE}/appearance/${tab.to}` : `${CONSOLE_BASE}/appearance`} end={tab.end} className={({ isActive }) => `cc-tabs__link${isActive ? ' is-active' : ''}`}>
              {tab.label}
            </NavLink>
          ))}
        </nav>
        <Routes>
          <Route index element={<OverviewTab />} />
          <Route path="public" element={<PublicTab />} />
          <Route path="navigation" element={<NavigationTab />} />
          <Route path="student-theme" element={<StudentThemeTab />} />
          <Route path="publishing" element={<PublishingTab />} />
          <Route path="*" element={<Navigate to={`${CONSOLE_BASE}/appearance`} replace />} />
        </Routes>
      </ContentEditorProvider>
    </>
  )
}
