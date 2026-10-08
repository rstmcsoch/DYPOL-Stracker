import { AlarmClock, AlertTriangle, CalendarDays, Check, Clock3, Flame, NotebookPen, Pencil, Timer } from 'lucide-react'
import { ProgressBar, ProgressRing, StatusBadge, SubjectBadge } from '../ui'
import { SYLLABUS } from '../../lib/syllabus'
import type { Subject } from '../../types'

/**
 * A composed Stracker page used as the hero visual — not a screenshot and not a mock-up
 * of some other product: it uses the same primitives (ProgressRing, ProgressBar,
 * SubjectBadge, StatusBadge) and the same classes as the dashboard, with a small, fixed
 * sample state underneath.
 *
 * The totals come from the seeded syllabus, so the illustration can never claim a
 * chapter count the application does not actually ship. Marks follow the JEE pattern
 * the notebook expects (+4 correct, −1 wrong), which keeps the sample internally honest.
 */
const SAMPLE = {
  streakDays: 23,
  done: { Physics: 12, Chemistry: 11, Maths: 13 } as Record<Subject, number>,
  test: { title: 'Rotational Motion · Chapter Test', marks: 41, totalMarks: 60, correct: 11, wrong: 3, skipped: 1 },
  weak: { chapter: 'Chemical Kinetics', marks: 48, tests: 3 },
  revision: { chapter: 'Current Electricity', number: 2 }
}

const SUBJECTS: Subject[] = ['Physics', 'Chemistry', 'Maths']

const TASKS = [
  { title: 'Revise Current Electricity — formulas + 12 PYQs', subject: 'Physics' as Subject, minutes: 45, done: true, priority: 'High' },
  { title: 'Rotational Motion: clear the 20-problem backlog', subject: 'Physics' as Subject, minutes: 60, done: false, priority: 'High' },
  { title: 'Equilibrium — NCERT line by line', subject: 'Chemistry' as Subject, minutes: 40, done: false, priority: 'Medium' }
]

export function NotebookPreview() {
  const today = new Intl.DateTimeFormat('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date())
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
          <span className="card-kicker"><span className="icon-tile blue"><NotebookPen size={15} /></span> TODAY&rsquo;S PAGE</span>
          <strong>{today}</strong>
        </div>
        <span className="hero-streak"><Flame size={15} /> {SAMPLE.streakDays}-day streak</span>
      </div>

      <div className="hero-sheet-split">
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
            <span className="hero-panel-note"><CalendarDays size={12} /> {doneTasks} of {TASKS.length} done</span>
          </div>
          <div className="task-list">
            {TASKS.map(task => <div className={`task-row ${task.done ? 'task-done' : ''}`} key={task.title}>
              <span className="task-check">{task.done ? <Check size={13} strokeWidth={3} /> : null}</span>
              <div className="task-row-copy">
                <strong>{task.title}</strong>
                <div className="task-meta">
                  <SubjectBadge subject={task.subject} />
                  <span><Clock3 size={12} /> {task.minutes} min</span>
                </div>
              </div>
              <span className={`priority-dot priority-${task.priority.toLowerCase()}`} />
            </div>)}
          </div>
        </div>
      </div>

      <div className="hero-sheet-pair">
        <div className="hero-panel hero-test">
          <div className="hero-panel-head">
            <span className="eyebrow">LAST TEST</span>
            <StatusBadge tone="muted">CHAPTER TEST</StatusBadge>
          </div>
          <div className="hero-test-score"><strong>{SAMPLE.test.marks}</strong><span>/ {SAMPLE.test.totalMarks}</span></div>
          <p className="hero-test-title">{SAMPLE.test.title}</p>
          <div className="hero-test-facts">
            <span className="fact-correct"><Check size={12} /> {SAMPLE.test.correct} correct</span>
            <span className="fact-wrong">✕ {SAMPLE.test.wrong} wrong</span>
            <span>— {SAMPLE.test.skipped} skipped</span>
          </div>
          <span className="hero-doodle hero-doodle-trend">↗</span>
        </div>

        <div className="hero-panel hero-revision">
          <div className="hero-panel-head">
            <span className="eyebrow">REVISION DUE</span>
            <SubjecMark />
          </div>
          <div className="hero-revision-row">
            <span className="revision-peek-number">R{SAMPLE.revision.number}</span>
            <div className="hero-revision-copy">
              <strong>{SAMPLE.revision.chapter}</strong>
              <span><AlarmClock size={12} /> Scheduled for today</span>
            </div>
            <span className="hero-tick"><Check size={13} strokeWidth={3} /></span>
          </div>
          <p className="hero-revision-note">Marking it done opens the next interval in the revision chain.</p>
        </div>
      </div>

      <div className="hero-weak">
        <span className="hero-weak-icon"><AlertTriangle size={15} /></span>
        <div>
          <strong>{SAMPLE.weak.chapter} keeps slipping</strong>
          <span>{SAMPLE.weak.marks}% across {SAMPLE.weak.tests} tests — flagged as a weak chapter, with a revision waiting in the queue.</span>
        </div>
        <StatusBadge tone="weak">WEAK AREA</StatusBadge>
        <span className="hero-doodle hero-doodle-note">✎</span>
      </div>

      <div className="hero-sheet-foot">
        <span><Timer size={13} /> 2 focus sessions · 1h 40m logged today</span>
        <span className="hero-sheet-sign">— sample page</span>
      </div>
    </div>
    <figcaption className="hero-figure-caption">
      <Pencil size={13} aria-hidden="true" /> An example page: today&rsquo;s list, syllabus progress, the last test, a revision falling due, and the chapter that needs attention.
    </figcaption>
  </figure>
}

/** Decorative asterisk used inside the revision panel head. */
function SubjecMark() {
  return <span className="hero-doodle hero-doodle-star">✦</span>
}
