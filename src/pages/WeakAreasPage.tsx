import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowRight, ArrowUpRight, ChevronDown, ChevronUp, Minus, Plus, Target, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { Button, EmptyState, InfoTip, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { getChapterPerformance, getRepeatOffenders } from '../lib/analytics'
import { practiceByChapter, PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL, type PracticeAggregate } from '../lib/jee/progress'
import { Meter, Pct } from '../components/jee/shared'
import { causeTotals } from '../lib/mistake-cause'
import { indiaToday } from '../lib/date'
import type { Chapter, Subject } from '../types'
import { useReportSubjects } from '../lib/exams/useExamSubjects'
import { T } from '../lib/student-layout/T'
import { usePageSlots } from '../lib/student-layout/use-layout'

const MOBILE_VISIBLE_LIMIT = 8

export default function WeakAreasPage() {
  const sl = usePageSlots('weak-areas')
  const subjectList = useReportSubjects()
  const { data } = useData()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const [showAllTestedMobile, setShowAllTestedMobile] = useState(false)
  const [showUntested, setShowUntested] = useState(false)
  const performance = useMemo(() => getChapterPerformance(data), [data])
  const chapters = performance.filter(item => subject === 'all' || item.chapter.subject === subject)
  const untested = chapters.filter(item => item.classification === 'Untested').sort((a, b) => a.chapter.subject.localeCompare(b.chapter.subject) || a.chapter.position - b.chapter.position)
  const tested = chapters.filter(item => item.classification !== 'Untested').sort((a, b) => Number(b.dropping) - Number(a.dropping) || (a.average ?? 100) - (b.average ?? 100))
  const weak = tested.filter(item => item.classification === 'Weak')
  const strong = tested.filter(item => item.classification === 'Strong')
  const dropCount = tested.filter(item => item.dropping).length
  const practice = useMemo(() => practiceByChapter(data), [data])
  // Practice is a second, independent signal: low accuracy on a meaningful number of questions, or many misses.
  const practiceWeak = data.chapters
    .filter(chapter => subject === 'all' || chapter.subject === subject)
    .map(chapter => ({ chapter, agg: practice.get(chapter.id) }))
    .filter((item): item is { chapter: Chapter; agg: PracticeAggregate } => Boolean(item.agg))
    .filter(item => item.agg.attempted >= PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL && item.agg.accuracy !== null && (item.agg.accuracy < data.settings.weak_threshold || item.agg.incorrect >= 40))
    .sort((a, b) => (a.agg.accuracy ?? 0) - (b.agg.accuracy ?? 0))
  const pageClass = `content-page weak-page${showAllTestedMobile ? ' mobile-tested-expanded' : ''}`
  // Why marks go missing, from both the notebook and mock tags — the "what to fix" behind the "which chapter" table.
  const causes = useMemo(() => causeTotals(
    subject === 'all' ? data.mistakes : data.mistakes.filter(mistake => data.chapters.find(chapter => chapter.id === mistake.chapter_id)?.subject === subject),
    subject === 'all' ? data.testErrorLogs : data.testErrorLogs.filter(log => log.subject === subject)
  ), [data.mistakes, data.testErrorLogs, data.chapters, subject])
  // The same cause repeating in one chapter is the strongest single signal in the notebook.
  const repeats = useMemo(() => getRepeatOffenders(data, indiaToday(), { days: 30, minCount: 3 })
    .filter(item => subject === 'all' || item.subject === subject).slice(0, 3), [data, subject])

  return <div className={pageClass}>
    <PageHeader layoutId="weak-areas.header" title="Weak areas" subtitle="Based on your last three results." doodle={<Target size={19} />} action={<label className="weak-subject-select"><span><T k="weak-areas:subject">{"Subject"}</T></span><select value={subject} onChange={event => { setSubject(event.target.value as 'all' | Subject); setShowAllTestedMobile(false); setShowUntested(false) }}><option value="all">All subjects</option>{subjectList.map(item => <option key={item}>{item}</option>)}</select></label>} />
    {repeats.length > 0 && <section className="weak-section weak-repeat-section" aria-label="Repeating mistakes">
      <SectionHeading title="Repeating mistakes" note="The same cause three or more times in 30 days." />
      <div className="weak-repeat-list">{repeats.map(item => <NotebookCard key={`${item.chapterId}-${item.cause}`} className="weak-repeat-card">
        <div className="weak-repeat-head"><SubjectBadge subject={item.subject} /><strong>{item.chapterName}</strong></div>
        <p><b>{item.count}×</b> {item.cause.toLowerCase()} in {item.spanDays} day{item.spanDays === 1 ? '' : 's'}</p>
        <button type="button" className="text-link" onClick={() => navigate(item.to)}>Practise this chapter <ArrowRight size={13} /></button>
      </NotebookCard>)}</div>
    </section>}

    {causes.length > 0 && <section className="weak-section weak-cause-section" aria-label="Why marks go missing">
      <SectionHeading title="Why marks go missing" note="Mistake notes and mock tags, in one vocabulary." />
      <NotebookCard className="practice-signal-board">{causes.slice(0, 5).map(row => <div key={row.cause} className="practice-signal-row">
        <div className="practice-signal-meter"><Meter value={(row.total / causes[0]!.total) * 100} label={`${row.cause} share`} tone="orange" /><b>{row.total}</b></div>
        <small className="jee-muted">{row.cause} · {row.mistakes} note{row.mistakes === 1 ? '' : 's'}, {row.logs} mock tag{row.logs === 1 ? '' : 's'}</small>
      </div>)}</NotebookCard>
    </section>}

    {!sl.hidden('rule') && <div {...sl.attrs('rule')} className="weak-rule-banner"><span className="rule-pencil">✎</span><p><T k="weak-areas:current-bands">{"Current bands:"}</T>{' '}<strong>Weak &lt; {data.settings.weak_threshold}%</strong><span>·</span><strong>Okay {data.settings.weak_threshold}–{data.settings.strong_threshold}%</strong><span>·</span><strong>Strong &gt; {data.settings.strong_threshold}%</strong></p><button onClick={() => navigate('/settings')}><T k="weak-areas:adjust-in-settings">{"Adjust in Settings ↗"}</T></button></div>}
    <div {...sl.attrs('overview')} className="weak-overview-grid"><NotebookCard className="weak-overview-item weak-tint"><div><span className="weak-overview-icon"><TriangleAlert size={17} /></span><span className="eyebrow"><T k="weak-areas:needs-another-look">{"WEAK"}</T></span></div><strong>{weak.length}</strong><small>chapter{weak.length === 1 ? '' : 's'} below the weak-area threshold</small></NotebookCard><NotebookCard className="weak-overview-item dropping-tint"><div><span className="weak-overview-icon"><TrendingDown size={17} /></span><span className="eyebrow"><T k="weak-areas:dropping">{"DROPPING"}</T></span></div><strong>{dropCount}</strong><small>latest result fell by {data.settings.dropping_threshold} points or more</small></NotebookCard><NotebookCard className="weak-overview-item untested-tint"><div><span className="weak-overview-icon"><Target size={17} /></span><span className="eyebrow"><T k="weak-areas:no-baseline-yet">{"UNTESTED"}</T></span></div><strong>{untested.length}</strong><small><T k="weak-areas:untested-not-classified-as-weak">{"untested · not classified as weak"}</T></small></NotebookCard><NotebookCard className="weak-overview-item strong-tint"><div><span className="weak-overview-icon"><TrendingUp size={17} /></span><span className="eyebrow"><T k="weak-areas:feeling-steady">{"STRONG"}</T></span></div><strong>{strong.length}</strong><small>chapter{strong.length === 1 ? '' : 's'} at or above the strong threshold</small></NotebookCard></div>

    {practiceWeak.length > 0 && <section className="weak-section" aria-label="Practice signal"><SectionHeading title="Practice is flagging these" note="From your practice log. Needs 20+ questions per chapter." />
      <NotebookCard className="practice-signal-board">{practiceWeak.map(({ chapter, agg }) => <div key={chapter.id} className="practice-signal-row">
        <div><strong>{chapter.name}</strong><small>{agg.attempted} questions · {agg.incorrect} incorrect · recent <Pct value={agg.recentAccuracy} /></small></div>
        <div className="practice-signal-meter"><Meter value={agg.accuracy} label={`${chapter.name} practice accuracy`} tone="orange" /><b><Pct value={agg.accuracy} /></b></div>
        <button type="button" className="weak-chapter-link" onClick={() => navigate(`/practice?chapter=${chapter.id}&add=1`)}><T k="weak-areas:log-practice">{"Log practice ↗"}</T></button>
      </div>)}</NotebookCard></section>}
    {dropCount > 0 && <NotebookCard className="dropping-alert"><span className="dropping-mark"><ArrowDownRight size={18} /></span><div><strong><T k="weak-areas:a-dip-worth-checking">{"A dip worth checking"}</T></strong><p>{tested.filter(item => item.dropping).map(item => `${item.chapter.name} (${Math.round(item.results[1]?.percentage ?? 0)}% → ${Math.round(item.latest ?? 0)}%)`).join(' · ')}</p></div><span><T k="weak-areas:compare-the-paper-not-just-the-score">{"Check the paper, not just the score."}</T></span></NotebookCard>}

    <section {...sl.attrs('tested')} className="weak-section"><SectionHeading title="Tested chapters" note={`${tested.length} chapter${tested.length === 1 ? '' : 's'} with usable scores`} />
      <NotebookCard className="weak-table-board">
        {tested.length === 0 ? <EmptyState lk="weak-areas:no-usable-chapter-results-yet" icon={<Target size={24} />} title="No usable chapter results yet." action={<Button variant="secondary" size="sm" onClick={() => navigate('/tests?add=1')}><T k="weak-areas:add-a-chapter-test">{"Add a chapter test"}</T></Button>} /> : <div className="weak-table-scroll"><table className="weak-table" id="weak-tested-table"><thead><tr><th><T k="weak-areas:chapter">{"CHAPTER"}</T></th><th><T k="weak-areas:last-3-results">{"LAST 3 RESULTS"}</T></th><th><T k="weak-areas:average">{"AVERAGE"}</T></th><th><T k="weak-areas:latest">{"LATEST"}</T></th><th><T k="weak-areas:trend">{"TREND"}</T></th><th><T k="weak-areas:reading">{"READING"}</T></th></tr></thead><tbody>{tested.map((item, index) => {
          const dropping = item.dropping
          const TrendIcon = item.trend === 'up' ? TrendingUp : item.trend === 'down' ? TrendingDown : item.trend === 'steady' ? Minus : Target
          return <tr key={item.chapter.id} className={`${dropping ? 'is-dropping-row ' : ''}${index >= MOBILE_VISIBLE_LIMIT ? 'weak-mobile-extra' : ''}`}><td><button className="weak-chapter-link" onClick={() => navigate(`/syllabus?chapter=${encodeURIComponent(item.chapter.id)}`)}><span className={`weak-subject-marker marker-${item.chapter.subject.toLowerCase()}`} /><span><strong>{item.chapter.name}</strong><small><SubjectBadge subject={item.chapter.subject} /> · {item.results.length} test{item.results.length === 1 ? '' : 's'} used</small></span></button></td><td><div className="last-three-scores">{[...item.results].reverse().map(result => <span key={result.test.id} title={`${result.test.title}: ${Math.round(result.percentage)}%`}>{Math.round(result.percentage)}%</span>)}</div></td><td><strong className={`average-number average-${item.classification.toLowerCase()}`}>{Math.round(item.average ?? 0)}%</strong></td><td><span className="latest-number">{Math.round(item.latest ?? 0)}%</span></td><td><span className={`trend-label trend-${item.trend}`}><TrendIcon size={14} />{item.trend === 'none' ? '—' : item.trend}</span></td><td><div className="weak-reading">{dropping && <StatusBadge tone="dropping"><T k="weak-areas:dropping-2">{"Dropping"}</T></StatusBadge>}<StatusBadge tone={item.classification}>{item.classification}</StatusBadge></div></td></tr>
        })}</tbody></table></div>}
        {tested.length > MOBILE_VISIBLE_LIMIT && <div className="weak-mobile-disclosure"><button type="button" aria-expanded={showAllTestedMobile} aria-controls="weak-tested-table" onClick={() => setShowAllTestedMobile(value => !value)}>{showAllTestedMobile ? <><ChevronUp size={15} /> Show fewer tested chapters</> : <><ChevronDown size={15} /> Show all {tested.length} tested chapters</>}</button></div>}
        <div className="weak-table-foot"><span><T k="weak-areas:chapter-score-mean-of-the-latest-three-u">{"Based on your latest three chapter test scores."}</T> <InfoTip text="Average of the latest three usable results, as percentages so different totals compare fairly." /></span><button onClick={() => navigate('/tests')}><T k="weak-areas:test-history">{"Test history ↗"}</T></button></div>
      </NotebookCard>
    </section>

    <section {...sl.attrs('untested')} className="weak-section untested-section" aria-labelledby="untested-heading"><SectionHeading title="Untested chapters" note="No score yet. Not counted as weak." action={<StatusBadge tone="muted">{untested.length} untested</StatusBadge>} />
      {untested.length === 0 ? <NotebookCard className="untested-board"><EmptyState icon={<Target size={23} />} title={data.chapters.length ? 'Every chapter has a recorded result.' : 'No chapters yet.'} /></NotebookCard> : <NotebookCard className="untested-board">
        <div className="untested-toggle-row">
          <p id="untested-heading"><T k="weak-areas:these-chapters-have-no-usable-score-yet">{"No test score yet. Add a test to set a baseline."}</T></p>
          <button type="button" className={`untested-toggle ${showUntested ? 'open' : ''}`} aria-expanded={showUntested} aria-controls="untested-chapter-groups" onClick={() => setShowUntested(value => !value)}>
            {showUntested ? <><ChevronUp size={15} /> Hide untested</> : <><ChevronDown size={15} /> Show untested ({untested.length})</>}
          </button>
        </div>
        {showUntested && <div className="untested-groups" id="untested-chapter-groups">
          {subjectList.map(subject => {
            const chapters = untested.filter(item => item.chapter.subject === subject)
            if (!chapters.length) return null
            return <div className="untested-group" key={subject}>
              <div className="untested-group-head"><SubjectBadge subject={subject} /><span>{chapters.length} chapter{chapters.length === 1 ? '' : 's'} without a score</span></div>
              <div className="untested-chip-row">{chapters.map(item => (
                <button key={item.chapter.id} className={`untested-chip chip-${subject.toLowerCase()}`} onClick={() => navigate(`/tests?add=1&chapter=${item.chapter.id}`)} title={`Log a test for ${item.chapter.name}`} aria-label={`Log a test for ${item.chapter.name} (${subject})`}>
                  <span className="untested-chip-name">{item.chapter.name}</span><Plus size={13} aria-hidden="true" />
                </button>
              ))}</div>
            </div>
          })}
          <p className="untested-groups-foot"><T k="weak-areas:tap-a-chapter-to-log-its-first-test-the">{"Select a chapter to log its first test."}</T></p>
        </div>}
      </NotebookCard>}
    </section>

    {!sl.hidden('legend') && <div {...sl.attrs('legend')} className="weak-classification-footer"><div><span>✳</span><p><T k="weak-areas:weak-below-the-adjustable-threshold-okay">{"Weak is below your threshold, Strong is above, Okay is between."}</T>{' '}<strong><T k="weak-areas:no-usable-score-means-untested">{"No usable score means Untested."}</T></strong></p></div><button onClick={() => navigate('/analytics')}><T k="weak-areas:see-full-analytics">{"See full analytics"}</T>{' '}<ArrowUpRight size={15} /></button></div>}
  </div>
}
