import { useEffect, useRef, useState } from 'react'
import { AlarmClock, CalendarDays, Check, Clock3, Flame, NotebookPen, Pencil } from 'lucide-react'
import { SYLLABUS } from '../../lib/syllabus'
import { burstConfetti, prefersReducedMotion } from './home-motion'

/**
 * Hero visual: an illustrative Stracker page. Every value is labelled as a sample and the
 * chapter totals come from the seeded syllabus, so the preview can never claim a count the
 * application does not ship. The only controls are the three sample tasks, which tick and
 * untick locally (nothing is saved) so a visitor can feel how a day's plan behaves.
 */
const SAMPLE = {
  streakDays: 7,
  done: { Physics: 12, Chemistry: 11, Maths: 13 } as Record<SampleSubject, number>,
  test: { title: 'Mock test · Paper 1', marks: 41, totalMarks: 60, correct: 11, wrong: 3, skipped: 1 },
  revision: { chapter: 'Current Electricity', number: 2 }
}

type SampleSubject = 'Physics' | 'Chemistry' | 'Maths'
const SUBJECTS: SampleSubject[] = ['Physics', 'Chemistry', 'Maths']
const SUBJECT_TONE: Record<SampleSubject, string> = { Physics: 'blue', Chemistry: 'mint', Maths: 'orange' }

const TASKS = [
  { title: 'Current Electricity — formulas + PYQs', subject: 'Physics', minutes: 45, done: true },
  { title: 'Rotational Motion — 20 problems', subject: 'Physics', minutes: 60, done: false },
  { title: 'Equilibrium — chapter review', subject: 'Chemistry', minutes: 40, done: false }
]

export function NotebookPreview() {
  const totals = SUBJECTS.map(subject => ({ subject, total: SYLLABUS[subject]?.length ?? 0, done: SAMPLE.done[subject] }))
  const chaptersDone = totals.reduce((sum, item) => sum + item.done, 0)
  const chaptersTotal = totals.reduce((sum, item) => sum + item.total, 0)
  const covered = chaptersTotal ? Math.round(chaptersDone / chaptersTotal * 100) : 0

  const [done, setDone] = useState<boolean[]>(() => TASKS.map(task => task.done))
  const doneCount = done.filter(Boolean).length
  const sheetRef = useRef<HTMLDivElement>(null)
  const previous = useRef(doneCount)

  /* Celebrate only on the transition into "all done", never on re-renders or unticks. */
  useEffect(() => {
    if (doneCount === TASKS.length && previous.current < TASKS.length && sheetRef.current && !prefersReducedMotion()) {
      burstConfetti(sheetRef.current, 26)
    }
    previous.current = doneCount
  }, [doneCount])

  const status = doneCount === TASKS.length
    ? 'All 3 done — nice work!'
    : doneCount === 0 ? 'Nothing ticked yet' : `${doneCount} of ${TASKS.length} done`

  return <figure className="hp-figure">
    <span className="hp-figure-glow" aria-hidden="true" />
    <div className="hp-sheet" ref={sheetRef} data-tilt="">
      <span className="hp-tape hp-tape-top" aria-hidden="true" />
      <div className="hp-sheet-head">
        <div>
          <p className="hp-kicker"><span className="hp-kicker-icon" aria-hidden="true"><NotebookPen size={13} /></span> Sample workspace · JEE PCM</p>
          <p className="hp-sheet-title">Today&rsquo;s page · example</p>
        </div>
        <span className="hp-pill hp-pill-yellow"><Flame size={14} aria-hidden="true" /> example · {SAMPLE.streakDays}-day streak</span>
      </div>

      <div className="hp-sheet-grid">
        <div className="hp-panel">
          <div className="hp-panel-head"><span className="hp-label">Syllabus progress</span><span className="hp-panel-note">{chaptersDone} / {chaptersTotal} chapters</span></div>
          <div className="hp-syllabus">
            <span className="hp-ring" style={{ ['--hp-ring' as string]: covered }} role="img" aria-label={`${covered}% of the sample syllabus covered`}>
              <svg viewBox="0 0 84 84" aria-hidden="true"><circle cx="42" cy="42" r="36" className="hp-ring-track" /><circle cx="42" cy="42" r="36" className="hp-ring-bar" pathLength={100} /></svg>
              <span className="hp-ring-value" aria-hidden="true">{covered}<small>%</small></span>
            </span>
            <div className="hp-bars">
              {totals.map(item => <div className="hp-bar-row" key={item.subject}>
                <div className="hp-bar-label"><span>{item.subject}</span><span>{item.done}/{item.total}</span></div>
                <span className={`hp-bar hp-bar-${SUBJECT_TONE[item.subject]}`} aria-hidden="true"><i style={{ width: `${item.total ? item.done / item.total * 100 : 0}%` }} /></span>
              </div>)}
            </div>
          </div>
        </div>

        <div className="hp-panel">
          <div className="hp-panel-head"><span className="hp-label">Today&rsquo;s plan</span><span className="hp-panel-note" aria-live="polite"><CalendarDays size={13} aria-hidden="true" /> <span className="hp-task-count">{doneCount}</span> of {TASKS.length} done</span></div>
          <ul className="hp-tasks" aria-label="Sample tasks — tap to tick">
            {TASKS.map((task, index) => <li key={task.title}>
              <button
                type="button"
                className={`hp-task${done[index] ? ' is-done' : ''}`}
                aria-pressed={done[index]}
                onClick={() => setDone(current => current.map((value, i) => (i === index ? !value : value)))}
              >
                <span className="hp-task-check" aria-hidden="true">{done[index] ? <Check size={13} strokeWidth={3} /> : null}</span>
                <span className="hp-task-copy">
                  <span className="hp-task-title">{task.title}</span>
                  <span className="hp-task-meta">{task.subject} · <Clock3 size={12} aria-hidden="true" /> {task.minutes} min</span>
                </span>
              </button>
            </li>)}
          </ul>
          <p className="hp-task-status" aria-live="polite">{status}<span className="hp-task-hint"> · tap a task to {doneCount === TASKS.length ? 'untick' : 'tick'} it</span></p>
        </div>

        <div className="hp-panel">
          <div className="hp-panel-head"><span className="hp-label">Last test · example</span><span className="hp-chip">Mock</span></div>
          <p className="hp-score"><strong>{SAMPLE.test.marks}</strong><span> / {SAMPLE.test.totalMarks}</span></p>
          <p className="hp-test-title">{SAMPLE.test.title}</p>
          <p className="hp-test-facts"><span className="hp-good"><Check size={12} strokeWidth={3} aria-hidden="true" /> {SAMPLE.test.correct} correct</span><span>{SAMPLE.test.wrong} wrong</span><span>{SAMPLE.test.skipped} skipped</span></p>
        </div>

        <div className="hp-panel">
          <div className="hp-panel-head"><span className="hp-label">Revision due · example</span><Pencil size={14} aria-hidden="true" className="hp-panel-doodle" /></div>
          <div className="hp-revision">
            <span className="hp-revision-number" aria-hidden="true">R{SAMPLE.revision.number}</span>
            <div><p className="hp-revision-chapter">{SAMPLE.revision.chapter}</p><p className="hp-revision-when"><AlarmClock size={12} aria-hidden="true" /> Scheduled for today</p></div>
          </div>
          <p className="hp-revision-note">Completing it opens the next interval in the revision chain.</p>
        </div>
      </div>
    </div>
    <figcaption className="hp-figure-caption">
      <Pencil size={14} aria-hidden="true" /> <span>An illustrative JEE PCM example. Your own exam&rsquo;s subjects and chapters take their place.</span>
    </figcaption>
    <span className="hp-sticker" aria-hidden="true">your page, every day →</span>
  </figure>
}
