import { Link } from 'react-router-dom'
import { Flame, Settings } from 'lucide-react'
import { NotebookCard, PageHeader } from '../components/ui'
import { ExamSelectionSection } from '../components/jee/ExamSelectionSection'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { indiaToday } from '../lib/date'
import { chosenExamTitle, isJeeSettings } from '../lib/jee/exam'
import { computeStreaks } from '../lib/jee/study-time'

/**
 * Student profile: identity, the exam choices, and study rhythm at a glance.
 * Settings stays one tap away (gear, top right) and opens the full Settings page.
 */
export default function ProfilePage() {
  const { user } = useAuth()
  const { data } = useData()
  const name = data.settings.owner_name || data.profile?.display_name || user?.displayName || 'Your notebook'
  const examTitle = isJeeSettings(data.settings) ? `JEE ${data.settings.exam_year ?? ''}`.trim() : chosenExamTitle(data.settings)
  const streak = computeStreaks(data, indiaToday())
  return <div className="content-page profile-page">
    <PageHeader eyebrow="PROFILE" title="Profile" action={<Link className="profile-gear" to="/settings" aria-label="Open settings" title="Settings"><Settings size={20} aria-hidden="true" /></Link>} />
    <NotebookCard className="profile-card">
      <div className="profile-identity">
        <span className="avatar-mark profile-avatar" aria-hidden="true">{(name.trim()[0] ?? 'S').toUpperCase()}</span>
        <div className="profile-identity-copy">
          <strong>{name}</strong>
          <span>{user?.isLocal ? 'Local preview' : user?.email ?? ''}</span>
          <span>{examTitle}</span>
        </div>
      </div>
      <div className="profile-stats" aria-label="Study rhythm">
        <div className="profile-stat"><Flame size={15} aria-hidden="true" /><strong>{streak.current} day{streak.current === 1 ? '' : 's'}</strong><span>current streak</span></div>
        <div className="profile-stat"><strong>{streak.longest} day{streak.longest === 1 ? '' : 's'}</strong><span>longest streak</span></div>
        <div className="profile-stat"><strong>{streak.weeklyConsistency}/7</strong><span>active this week</span></div>
      </div>
    </NotebookCard>
    <ExamSelectionSection />
    <p className="profile-settings-note">Theme, reading font, appearance and AI settings live under the gear at the top of this page.</p>
  </div>
}
