import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, BookOpen, CalendarCheck, Check, ChevronRight, Coffee, Focus, Link2, Moon, Pause, Play, RotateCcw, Search, Sparkles, Timer, Unlink, X } from 'lucide-react'
import { Button, Dialog, ProgressRing, SubjectBadge } from '../components/ui'
import { useFocus, type FocusMode } from '../contexts/FocusContext'
import { useData } from '../contexts/DataContext'
import { indiaToday } from '../lib/date'
import type { Subject } from '../types'
import { SUBJECTS } from '../types'

const MODES: { name: FocusMode; minutes: number; label: string; icon: React.ReactNode }[] = [
  { name: 'Pomodoro', minutes: 25, label: 'Focus', icon: <Focus size={15} /> },
  { name: 'Short Break', minutes: 5, label: 'Short break', icon: <Coffee size={15} /> },
  { name: 'Long Break', minutes: 15, label: 'Long break', icon: <Moon size={15} /> },
  { name: 'Custom', minutes: 40, label: 'Custom', icon: <Timer size={15} /> }
]

export default function FocusPage() {
  const timer = useFocus()
  const { running: timerRunning, pause: pauseTimer, start: startTimer } = timer
  const { data } = useData()
  const navigate = useNavigate()
  const [chapterPickerOpen, setChapterPickerOpen] = useState(false)
  const [taskPickerOpen, setTaskPickerOpen] = useState(false)
  const selectedTask = data.tasks.find(task => task.id === timer.taskId)
  const selectedChapter = data.chapters.find(chapter => chapter.id === timer.chapterId)
  const availableChapters = data.chapters.filter(chapter => !timer.subject || chapter.subject === timer.subject).sort((a, b) => a.position - b.position)
  const clock = `${String(Math.floor(timer.remainingSeconds / 60)).padStart(2, '0')}:${String(timer.remainingSeconds % 60).padStart(2, '0')}`
  const subtitle = useMemo(() => timer.mode === 'Pomodoro' || timer.mode === 'Custom' ? 'One clear block. Leave the rest for later.' : 'A pause is part of good preparation.', [timer.mode])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = target && (['INPUT','TEXTAREA','SELECT'].includes(target.tagName) || target.isContentEditable)
      if (typing) return
      if (event.code === 'Space') { event.preventDefault(); if (timerRunning) pauseTimer(); else startTimer() }
      if (event.key === 'Escape') { event.preventDefault(); navigate('/') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [timerRunning, pauseTimer, startTimer, navigate])

  const chooseSubject = (value: string) => {
    const nextSubject = value ? value as Subject : null
    timer.setSubject(nextSubject)
    const chapter = data.chapters.find(item => item.id === timer.chapterId)
    if (chapter && chapter.subject !== nextSubject) timer.setChapter(null)
  }

  return <div className="focus-page" data-mode={timer.mode.toLowerCase().replace(' ', '-') }>
    <div className="focus-vignette" aria-hidden="true" />
    <header className="focus-topbar"><button className="focus-exit" onClick={() => navigate('/')}><ArrowLeft size={17} /> Exit focus</button><div className="focus-wordmark"><span className="focus-mark">S</span><span>Stracker <i>focus mode</i></span></div><div className="focus-top-note"><span className={timer.running ? 'focus-live-dot live' : 'focus-live-dot'} />{timer.running ? 'BLOCK IN PROGRESS' : 'DISTRACTION-FREE SPACE'}</div></header>
    <main className="focus-main">
      <div className="focus-prelude"><span className="focus-star">✳</span><span className="eyebrow">MAKE THIS MOMENT COUNT</span><span className="focus-star">✦</span></div>
      <h1>{timer.mode === 'Pomodoro' || timer.mode === 'Custom' ? 'One thing at a time.' : 'Take the pause.'}</h1>
      <p className="focus-subtitle">{subtitle}</p>
      <div className="focus-mode-selector" role="group" aria-label="Timer mode">{MODES.map(mode => <button key={mode.name} className={timer.mode === mode.name ? 'selected' : ''} onClick={() => timer.switchMode(mode.name)} disabled={timer.running} aria-pressed={timer.mode === mode.name}>{mode.icon}<span>{mode.label}</span>{mode.name !== 'Custom' && <small>{timer.durations[mode.name]}m</small>}</button>)}</div>
      {timer.mode === 'Custom' && <label className="custom-time-control">Custom focus minutes <input type="number" min="1" max="180" step="1" value={timer.durations.Custom} disabled={timer.running} onChange={event => { const minutes = event.currentTarget.valueAsNumber; if (Number.isFinite(minutes) && Number.isInteger(minutes)) timer.setCustomMinutes(minutes) }} /></label>}
      <div className={`focus-clock-wrap ${timer.running ? 'is-running' : ''} ${timer.finished ? 'is-finished' : ''}`}>
        <span className="focus-clock-orbit orbit-one" aria-hidden="true" /><span className="focus-clock-orbit orbit-two" aria-hidden="true" />
        <ProgressRing value={timer.progress} size={332} color="var(--focus-accent)" label={<span className="focus-clock" aria-live="off">{clock}</span>} />
        <div className="focus-clock-caption">{timer.finished ? <><Check size={15} /> BLOCK COMPLETE</> : timer.running ? 'STAY WITH THIS PAGE' : 'READY WHEN YOU ARE'}</div>
      </div>
      <div className="focus-primary-actions">{timer.running ? <Button className="focus-start-button" size="lg" variant="marker" onClick={timer.pause}><Pause size={18} /> Pause <kbd>Space</kbd></Button> : <Button className="focus-start-button" size="lg" variant="marker" onClick={timer.start}><Play size={17} fill="currentColor" /> {timer.finished ? 'Start another block' : timer.remainingSeconds < timer.focusMinutes * 60 ? 'Resume focus' : 'Begin focus'} <kbd>Space</kbd></Button>}{(timer.running || timer.elapsedSeconds > 0 || timer.finished) && <button className="focus-reset-button" onClick={timer.reset} aria-label="Reset timer"><RotateCcw size={16} /> Reset</button>}</div>
      <div className="focus-context-card"><div className="focus-context-head"><BookOpen size={15} /><span>KEEP THIS BLOCK GROUNDED</span><span className="context-free-note">Optional</span></div><div className="focus-context-fields">
        <label><span>Subject</span><select value={timer.subject ?? ''} disabled={timer.running} onChange={event => chooseSubject(event.target.value)}><option value="">Choose a subject</option>{SUBJECTS.map(subject => <option key={subject}>{subject}</option>)}</select></label>
        <div className="focus-picker-field"><span id="focus-chapter-label">Chapter</span>
          <button type="button" className="focus-picker-trigger" disabled={timer.running} aria-haspopup="dialog" aria-labelledby="focus-chapter-label" onClick={() => setChapterPickerOpen(true)}>
            {selectedChapter ? <><span className="focus-picker-value">{selectedChapter.name}</span><SubjectBadge subject={selectedChapter.subject} /></> : <span className="focus-picker-placeholder">Search chapters…</span>}
            <Search size={14} aria-hidden="true" />
          </button>
        </div>
        <div className="focus-picker-field"><span id="focus-task-label">Today's task</span>
          {selectedTask
            ? <div className="focus-task-link-actions"><button type="button" className="focus-picker-trigger is-linked" disabled={timer.running} onClick={() => setTaskPickerOpen(true)}><Check size={14} aria-hidden="true" /><span className="focus-picker-value">{selectedTask.title}</span><ChevronRight size={14} aria-hidden="true" /></button><button type="button" className="focus-unlink-button" disabled={timer.running} onClick={() => timer.setTask(null)} aria-label="Unlink task"><Unlink size={15} /></button></div>
            : <button type="button" className="focus-picker-trigger link-task" disabled={timer.running} aria-haspopup="dialog" aria-labelledby="focus-task-label" onClick={() => setTaskPickerOpen(true)}><Link2 size={14} aria-hidden="true" /><span>Link a task</span></button>}
        </div>
      </div>
      {selectedTask && <div className="focus-current-task"><span className="focus-task-bullet">↳</span><div><span>CURRENT TASK</span><strong>{selectedTask.title}</strong>{selectedChapter && <small><SubjectBadge subject={selectedChapter.subject} /> {selectedChapter.name}</small>}</div></div>}
      {chapterPickerOpen && <ChapterSearchPicker chapters={availableChapters} selectedId={timer.chapterId} onClose={() => setChapterPickerOpen(false)} onChoose={chapterId => { timer.setChapter(chapterId); setChapterPickerOpen(false) }} />}
      {taskPickerOpen && <TaskLinkPicker tasks={data.tasks.filter(task => task.task_date === indiaToday())} linkedId={timer.taskId} onClose={() => setTaskPickerOpen(false)} onChoose={taskId => { timer.setTask(taskId); setTaskPickerOpen(false) }} />}
      </div>
      <div className="focus-footer-note"><Sparkles size={14} /> Your timer continues if you leave focus mode. Study time is logged when the focus block finishes.</div>
    </main>
    <footer className="focus-bottom"><span>Stracker <strong>by DYPOL LABS</strong></span><span>Press <kbd>Esc</kbd> to exit · <kbd>Space</kbd> to pause or resume</span></footer>
  </div>
}

/**
 * Search-as-you-type chapter picker. Replaces a ~100-item native dropdown: the
 * student types, results filter instantly across chapter and subject names, and
 * the subject is always visible so similarly named chapters stay distinguishable.
 */
function ChapterSearchPicker({ chapters, selectedId, onClose, onChoose }: {
  chapters: { id: string; name: string; subject: Subject }[]
  selectedId: string | null
  onClose: () => void
  onChoose: (chapterId: string | null) => void
}) {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)
  const trimmed = query.trim().toLowerCase()
  const results = useMemo(() => {
    if (!trimmed) return chapters
    return chapters.filter(chapter => `${chapter.name} ${chapter.subject}`.toLowerCase().includes(trimmed))
  }, [chapters, trimmed])

  useEffect(() => { setSelected(0) }, [trimmed])

  useEffect(() => {
    listRef.current?.querySelector('[data-selected="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected(index => Math.min(index + 1, results.length - 1)) }
    if (event.key === 'ArrowUp') { event.preventDefault(); setSelected(index => Math.max(index - 1, 0)) }
    if (event.key === 'Enter' && results[selected]) { event.preventDefault(); onChoose(results[selected].id) }
  }

  return <Dialog title="Choose a chapter" subtitle="Type to search — results filter as you write." onClose={onClose} className="dialog-narrow chapter-picker-dialog">
    <div className="chapter-picker-body">
      <div className="global-search-input chapter-picker-input"><Search size={17} aria-hidden="true" /><input autoFocus value={query} onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder="e.g. Current Electricity, Thermodynamics…" aria-label="Search chapters" /></div>
      {selectedId && <button type="button" className="chapter-picker-clear" onClick={() => onChoose(null)}><X size={14} aria-hidden="true" /> Clear chapter choice</button>}
      <div className="chapter-picker-results" ref={listRef} role="listbox" aria-label="Matching chapters">
        {results.length === 0 ? <div className="chapter-picker-empty"><Search size={17} aria-hidden="true" /> No chapter matches “{query.trim()}”. Try a shorter word, or a subject name like <em>Chemistry</em>.</div> : results.map((chapter, index) => (
          <button key={chapter.id} type="button" role="option" aria-selected={chapter.id === selectedId} data-selected={index === selected} className={`chapter-picker-result ${chapter.id === selectedId ? 'chosen' : ''} ${index === selected ? 'selected' : ''}`} onClick={() => onChoose(chapter.id)}>
            <SubjectBadge subject={chapter.subject} /><span>{chapter.name}</span>{chapter.id === selectedId && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="chapter-picker-foot">{results.length} chapter{results.length === 1 ? '' : 's'} available for this subject choice.</p>
    </div>
  </Dialog>
}

/** Picks one of today's tasks to anchor the focus block. */
function TaskLinkPicker({ tasks, linkedId, onClose, onChoose }: {
  tasks: { id: string; title: string; subject: Subject | null; is_completed: boolean }[]
  linkedId: string | null
  onClose: () => void
  onChoose: (taskId: string | null) => void
}) {
  const open = tasks.filter(task => !task.is_completed)
  return <Dialog title="Link a task" subtitle="Anchor this block to one of today’s planned tasks." onClose={onClose} className="dialog-narrow chapter-picker-dialog">
    <div className="chapter-picker-body">
      {open.length === 0 ? <div className="chapter-picker-empty"><CalendarCheck size={17} aria-hidden="true" /> No open tasks for today. Plan one in the Planner, then link it here.</div> : <div className="chapter-picker-results" role="listbox" aria-label="Today's tasks">
        {open.map(task => (
          <button key={task.id} type="button" role="option" aria-selected={task.id === linkedId} className={`chapter-picker-result ${task.id === linkedId ? 'chosen' : ''}`} onClick={() => onChoose(task.id)}>
            <SubjectBadge subject={task.subject} /><span>{task.title}</span>{task.id === linkedId && <Check size={15} aria-hidden="true" />}
          </button>
        ))}
      </div>}
      {linkedId && <button type="button" className="chapter-picker-clear" onClick={() => onChoose(null)}><X size={14} aria-hidden="true" /> Unlink the current task</button>}
    </div>
  </Dialog>
}
