import { Link } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { NotebookCard, PageHeader } from '../components/ui'
import { useAuth } from '../contexts/AuthContext'
import { useData } from '../contexts/DataContext'
import { chosenExamTitle, isJeeSettings } from '../lib/jee/exam'

/** Student profile (mobile bottom-bar destination; expanded in the profile phase). */
export default function ProfilePage() {
  const { user } = useAuth()
  const { data } = useData()
  const name = data.settings.owner_name || data.profile?.display_name || user?.displayName || 'Your notebook'
  const examTitle = isJeeSettings(data.settings) ? `JEE ${data.settings.exam_year ?? ''}`.trim() : chosenExamTitle(data.settings)
  return <div className="content-page profile-page">
    <PageHeader eyebrow="PROFILE" title="Profile" />
    <NotebookCard className="profile-card">
      <div className="profile-identity">
        <span className="avatar-mark profile-avatar" aria-hidden="true">{(name.trim()[0] ?? 'S').toUpperCase()}</span>
        <div className="profile-identity-copy">
          <strong>{name}</strong>
          <span>{user?.isLocal ? 'Local preview' : user?.email ?? ''}</span>
          <span>{examTitle}</span>
        </div>
        <Link className="button button-secondary profile-settings-link" to="/settings"><Settings size={16} /> Settings</Link>
      </div>
    </NotebookCard>
  </div>
}
