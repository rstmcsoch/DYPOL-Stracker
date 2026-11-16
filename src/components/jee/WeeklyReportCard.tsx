import { T } from '../../lib/student-layout/T'
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
        <div><span><T k="analytics:studied">{"Studied"}</T></span><strong>{minutesLabel(report.studiedMinutes)}</strong></div>
        <div><span><T k="analytics:lecture">{"Lecture"}</T></span><strong>{minutesLabel(report.activity.Lecture)}</strong></div>
        <div><span><T k="analytics:practice">{"Practice"}</T></span><strong>{minutesLabel(report.activity.Practice)}</strong></div>
        <div><span><T k="analytics:revision">{"Revision"}</T></span><strong>{minutesLabel(report.activity.Revision)}</strong></div>
        <div><span><T k="analytics:tests">{"Tests"}</T></span><strong>{report.testsLogged}</strong></div>
        <div><span><T k="analytics:questions">{"Questions"}</T></span><strong>{report.questionsAttempted.toLocaleString('en-IN')}</strong></div>
        <div><span><T k="analytics:practice-accuracy">{"Practice accuracy"}</T></span><strong><Pct value={report.practiceAccuracy} /></strong></div>
        <div><span><T k="analytics:active-days">{"Active days"}</T></span><strong>{report.activeDays}/7</strong></div>
      </div>
      <div className="jee-weekly-facts">
        <p><span><T k="analytics:strongest-subject">{"Strongest subject"}</T></span>{report.strongestSubject ? <><SubjectBadge subject={report.strongestSubject.subject} /> <b>{Math.round(report.strongestSubject.value)}%</b></> : <em className="jee-muted"><T k="analytics:not-enough-data-yet">{"not enough data yet"}</T></em>}</p>
        <p><span><T k="analytics:weakest-area">{"Weakest area"}</T></span>{report.weakestArea ? <><b>{report.weakestArea.name}</b> <small className="jee-muted">{report.weakestArea.basis}, {Math.round(report.weakestArea.value)}%</small></> : <em className="jee-muted"><T k="analytics:not-enough-data-yet">{"not enough data yet"}</T></em>}</p>
      </div>
      {report.comparisons.length > 0 ? <ul className="jee-weekly-compare">{report.comparisons.map(line => <li key={line}>{line}</li>)}</ul> : <p className="jee-small jee-muted"><CalendarRange size={13} aria-hidden="true" /> {report.historyNote}</p>}
      <div className="jee-weekly-action"><Lightbulb size={16} aria-hidden="true" /><p><strong><T k="analytics:next-change">{"Next change:"}</T></strong> {report.actionable}</p></div>
    </NotebookCard>
  </section>
}
