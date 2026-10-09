import { AlarmClock, CalendarDays, Check, Clock3, Flame, NotebookPen, Pencil } from 'lucide-react'
import { ProgressBar, ProgressRing, StatusBadge, SubjectBadge } from '../ui'
import { SYLLABUS } from '../../lib/syllabus'
import type { Subject } from '../../types'

/**
 * A composed Stracker page used as the hero visual — not a screenshot and not a mock-up
 * of some other product: it uses the same primitives (ProgressRing, ProgressBar,
 * SubjectBadge, StatusBadge) and the same classes as the dashboard.
 *
 * The values are deliberately labelled as an illustration. Totals still come from the
 * seeded syllabus, so the preview can never claim a chapter count the application does
 * not actually ship.
 */
const SAMPLE = {
  streakDays: 7,
  done: { Physics: 12, Chemistry: 11, Maths: 13 } as Record<Subject, number>,
  test: { title: 'Rotational Motion · Chapter Test', marks: 41, totalMarks: 60, correct: 11, wrong: 3, skipped: 1 },
  revision: { chapter: 'Current Electricity', number: 2 }
}

const SUBJECTS: Subject[] = ['Physics', 'Chemistry', 'Maths']

const TASKS = [
  { title: 'Current Electricity — formulas + PYQs', subject: 'Physics' as Subject, minutes: 45, done: true },
  { title: 'Rotational Motion — 20 problems', subject: 'Physics' as Subject, minutes: 60, done: false },
  { title: 'Equilibrium — NCERT review', subject: 'Chemistry' as Subject, minutes: 40, done: false }
]

export function NotebookPreview() {
  const totals = SUBJECTS.map(subject => ({ subject, total: SYLLABUS[subject].length, done: SAMPLE.done[subject] }))
  const chaptersDone = totals.reduce((sum, item) => sum + item.done, 0)
  const chaptersTotal = totals.reduce((sum, item) => sum + item.total, 0)
  const covered = Math.round(chaptersDone / chaptersTotal * 100)
  const doneTasks = TASKS.filter(task => task.done).length

  return <figure className="hero-figure">
    <div className="hero-sheet" aria-hidden="true">
      <span className="hero-tape" />
      <div className="hero-sheet-head">
        <div className="hero-sheet-label">
          <span className="card-kicker"><span className="icon-tile blue"><NotebookPen size={15} /></span> ILLUSTRATIVE PREVIEW</span>
          <strong>Today&rsquo;s page · example</strong>
        </div>
        <span className="hero-streak"><Flame size={15} /> example · {SAMPLE.streakDays}-day streak</span>
      </div>

      <div className="hero-preview-grid">
        <div className="hero-panel hero-syllabus">
          <div className="hero-panel-head">
            <span className="eyebrow">SYLLABUS PROGRESS</span>
            <span className="hero-panel-note">{chaptersDone}/{chaptersTotal} chapters</span>
          </div>
          <div className="hero-syllabus-body">
            <ProgressRing value={covered} size={78} label={<span className="ring-value small">{covered}<small>%</small></span>} color="var(--accent)" />
            <div className="hero-subject-bars">
              {totals.map(item => <div className="hero-subject-row" key={item.subject}>
                <SubjectBadge subject={item.subject} />
                <ProgressBar value={item.done / item.total * 100} color={`var(--subject-${item.subject.toLowerCase()})`} />
                <span>{item.done}/{item.total}</span>
              </div>)}
            </div>
          </div>
        </div>

        <div className="hero-panel hero-plan">
          <div className="hero-panel-head">
            <span className="eyebrow">TODAY&rsquo;S PLAN</span>
            <span className="hero-panel-note"><CalendarDays size={14} /> {doneTasks} of {TASKS.length} done</span>
          </div>
          <div className="task-list">
            {TASKS.map(task => <div className={`task-row ${task.done ? 'task-done' : ''}`} key={task.title}>
              <span className="task-check">{task.done ? <Check size={13} strokeWidth={3} /> : null}</span>
              <div className="task-row-copy">
                <strong>{task.title}</strong>
                <div className="task-meta">
                  <SubjectBadge subject={task.subject} />
                  <span><Clock3 size={13} /> {task.minutes} min</span>
                </div>
              </div>
            </div>)}
          </div>
        </div>

        <div className="hero-panel hero-test">
          <div className="hero-panel-head">
            <span className="eyebrow">LAST TEST · EXAMPLE</span>
            <StatusBadge tone="muted">CHAPTER TEST</StatusBadge>
          </div>
          <div className="hero-test-score"><strong>{SAMPLE.test.marks}</strong><span>/ {SAMPLE.test.totalMarks}</span></div>
          <p className="hero-test-title">{SAMPLE.test.title}</p>
          <div className="hero-test-facts">
            <span className="fact-correct"><Check size={13} /> {SAMPLE.test.correct} correct</span>
            <span>{SAMPLE.test.wrong} wrong</span>
            <span>{SAMPLE.test.skipped} skipped</span>
          </div>
        </div>

        <div className="hero-panel hero-revision">
          <div className="hero-panel-head">
            <span className="eyebrow">REVISION DUE · EXAMPLE</span>
            <span className="hero-doodle hero-doodle-star" aria-hidden="true">✎</span>
          </div>
          <div className="hero-revision-row">
            <span className="revision-peek-number">R{SAMPLE.revision.number}</span>
            <div className="hero-revision-copy">
              <strong>{SAMPLE.revision.chapter}</strong>
              <span><AlarmClock size={14} /> Scheduled for today</span>
            </div>
            <span className="hero-tick"><Check size={13} strokeWidth={3} /></span>
          </div>
          <p className="hero-revision-note">Completing it opens the next interval in the revision chain.</p>
        </div>
      </div>
    </div>
    <figcaption className="hero-figure-caption">
      <Pencil size={14} aria-hidden="true" /> An illustrative page: the syllabus, today&rsquo;s plan, an example test and a revision due — the same structure the notebook brings together.
    </figcaption>
  </figure>
}
