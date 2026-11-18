import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, DatabaseBackup, Flame, LogOut, Settings } from 'lucide-react'
import { Button, NotebookCard, PageHeader, StatusBadge } from '../components/ui'
import { ExamSelectionSection } from '../components/jee/ExamSelectionSection'
import { StreakCalendar } from '../components/jee/StreakCalendar'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { useToast } from '../contexts/ToastContext'
import { indiaToday, prettyDate } from '../lib/date'
import { chosenExamTitle, isJeeSettings } from '../lib/jee/exam'
import { computeStreaks } from '../lib/jee/study-time'
import { averageDaysBetween, personalRecords, recentBadges } from '../lib/jee/records'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

/**
 * The mobile "you" tab: who you are, the exam you are working toward, the last twelve weeks
 * at a glance, your personal records, backup status and sign-out. Everything here is either
 * identity or a summary of data edited elsewhere, which is what keeps it from being a second
 * Settings page.
 */
export default function ProfilePage() {
  const sl = usePageSlots('profile')
  const { user, signOut } = useAuth()
  const { data } = useData()
  const { notify } = useToast()
  const navigate = useNavigate()
  const today = indiaToday()
  const name = data.settings.owner_name || data.profile?.display_name || user?.displayName || 'Your notebook'
  const examTitle = isJeeSettings(data.settings) ? `JEE ${data.settings.exam_year ?? ''}`.trim() : chosenExamTitle(data.settings)
  const streak = computeStreaks(data, today)
  const records = personalRecords(data, today)
  const badges = recentBadges(data, today)
  const backupAge = data.settings.last_backup_at ? averageDaysBetween(data.settings.last_backup_at.slice(0, 10), today) : null

  const doSignOut = async () => {
    try { await signOut(); navigate('/login', { replace: true }) }
    catch (error) { notify(error instanceof Error ? error.message : 'Could not sign out. Retry.', 'error') }
  }

  return <div className="content-page profile-page">
    <PageHeader layoutId="profile.header" eyebrow="PROFILE" title="Profile" action={<Link className="profile-gear" to="/settings" aria-label="Open settings" title="Settings"><Settings size={20} aria-hidden="true" /></Link>} />
    <NotebookCard {...sl.attrs('card')} className="profile-card">
      <div className="profile-identity">
        <span className="avatar-mark profile-avatar" aria-hidden="true">{(name.trim()[0] ?? 'S').toUpperCase()}</span>
        <div className="profile-identity-copy">
          <strong>{name}</strong>
          <span>{user?.isLocal ? 'Local preview' : user?.email ?? ''}</span>
          <span>{examTitle}</span>
        </div>
      </div>
      <div className="profile-stats" aria-label="Study rhythm">
        <div className="profile-stat"><Flame size={15} aria-hidden="true" /><strong>{streak.current} day{streak.current === 1 ? '' : 's'}</strong><span><T k="profile:current-streak">{"current streak"}</T></span></div>
        <div className="profile-stat"><strong>{streak.longest} day{streak.longest === 1 ? '' : 's'}</strong><span><T k="profile:longest-streak">{"longest streak"}</T></span></div>
        <div className="profile-stat"><strong>{streak.weeklyConsistency}/7</strong><span><T k="profile:active-this-week">{"active this week"}</T></span></div>
        <div className="profile-stat"><strong>{streak.freezesLeftThisMonth}</strong><span>freezes left</span></div>
      </div>
    </NotebookCard>

    <StreakCalendar />

    <NotebookCard className="profile-records">
      <div className="profile-records-head"><div><span className="eyebrow"><T k="profile:personal-records">{"PERSONAL RECORDS"}</T></span><h2>Your best so far</h2><p>Private to this notebook. No comparison with anyone else.</p></div></div>
      <div className="profile-record-grid">{records.map(record => <div key={record.id} className="profile-record">
        <span>{record.label}</span>
        <strong>{record.value}</strong>
        <small>{record.detail}</small>
      </div>)}</div>
      {badges.length > 0 && <div className="profile-badges" aria-label="Milestones reached">
        {badges.map(badge => <span key={badge.id} className="profile-badge" title={badge.detail}>{badge.label}</span>)}
      </div>}
    </NotebookCard>

    <NotebookCard className="profile-backup">
      <div className="profile-backup-row">
        <span className="profile-backup-icon"><DatabaseBackup size={18} /></span>
        <div>
          <strong>Backup</strong>
          <p>{backupAge === null ? 'No backup exported yet. Your data lives in your account and on this device.' : backupAge === 0 ? 'Last backup was today.' : `Last backup was ${backupAge} day${backupAge === 1 ? '' : 's'} ago.`}</p>
        </div>
        <StatusBadge tone={backupAge === null || backupAge > 14 ? 'weak' : 'Strong'}>{backupAge === null ? 'Never' : backupAge > 14 ? 'Overdue' : 'Current'}</StatusBadge>
        <Link className="text-link" to="/backup">Open backup <ArrowRight size={13} /></Link>
      </div>
    </NotebookCard>

    <ExamSelectionSection />
    <p className="profile-settings-note"><T k="profile:theme-reading-font-appearance-and-ai-set">{"Theme, font and AI settings are under the gear icon."}</T></p>
    <div className="profile-signout"><Button variant="secondary" onClick={() => void doSignOut()}><LogOut size={15} /> Sign out</Button><span>{data.settings.last_backup_at ? `Last backup ${prettyDate(data.settings.last_backup_at.slice(0, 10))}` : 'Export a backup before signing out on a shared device.'}</span></div>
  </div>
}
