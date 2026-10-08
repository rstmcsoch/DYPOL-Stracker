/* eslint-disable react-refresh/only-export-components */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, ChevronDown, ChevronUp, Compass, Flame } from 'lucide-react'
import { Button, NotebookCard, StatusBadge } from '../ui'
import { useData } from '../../contexts/DataContext'
import { indiaToday } from '../../lib/date'
import { recommendStudyNow, type Recommendation, type StudyNowResult } from '../../lib/jee/recommend'

export function useStudyNow(): StudyNowResult {
  const { data } = useData()
  const today = indiaToday()
  return useMemo(() => recommendStudyNow(data, today), [data, today])
}

/** The signature recommendation. Reasons are shown by default in compact mode and always available behind "Why?". */
export function StudyNowCard({ compact = false }: { compact?: boolean }) {
  const result = useStudyNow()
  const navigate = useNavigate()
  const [showWhy, setShowWhy] = useState(false)
  const primary = result.primary
  return <NotebookCard className="study-now-card accent-blue" aria-labelledby="study-now-heading">
    <div className="study-now-top">
      <span className="study-now-kicker"><Compass size={15} aria-hidden="true" /> PLANNING</span>
      {result.examMode && <StatusBadge tone="weak"><Flame size={12} aria-hidden="true" /> Exam Mode{result.examLabel ? ` · ${result.examLabel}` : ''}</StatusBadge>}
    </div>
    <h2 id="study-now-heading" className="study-now-title">What should I study now?</h2>
    {primary ? <>
      <p className="study-now-summary">{primary.summary}</p>
      <div className="study-now-actions">
        <Button onClick={() => navigate(primary.to)}>{primary.actionLabel} <ArrowRight size={15} /></Button>
        <Button variant="quiet" size="sm" onClick={() => setShowWhy(value => !value)} aria-expanded={showWhy}>{showWhy ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Why this?</Button>
      </div>
      {showWhy && <WhyList primary={primary} alternatives={result.alternatives} />}
      {!compact && result.alternatives.length > 0 && !showWhy && <p className="study-now-alt">Next up: {result.alternatives.slice(0, 2).map(item => item.title).join(' · ')}</p>}
    </> : <p className="study-now-summary muted">{result.emptyReason}</p>}
  </NotebookCard>
}

function WhyList({ primary, alternatives }: { primary: Recommendation; alternatives: Recommendation[] }) {
  return <div className="study-now-why">
    <strong>Ranked highest because:</strong>
    <ul>{primary.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
    {alternatives.length > 0 && <>
      <strong>Also in the running</strong>
      <ol>{alternatives.map(item => <li key={item.id}><span>{item.title}</span><small>{item.reasons.join('; ') || item.summary}</small></li>)}</ol>
    </>}
    <small className="study-now-note">Ranking is deterministic: overdue revisions, due backlog, due flashcards, mistakes awaiting retry, weak practice or test chapters, pending PYQs, and mock losses, weighted by chapter importance.</small>
  </div>
}
