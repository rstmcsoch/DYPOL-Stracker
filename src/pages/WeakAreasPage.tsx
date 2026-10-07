import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowDownRight, ArrowUpRight, Minus, Target, TrendingDown, TrendingUp, TriangleAlert } from 'lucide-react'
import { Button, EmptyState, NotebookCard, PageHeader, SectionHeading, StatusBadge, SubjectBadge } from '../components/ui'
import { useData } from '../contexts/DataContext'
import { getChapterPerformance } from '../lib/analytics'
import type { Subject } from '../types'
import { SUBJECTS } from '../types'

export default function WeakAreasPage() {
  const { data } = useData()
  const navigate = useNavigate()
  const [subject, setSubject] = useState<'all' | Subject>('all')
  const performance = useMemo(() => getChapterPerformance(data), [data])
  const chapters = performance.filter(item => subject === 'all' || item.chapter.subject === subject)
  const untested = chapters.filter(item => item.classification === 'Untested').sort((a, b) => a.chapter.subject.localeCompare(b.chapter.subject) || a.chapter.position - b.chapter.position)
  const tested = chapters.filter(item => item.classification !== 'Untested').sort((a, b) => Number(b.dropping) - Number(a.dropping) || (a.average ?? 100) - (b.average ?? 100))
  const weak = tested.filter(item => item.classification === 'Weak')
  const strong = tested.filter(item => item.classification === 'Strong')
  const dropCount = tested.filter(item => item.dropping).length

  return <div className="content-page weak-page">
    <PageHeader eyebrow="SCORE THE CHAPTER, NOT THE FEELING" title="Weak areas" subtitle="Chapter averages use the last three usable results. Untested stays unclassified." doodle={<Target size={19} />} action={<label className="weak-subject-select"><span>Subject</span><select value={subject} onChange={event => setSubject(event.target.value as 'all' | Subject)}><option value="all">All subjects</option>{SUBJECTS.map(item => <option key={item}>{item}</option>)}</select></label>} />
    <div className="weak-rule-banner"><span className="rule-pencil">✎</span><p>Current bands: <strong>Weak &lt; {data.settings.weak_threshold}%</strong><span>·</span><strong>Okay {data.settings.weak_threshold}–{data.settings.strong_threshold}%</strong><span>·</span><strong>Strong &gt; {data.settings.strong_threshold}%</strong></p><button onClick={() => navigate('/settings')}>Adjust in Settings ↗</button></div>
    <div className="weak-overview-grid"><NotebookCard className="weak-overview-item weak-tint"><div><span className="weak-overview-icon"><TriangleAlert size={17} /></span><span className="eyebrow">NEEDS ANOTHER LOOK</span></div><strong>{weak.length}</strong><small>chapter{weak.length === 1 ? '' : 's'} below the weak-area threshold</small></NotebookCard><NotebookCard className="weak-overview-item dropping-tint"><div><span className="weak-overview-icon"><TrendingDown size={17} /></span><span className="eyebrow">DROPPING</span></div><strong>{dropCount}</strong><small>latest result fell by {data.settings.dropping_threshold} points or more</small></NotebookCard><NotebookCard className="weak-overview-item untested-tint"><div><span className="weak-overview-icon"><Target size={17} /></span><span className="eyebrow">NO BASELINE YET</span></div><strong>{untested.length}</strong><small>untested · not classified as weak</small></NotebookCard><NotebookCard className="weak-overview-item strong-tint"><div><span className="weak-overview-icon"><TrendingUp size={17} /></span><span className="eyebrow">FEELING STEADY</span></div><strong>{strong.length}</strong><small>chapter{strong.length === 1 ? '' : 's'} at or above the strong threshold</small></NotebookCard></div>

    {dropCount > 0 && <NotebookCard className="dropping-alert"><span className="dropping-mark"><ArrowDownRight size={18} /></span><div><strong>A dip worth checking</strong><p>{tested.filter(item => item.dropping).map(item => `${item.chapter.name} (${Math.round(item.results[1]?.percentage ?? 0)}% → ${Math.round(item.latest ?? 0)}%)`).join(' · ')}</p></div><span>Compare the paper, not just the score.</span></NotebookCard>}

    <section className="weak-section"><SectionHeading title="Tested chapters" note={`${tested.length} chapter${tested.length === 1 ? '' : 's'} with usable scores`} />
      <NotebookCard className="weak-table-board">
        {tested.length === 0 ? <EmptyState icon={<Target size={24} />} title="No usable chapter results yet." description="Log a test with a chapter, marks and total. Untested topics will stay in their own list until then." action={<Button variant="secondary" size="sm" onClick={() => navigate('/tests?add=1')}>Add a chapter test</Button>} /> : <div className="weak-table-scroll"><table className="weak-table"><thead><tr><th>CHAPTER</th><th>LAST 3 RESULTS</th><th>AVERAGE</th><th>LATEST</th><th>TREND</th><th>READING</th></tr></thead><tbody>{tested.map(item => {
          const dropping = item.dropping
          const TrendIcon = item.trend === 'up' ? TrendingUp : item.trend === 'down' ? TrendingDown : item.trend === 'steady' ? Minus : Target
          return <tr key={item.chapter.id} className={dropping ? 'is-dropping-row' : ''}><td><button className="weak-chapter-link" onClick={() => navigate('/syllabus')}><span className={`weak-subject-marker marker-${item.chapter.subject.toLowerCase()}`} /><span><strong>{item.chapter.name}</strong><small><SubjectBadge subject={item.chapter.subject} /> · {item.results.length} test{item.results.length === 1 ? '' : 's'} used</small></span></button></td><td><div className="last-three-scores">{[...item.results].reverse().map(result => <span key={result.test.id} title={`${result.test.title}: ${Math.round(result.percentage)}%`}>{Math.round(result.percentage)}%</span>)}</div></td><td><strong className={`average-number average-${item.classification.toLowerCase()}`}>{Math.round(item.average ?? 0)}%</strong></td><td><span className="latest-number">{Math.round(item.latest ?? 0)}%</span></td><td><span className={`trend-label trend-${item.trend}`}><TrendIcon size={14} />{item.trend === 'none' ? '—' : item.trend}</span></td><td><div className="weak-reading">{dropping && <StatusBadge tone="dropping">Dropping</StatusBadge>}<StatusBadge tone={item.classification}>{item.classification}</StatusBadge></div></td></tr>
        })}</tbody></table></div>}
        <div className="weak-table-foot"><span>Chapter score = average of the latest three usable chapter results. Percentages normalize different test totals.</span><button onClick={() => navigate('/tests')}>Test history ↗</button></div>
      </NotebookCard>
    </section>

    <section className="weak-section untested-section"><SectionHeading title="Untested chapters" note="A baseline is missing — not a reason to assume weakness." action={<StatusBadge tone="muted">{untested.length} untested</StatusBadge>} />
      <NotebookCard className="untested-board">{untested.length === 0 ? <EmptyState icon={<Target size={23} />} title="Every chapter has a recorded result." description="Keep adding real chapter-level scores as you practice." /> : <div className="untested-grid">{untested.map(item => <div className="untested-chapter" key={item.chapter.id}><div><SubjectBadge subject={item.chapter.subject} /><span>{item.chapter.name}</span></div><StatusBadge tone="muted">Untested</StatusBadge><button onClick={() => navigate('/tests?add=1')} aria-label={`Add test for ${item.chapter.name}`} title="Log a test">+</button></div>)}</div>}</NotebookCard>
    </section>

    <div className="weak-classification-footer"><div><span>✳</span><p>Weak = below the adjustable threshold. Okay = between thresholds. Strong = above. <strong>No usable score means Untested.</strong></p></div><button onClick={() => navigate('/analytics')}>See full analytics <ArrowUpRight size={15} /></button></div>
  </div>
}
