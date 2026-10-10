import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { CONSOLE_BASE } from '../policy'
import { PageHeader } from '../pageParts'
import { ContentEditorProvider } from './ContentEditor'
import { NavigationTab, OverviewTab, PublicTab } from './EditorTabs'
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
  { to: 'publishing', label: 'Preview & publishing', end: false }
]

export default function AppearancePage() {
  return (
    <>
      <PageHeader title="Appearance" description="Edit the words visitors and members see, preview them, then publish. Drafts stay private until you publish." />
      <ContentEditorProvider>
        <nav className="cc-tabs" aria-label="Appearance sections">
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
          <Route path="publishing" element={<PublishingTab />} />
          <Route path="*" element={<Navigate to={`${CONSOLE_BASE}/appearance`} replace />} />
        </Routes>
      </ContentEditorProvider>
    </>
  )
}
