import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, MailCheck } from 'lucide-react'
import { NotebookCard } from '../ui'
import { useData } from '../../contexts/DataContext'
import { indiaToday, prettyDate } from '../../lib/date'
import { buildWeeklyReport, digestVisibleOn } from '../../lib/jee/weekly-report'
import { fmtDuration } from '../../lib/format'
import { T } from '../../lib/student-layout/T'

/**
 * The Sunday digest, delivered where the student already is.
 *
 * The audit wanted `buildWeeklyReport` shipped as an email or push. There is no mail sender
 * in this app and no server-side scheduler, so rather than pretend, the digest appears on
 * Home only on the last two days of the week — the moment a weekly review is actually
 * useful — and links to the full card in Analytics. It disappears the rest of the week,
 * so it never becomes another permanent block competing for attention.
 */
export function WeekDigest() {
  const { data } = useData()
  const navigate = useNavigate()
  const today = indiaToday()
  const report = useMemo(() => buildWeeklyReport(data, today), [data, today])
  if (!digestVisibleOn(today)) return null
  const empty = report.studiedMinutes === 0 && report.testsLogged === 0 && report.questionsAttempted === 0
  return <NotebookCard className="jee-snap-card week-digest">
    <div className="jee-snap-head"><span className="eyebrow"><MailCheck size={13} aria-hidden="true" />{' '}<T k="home:week-digest">{"WEEK DIGEST"}</T></span><span className="week-digest-range">{prettyDate(report.range.start)} – {prettyDate(report.range.end)}</span></div>
    {empty ? <p className="week-digest-empty">Nothing logged this week yet. One focus block is enough to start the next digest.</p> : <>
      <ul className="week-digest-facts">
        <li><strong>{fmtDuration(report.studiedMinutes)}</strong><span>studied</span></li>
        <li><strong>{report.questionsAttempted}</strong><span>questions</span></li>
        <li><strong>{report.activeDays}</strong><span>active days</span></li>
        {report.strongestSubject && <li><strong>{report.strongestSubject.subject}</strong><span>strongest</span></li>}
      </ul>
      <p className="week-digest-action">{report.actionable}</p>
    </>}
    <button type="button" className="jee-link" onClick={() => navigate('/analytics')}>Full report <ArrowRight size={13} aria-hidden="true" /></button>
  </NotebookCard>
}
