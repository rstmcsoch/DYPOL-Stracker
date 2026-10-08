import { useNavigate } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { Button, NotebookCard, PageHeader, SectionHeading, StatusBadge } from '../components/ui'
import { StudyNowCard } from '../components/jee/StudyNowCard'
import { Meter, Pct } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { indiaToday } from '../lib/date'
import { allTrackReadiness, countdownLabel, currentExamMode, TRACK_LABEL } from '../lib/jee/exam'
import { computeReminders, REMINDER_LABEL } from '../lib/jee/reminders'

export default function StudyNowPage() {
  const { data } = useData()
  const navigate = useNavigate()
  const today = indiaToday()
  const mode = currentExamMode(data, today)
  const tracks = allTrackReadiness(data, today)
  const reminders = computeReminders(data, today)
  return <div className="content-page study-now-page">
    <PageHeader eyebrow="ONE DECISION AT A TIME" title="Study now" subtitle="The most urgent item across revisions, backlog, flashcards, practice, PYQs, weak chapters and mock losses — and exactly why." />
    <StudyNowCard />

    <SectionHeading title="Exam Mode" note={mode.reason} action={<Button variant="secondary" size="sm" onClick={() => navigate('/settings')}><Settings2 size={15} /> Exam settings</Button>} />
    <NotebookCard className="jee-exam-mode">
      <div className="jee-exam-mode-head">
        <StatusBadge tone={mode.active ? 'weak' : 'muted'}>{mode.active ? 'On' : 'Off'}</StatusBadge>
        <strong>{mode.label ?? 'No active track'}</strong>
        <span className="jee-muted">{countdownLabel(mode.daysLeft)}</span>
      </div>
      {mode.active && <p className="jee-small">While Exam Mode is on, revision, PYQs, mocks, flashcards and weak-area fixes are weighted up. New theory is not suggested, and backlog only surfaces when it is due or high priority.</p>}
    </NotebookCard>

    <SectionHeading title="Track readiness" note="One shared syllabus. Each track is measured against its own exam’s PYQs." />
    <div className="jee-track-grid">
      {tracks.map(track => <NotebookCard key={track.track} className="jee-track-card">
        <div className="jee-track-head"><strong>{TRACK_LABEL[track.track]}</strong><span className="jee-muted">{countdownLabel(track.daysLeft)}</span></div>
        <div className="jee-track-percent"><Pct value={track.percent} /></div>
        <Meter value={track.percent} label={`${TRACK_LABEL[track.track]} readiness`} tone={track.track === 'boards' ? 'green' : 'blue'} />
        <ul className="jee-track-parts">{track.components.map(part => <li key={part.label}><span>{part.label}</span><b><Pct value={part.value} /></b><small className="jee-muted">{part.note}</small></li>)}</ul>
      </NotebookCard>)}
    </div>

    {reminders.length > 0 && <>
      <SectionHeading title="Reminders right now" note="Turn types on or off in Settings → Study rhythm." />
      <NotebookCard><ul className="jee-reminder-list">{reminders.map(item => <li key={item.kind}><span className="jee-tag">{REMINDER_LABEL[item.kind]}</span><span><strong>{item.title}.</strong> {item.body}</span></li>)}</ul></NotebookCard>
    </>}
  </div>
}
