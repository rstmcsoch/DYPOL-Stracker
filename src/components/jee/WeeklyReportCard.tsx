import { useMemo } from 'react'
import { CalendarRange, Lightbulb } from 'lucide-react'
import { NotebookCard, SectionHeading, SubjectBadge } from '../ui'
import { minutesLabel, Pct } from './shared'
import { useData } from '../../contexts/DataContext'
import { indiaToday, prettyDate } from '../../lib/date'
import { buildWeeklyReport } from '../../lib/jee/weekly-report'

/** "Your week" summary. Comparisons appear only when both weeks have real data for the same subject. */
export function WeeklyReportCard() {
  const { data } = useData()
  const today = indiaToday()
  const report = useMemo(() => buildWeeklyReport(data, today), [data, today])
  return <section className="jee-weekly" aria-label="Your week">
    <SectionHeading title="Your week" note={`${prettyDate(report.range.start)} – ${prettyDate(report.range.end)}`} />
    <NotebookCard className="jee-weekly-card">
      <div className="jee-weekly-grid">
        <div><span>Studied</span><strong>{minutesLabel(report.studiedMinutes)}</strong></div>
        <div><span>Lecture</span><strong>{minutesLabel(report.activity.Lecture)}</strong></div>
        <div><span>Practice</span><strong>{minutesLabel(report.activity.Practice)}</strong></div>
        <div><span>Revision</span><strong>{minutesLabel(report.activity.Revision)}</strong></div>
        <div><span>Tests</span><strong>{report.testsLogged}</strong></div>
        <div><span>Questions</span><strong>{report.questionsAttempted.toLocaleString('en-IN')}</strong></div>
        <div><span>Practice accuracy</span><strong><Pct value={report.practiceAccuracy} /></strong></div>
        <div><span>Active days</span><strong>{report.activeDays}/7</strong></div>
      </div>
      <div className="jee-weekly-facts">
        <p><span>Strongest subject</span>{report.strongestSubject ? <><SubjectBadge subject={report.strongestSubject.subject} /> <b>{Math.round(report.strongestSubject.value)}%</b></> : <em className="jee-muted">not enough data yet</em>}</p>
        <p><span>Weakest area</span>{report.weakestArea ? <><b>{report.weakestArea.name}</b> <small className="jee-muted">{report.weakestArea.basis}, {Math.round(report.weakestArea.value)}%</small></> : <em className="jee-muted">not enough data yet</em>}</p>
      </div>
      {report.comparisons.length > 0 ? <ul className="jee-weekly-compare">{report.comparisons.map(line => <li key={line}>{line}</li>)}</ul> : <p className="jee-small jee-muted"><CalendarRange size={13} aria-hidden="true" /> {report.historyNote}</p>}
      <div className="jee-weekly-action"><Lightbulb size={16} aria-hidden="true" /><p><strong>Next change:</strong> {report.actionable}</p></div>
    </NotebookCard>
  </section>
}
