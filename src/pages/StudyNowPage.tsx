import { useNavigate } from 'react-router-dom'
import { Settings2 } from 'lucide-react'
import { Button, NotebookCard, PageHeader, SectionHeading, StatusBadge } from '../components/ui'
import { StudyNowCard } from '../components/jee/StudyNowCard'
import { Meter, Pct } from '../components/jee/shared'
import { useData } from '../contexts/DataContext'
import { indiaToday } from '../lib/date'
import { allTrackReadiness, countdownLabel, countdownShape, currentExamMode, trackLabels } from '../lib/jee/exam'
import { computeReminders, REMINDER_LABEL } from '../lib/jee/reminders'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

/**
 * `/study-now` is now the expanded view of the Home recommendation card, not a separate
 * destination in the sidebar: same card component (with the full ranked shortlist), plus
 * the Exam-Mode and track-readiness detail that used to justify a whole page. Old links
 * keep working.
 */
export default function StudyNowPage() {
  const { data } = useData()
  const navigate = useNavigate()
  const sl = usePageSlots('study-now')
  const today = indiaToday()
  const mode = currentExamMode(data, today)
  const shape = countdownShape(data, today)
  const tracks = allTrackReadiness(data, today)
  const labels = trackLabels(data.settings)
  const reminders = computeReminders(data, today)
  return <div className="content-page study-now-page">
    <PageHeader layoutId="study-now.header" title="What to study now" subtitle="The full ranked shortlist behind your Home card." />
    <StudyNowCard expanded />

    {shape.phase !== 'none' && <NotebookCard className={`jee-countdown-shape phase-${shape.phase}`}>
      <div className="jee-countdown-shape-head"><span className="jee-tag">{shape.label}</span><strong>{shape.daysLeft === null ? '' : countdownLabel(shape.daysLeft)}</strong></div>
      <p>{shape.guidance}</p>
      <div className="jee-countdown-steps" aria-label="Plan shape">
        {(['build', 'consolidate', 'revise-only'] as const).map(phase => <span key={phase} className={shape.phase === phase ? 'is-active' : shape.phase === 'build' && phase !== 'build' ? '' : phase === 'revise-only' && shape.phase === 'consolidate' ? 'is-next' : ''}>{phase === 'build' ? 'Build' : phase === 'consolidate' ? 'Consolidate' : 'Revise only'}</span>)}
      </div>
    </NotebookCard>}

    <SectionHeading title="Exam Mode" note={mode.reason} action={<Button variant="secondary" size="sm" onClick={() => navigate('/settings')}><Settings2 size={15} />{' '}<T k="study-now:exam-settings">{"Exam settings"}</T></Button>} />
    <NotebookCard {...sl.attrs('exam-mode')} className="jee-exam-mode">
      <div className="jee-exam-mode-head">
        <StatusBadge tone={mode.active ? 'weak' : 'muted'}>{mode.active ? 'On' : 'Off'}</StatusBadge>
        <strong>{mode.label ?? 'No active track'}</strong>
        <span className="jee-muted">{countdownLabel(mode.daysLeft)}</span>
      </div>
      {mode.active && <p className="jee-small"><T k="study-now:while-exam-mode-is-on-revision-pyqs-mock">{"Exam Mode prioritises revision, PYQs, mocks and weak areas. No new theory."}</T></p>}
    </NotebookCard>

    <SectionHeading title="Track readiness" note="Each track is measured against its own PYQs." />
    <div {...sl.attrs('tracks')} className="jee-track-grid">
      {tracks.map(track => <NotebookCard key={track.track} className="jee-track-card">
        <div className="jee-track-head"><strong>{labels[track.track]}</strong><span className="jee-muted">{countdownLabel(track.daysLeft)}</span></div>
        <div className="jee-track-percent"><Pct value={track.percent} /></div>
        <Meter value={track.percent} label={`${labels[track.track]} readiness`} tone={track.track === 'boards' ? 'green' : 'blue'} />
        <ul className="jee-track-parts">{track.components.map(part => <li key={part.label}><span>{part.label}</span><b><Pct value={part.value} /></b><small className="jee-muted">{part.note}</small></li>)}</ul>
      </NotebookCard>)}
    </div>

    {reminders.length > 0 && <>
      <SectionHeading title="Reminders right now" note="Change in Settings → Study rhythm." />
      <NotebookCard><ul className="jee-reminder-list">{reminders.map(item => <li key={item.kind}><span className="jee-tag">{REMINDER_LABEL[item.kind]}</span><span><strong>{item.title}.</strong> {item.body}</span></li>)}</ul></NotebookCard>
    </>}
  </div>
}
