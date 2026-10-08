import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, ChevronDown, ChevronUp, Minus, Plus, Target, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { Button, EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { getChapterPerformance } from '../lib/analytics'
import { practiceByChapter, PRACTICE_MIN_ATTEMPTS_FOR_SIGNAL, type PracticeAggregate } from '../lib/jee/progress'
import { Meter, Pct } from '../components/jee/shared'
import type { Chapter, Subject } from '../types'
import { SUBJECTS } from '../types'

const MOBILE_VISIBLE_LIMIT = 8

export default function WeakAreasPage() {
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

  return <div className={pageClass}>
    <PageHeader eyebrow="SCORE THE CHAPTER, NOT THE FEELING" title="Weak areas" subtitle="Chapter averages use the last three usable results. Untested stays unclassified." doodle={<Target size={19} />} action={<label className="weak-subject-select"><span>Subject</span><select value={subject} onChange={event => { setSubject(event.target.value as 'all' | Subject); setShowAllTestedMobile(false); setShowUntested(false) }}><option value="all">All subjects</option>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></label>} />
    <div className="weak-rule-banner"><span className="rule-pencil">✎</span><p>Current bands: <strong>Weak &lt; {data.settings.weak_threshold}%</strong><span>·</span><strong>Okay {data.settings.weak_threshold}–{data.settings.strong_threshold}%</strong><span>·</span><strong>Strong &gt; {data.settings.strong_threshold}%</strong></p><button onClick={() => navigate('/settings')}>Adjust in Settings ↗</button></div>
    <div className="weak-overview-grid"><NotebookCard className="weak-overview-item weak-tint"><div><span className="weak-overview-icon"><TriangleAlert size={17} /></span><span className="eyebrow">NEEDS ANOTHER LOOK</span></div><strong>{weak.length}</strong><small>chapter{weak.length === 1 ? '' : 's'} below the weak-area threshold</small></NotebookCard><NotebookCard className="weak-overview-item dropping-tint"><div><span className="weak-overview-icon"><TrendingDown size={17} /></span><span className="eyebrow">DROPPING</span></div><strong>{dropCount}</strong><small>latest result fell by {data.settings.dropping_threshold} points or more</small></NotebookCard><NotebookCard className="weak-overview-item untested-tint"><div><span className="weak-overview-icon"><Target size={17} /></span><span className="eyebrow">NO BASELINE YET</span></div><strong>{untested.length}</strong><small>untested · not classified as weak</small></NotebookCard><NotebookCard className="weak-overview-item strong-tint"><div><span className="weak-overview-icon"><TrendingUp size={17} /></span><span className="eyebrow">FEELING STEADY</span></div><strong>{strong.length}</strong><small>chapter{strong.length === 1 ? '' : 's'} at or above the strong threshold</small></NotebookCard></div>

    {practiceWeak.length > 0 && <section className="weak-section" aria-label="Practice signal"><SectionHeading title="Practice is flagging these" note="From your DPP and module log. Needs 20+ questions per chapter." />
      <NotebookCard className="practice-signal-board">{practiceWeak.map(({ chapter, agg }) => <div key={chapter.id} className="practice-signal-row">
        <div><strong>{chapter.name}</strong><small>{agg.attempted} questions · {agg.incorrect} incorrect · recent <Pct value={agg.recentAccuracy} /></small></div>
        <div className="practice-signal-meter"><Meter value={agg.accuracy} label={`${chapter.name} practice accuracy`} tone="orange" /><b><Pct value={agg.accuracy} /></b></div>
        <button type="button" className="weak-chapter-link" onClick={() => navigate(`/practice?chapter=${chapter.id}&add=1`)}>Log practice ↗</button>
      </div>)}</NotebookCard></section>}
    {dropCount > 0 && <NotebookCard className="dropping-alert"><span className="dropping-mark"><ArrowDownRight size={18} /></span><div><strong>A dip worth checking</strong><p>{tested.filter(item => item.dropping).map(item => `${item.chapter.name} (${Math.round(item.results[1]?.percentage ?? 0)}% → ${Math.round(item.latest ?? 0)}%)`).join(' · ')}</p></div><span>Compare the paper, not just the score.</span></NotebookCard>}

    <section className="weak-section"><SectionHeading title="Tested chapters" note={`${tested.length} chapter${tested.length === 1 ? '' : 's'} with usable scores`} />
      <NotebookCard className="weak-table-board">
        {tested.length === 0 ? <EmptyState icon={<Target size={24} />} title="No usable chapter results yet." description="Log a test with a chapter, marks and total. Untested topics will stay in their own list until then." action={<Button variant="secondary" size="sm" onClick={() => navigate('/tests?add=1')}>Add a chapter test</Button>} /> : <div className="weak-table-scroll"><table className="weak-table" id="weak-tested-table"><thead><tr><th>CHAPTER</th><th>LAST 3 RESULTS</th><th>AVERAGE</th><th>LATEST</th><th>TREND</th><th>READING</th></tr></thead><tbody>{tested.map((item, index) => {
          const dropping = item.dropping
          const TrendIcon = item.trend === 'up' ? TrendingUp : item.trend === 'down' ? TrendingDown : item.trend === 'steady' ? Minus : Target
          return <tr key={item.chapter.id} className={`${dropping ? 'is-dropping-row ' : ''}${index >= MOBILE_VISIBLE_LIMIT ? 'weak-mobile-extra' : ''}`}><td><button className="weak-chapter-link" onClick={() => navigate('/syllabus')}><span className={`weak-subject-marker marker-${item.chapter.subject.toLowerCase()}`} /><span><strong>{item.chapter.name}</strong><small><SubjectBadge subject={item.chapter.subject} /> · {item.results.length} test{item.results.length === 1 ? '' : 's'} used</small></span></button></td><td><div className="last-three-scores">{[...item.results].reverse().map(result => <span key={result.test.id} title={`${result.test.title}: ${Math.round(result.percentage)}%`}>{Math.round(result.percentage)}%</span>)}</div></td><td><strong className={`average-number average-${item.classification.toLowerCase()}`}>{Math.round(item.average ?? 0)}%</strong></td><td><span className="latest-number">{Math.round(item.latest ?? 0)}%</span></td><td><span className={`trend-label trend-${item.trend}`}><TrendIcon size={14} />{item.trend === 'none' ? '—' : item.trend}</span></td><td><div className="weak-reading">{dropping && <StatusBadge tone="dropping">Dropping</StatusBadge>}<StatusBadge tone={item.classification}>{item.classification}</StatusBadge></div></td></tr>
        })}</tbody></table></div>}
        {tested.length > MOBILE_VISIBLE_LIMIT && <div className="weak-mobile-disclosure"><button type="button" aria-expanded={showAllTestedMobile} aria-controls="weak-tested-table" onClick={() => setShowAllTestedMobile(value => !value)}>{showAllTestedMobile ? <><ChevronUp size={15} /> Show fewer tested chapters</> : <><ChevronDown size={15} /> Show all {tested.length} tested chapters</>}</button></div>}
        <div className="weak-table-foot"><span>Chapter score = mean of the latest three usable chapter results. Percentages normalize different test totals.</span><button onClick={() => navigate('/tests')}>Test history ↗</button></div>
      </NotebookCard>
    </section>

    <section className="weak-section untested-section" aria-labelledby="untested-heading"><SectionHeading title="Untested chapters" note="A baseline is missing — not a reason to assume weakness." action={<StatusBadge tone="muted">{untested.length} untested</StatusBadge>} />
      {untested.length === 0 ? <NotebookCard className="untested-board"><EmptyState icon={<Target size={23} />} title="Every chapter has a recorded result." description="Keep adding real chapter-level scores as you practice." /></NotebookCard> : <NotebookCard className="untested-board">
        <div className="untested-toggle-row">
          <p id="untested-heading">These chapters have no usable score yet. They are not classified as weak — give one a first test to start its baseline.</p>
          <button type="button" className={`untested-toggle ${showUntested ? 'open' : ''}`} aria-expanded={showUntested} aria-controls="untested-chapter-groups" onClick={() => setShowUntested(value => !value)}>
            {showUntested ? <><ChevronUp size={15} /> Hide untested</> : <><ChevronDown size={15} /> Show untested ({untested.length})</>}
          </button>
        </div>
        {showUntested && <div className="untested-groups" id="untested-chapter-groups">
          {SUBJECTS.map(subject => {
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
          <p className="untested-groups-foot">Tap a chapter to log its first test — the test form opens with that chapter already selected.</p>
        </div>}
      </NotebookCard>}
    </section>

    <div className="weak-classification-footer"><div><span>✳</span><p>Weak = below the adjustable threshold. Okay = between thresholds. Strong = above. <strong>No usable score means Untested.</strong></p></div><button onClick={() => navigate('/analytics')}>See full analytics <ArrowUpRight size={15} /></button></div>
  </div>
}
